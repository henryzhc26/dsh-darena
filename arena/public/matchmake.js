/* D宠大乐斗 · 实时匹配（英雄联盟式排队）前端
 *
 * 服务：ARENA_MATCH_BASE（插件版换域名，游戏逻辑与判分全在服务端）
 *   队列：POST /queue/join  GET /queue/poll?uid=
 *   对局：POST /match/:id/loadout  GET /match/:id?ticket=  POST /match/:id/submit
 *
 * 这个文件只负责「排队 → 配对 → 备战 → 打三局 → 回大厅」，地图渲染/模型调用复用
 * arena2/index.html 的 window.ARENA_BRIDGE，判分不做本地兜底（客户端自报的胜负不算）。
 */
(function () {
  'use strict';

  var B = window.ARENA_BRIDGE;
  var C2 = window.ArenaCore2;

  var ARENA_MATCH_BASE = 'https://hivisionelec.cn/dcdld';   // 插件版改成 https://<域名>/dcdld
  var API = ARENA_MATCH_BASE + '/api';

  var QUEUE_POLL_MS = 1500;
  var MATCH_POLL_MS = 900;
  var QUEUE_LIMIT_MS = 90000;      // 90 秒没配上就给练习房建议
  var CALL_TIMEOUT_MS = 18000;

  var M = {
    uid: '', nick: '', avatarKey: 'girl', model: 'deepseek-flash', effort: 'mid',
    ticket: '', matchId: '', side: 'A', opp: null,
    queueSince: 0, queueTimer: 0, matchTimer: 0,
    phase: '', roundIdx: -1, state: null, history: [], busy: false,
    lastLoadout: -1, lastResult: -1, running: false, aborted: false,
    model: '', effort: 'mid',
  };

  /* ---------------------------------------------------------------- 工具 */
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function api(path, opt) {
    var res = await fetch(API + path, opt);
    var json = null;
    try { json = await res.json(); } catch (e) { json = { ok: false, error: 'bad-json' }; }
    if (json && json.ok === false) throw new Error(json.error || 'api-failed');
    return json;
  }
  function get(path) { return api(path); }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  function fmtSec(ms) { return Math.max(0, Math.round(ms / 1000)); }

  /* 大厅状态层：排队阶段不弹全屏遮罩，改成 VS 区原地显示状态（index.html 的 __hallQueue） */
  function hall(kind, data) {
    try { if (typeof window.__hallQueue === 'function') window.__hallQueue(kind, data || {}); } catch (e) { /* 大厅没接也无所谓 */ }
  }

  /* ---------------------------------------------------------------- CSS */
  function injectCss() {
    if (document.getElementById('mm-css')) return;
    var st = el('style'); st.id = 'mm-css';
    st.textContent = [
      '#mm{position:fixed;inset:0;z-index:70;display:none;place-items:center;background:rgba(4,7,14,.9);backdrop-filter:blur(8px);font-family:ui-sans-serif,system-ui}',
      '#mm.on{display:grid}',
      '#mm .card{width:min(720px,94vw);max-height:92vh;overflow:auto;border:1px solid rgba(255,198,92,.28);border-radius:18px;background:linear-gradient(180deg,rgba(18,26,42,.99),rgba(9,14,24,.99));padding:24px 26px;box-shadow:0 30px 90px rgba(0,0,0,.65);color:#e9f0fb}',
      '#mm .kick{font:600 11px/1 ui-monospace;letter-spacing:.18em;color:#ffc65c;text-transform:uppercase}',
      '#mm h2{margin:10px 0 6px;font-size:22px;color:#eaf2ff}',
      '#mm .sub{color:#9fb0c8;font-size:13px;line-height:1.7}',
      '#mm .row{display:flex;align-items:center;gap:12px;margin:14px 0}',
      '#mm .av{width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,198,92,.45);background:#0d1421}',
      '#mm .vs{font:900 13px/1 ui-monospace;color:#4ee1ff;letter-spacing:.14em}',
      '#mm .btnrow{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}',
      '#mm button{padding:11px 16px;border-radius:10px;border:1px solid rgba(255,198,92,.5);background:linear-gradient(180deg,rgba(255,198,92,.2),rgba(255,198,92,.07));color:#ffd899;font-size:13.5px;letter-spacing:.04em;cursor:pointer}',
      '#mm button.ghost{border-color:rgba(140,170,210,.36);background:rgba(20,28,44,.7);color:#cfe0ff}',
      '#mm button:disabled{opacity:.45;cursor:not-allowed}',
      '#mm .pulse{width:9px;height:9px;border-radius:50%;background:#4ee1ff;box-shadow:0 0 12px #4ee1ff;animation:mmp 1.4s infinite}',
      '@keyframes mmp{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}',
      '#mm .plan{display:grid;gap:5px;margin:12px 0}',
      '#mm .planrow{padding:7px 10px;border-radius:8px;border:1px solid rgba(140,170,210,.16);background:rgba(12,19,32,.7);font-size:12.5px;color:#8b9ab0}',
      '#mm .planrow.on{border-color:rgba(255,198,92,.5);background:rgba(255,198,92,.07);color:#ffd899}',
      '#mm .planrow.done{border-color:rgba(77,255,166,.32);color:#8ee6b4}',
      '#mm .badge{display:inline-block;padding:3px 8px;margin-left:8px;border-radius:999px;font:600 11px/1.5 ui-monospace;border:1px solid rgba(78,225,255,.4);color:#bfefff}',
      '#mm .boards{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:10px 0 4px}',
      '#mm .board{position:relative;overflow:hidden;border-radius:12px;border:1px solid rgba(140,170,210,.2);background:#0a101b;padding:10px}',
      '#mm .board .grid{position:relative;display:grid;margin:0 auto}',
      '#mm .board .who{font:600 11px/1.6 ui-monospace;color:#9fb0c8;margin-bottom:6px;text-align:center}',
      '#mm .note{font-size:12px;color:#7c8ba1;margin-top:6px}',
      '#mm .flash{color:#4ee1ff}',
      '#mm .res{display:grid;gap:6px;font-size:12.5px}',
      '#mm .resrow{display:grid;grid-template-columns:54px 1fr 66px 66px 60px;gap:8px;padding:7px 10px;border-radius:8px;background:rgba(12,19,32,.7);border:1px solid rgba(140,170,210,.14);color:#c8d6ea}',
      '#mm .resrow.win{border-color:rgba(77,255,166,.4)}',
      '#mm .resrow.lose{border-color:rgba(255,120,120,.35)}',
      '#mm .toast{margin-top:10px;font-size:12.5px;color:#ffd899}',
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- 覆盖层 */
  function shell() {
    injectCss();
    var root = document.getElementById('mm');
    if (root) return root;
    root = el('div'); root.id = 'mm';
    root.innerHTML = '<div class="card" id="mmCard"></div>';
    document.body.appendChild(root);
    return root;
  }
  function show(html) {
    var root = shell();
    root.classList.add('on');
    root.querySelector('#mmCard').innerHTML = html;
    return root.querySelector('#mmCard');
  }
  function close() { var r = document.getElementById('mm'); if (r) r.classList.remove('on'); }

  function stopTimers() {
    if (M.queueTimer) { clearInterval(M.queueTimer); M.queueTimer = 0; }
    if (M.matchTimer) { clearInterval(M.matchTimer); M.matchTimer = 0; }
  }

  /* ---------------------------------------------------------------- 排队 */
  async function start() {
    if (!B || !C2) { alert('前端未就绪，刷新一下'); return; }
    stopTimers();
    M.aborted = false; M.history = []; M.state = null; M.matchId = ''; M.ticket = '';
    M.lastLoadout = -1; M.lastResult = -1; M.running = false;
    M.uid = (B.uid && B.uid()) || '';
    if (!M.uid && B.identity) {
      try { var id = await B.identity(); if (id && id.uid) M.uid = id.uid; } catch (e) { /* ignore */ }
    }
    if (!M.uid) { show('<div class="kick">实时匹配</div><h2>没有账号身份</h2><div class="sub">先去创建你的形象再来匹配。</div><div class="btnrow"><button id="mmClose" class="ghost">关闭</button></div>'); bindClose(); return; }
    M.nick = B.petName() || 'DSH 玩家';
    M.avatarKey = B.petKey() || 'girl';
    M.model = (B.$('modelA') && B.$('modelA').value) || 'deepseek-flash';
    M.effort = B.effort ? B.effort() : 'mid';

    hall('start');
    try {
      var j = await post('/queue/join', { uid: M.uid, nick: M.nick, avatarKey: M.avatarKey, model: M.model, effort: M.effort });
      if (j && j.matched) { await onMatched(j); return; }
      M.ticket = j.ticket || '';
      M.queueSince = Date.now();
      pollQueue();
    } catch (e) {
      hall('error', { message: (e && e.message) || e });
    }
  }

  function pollQueue() {
    stopTimers();
    var tickN = 0;
    M.queueTimer = setInterval(async function () {
      if (M.aborted) return;
      try {
        var r = await get('/queue/poll?uid=' + encodeURIComponent(M.uid));
        if (r.matched) { stopTimers(); await onMatched(r); return; }
        var waited = fmtSec(Date.now() - M.queueSince);
        var online = null;
        if ((tickN++ % 4) === 0) {
          try {
            var h = await get('/health');
            if (h && h.ok && typeof h.players === 'number') online = h.players;
          } catch (e2) { /* 在线人数拿不到就不显示 */ }
        }
        hall('tick', { waited: waited, queue: r.queue || 0, online: online });
      } catch (e) { /* 抖动就下一轮 */ }
    }, QUEUE_POLL_MS);
  }

  /* 取消排队：离开队列 + 收起状态层 */
  async function cancel() {
    stopTimers();
    M.aborted = true;
    try { await post('/queue/leave', { uid: M.uid }); } catch (e) { /* 离线也无所谓 */ }
    close();
    hall('stop');
    M.aborted = false;
  }

  async function onMatched(j) {
    hall('stop');
    M.matchId = j.matchId; M.ticket = j.ticket; M.side = j.side || 'A'; M.opp = j.opponent || null;
    M.queueTimer && clearInterval(M.queueTimer); M.queueTimer = 0;
    show(
      '<div class="kick">配对成功</div>' +
      '<h2>找到对手了</h2>' +
      '<div class="row">' +
        '<img class="av" src="' + B.avatarPath(M.avatarKey) + '" alt=""><span class="sub">' + M.nick + '</span>' +
        '<span class="vs">VS</span>' +
        '<img class="av" src="' + B.avatarPath((M.opp && M.opp.avatarKey) || 'botking') + '" alt=""><span class="sub">' + ((M.opp && M.opp.nick) || '对手') + '</span>' +
      '</div>' +
      '<div class="sub">三局两胜，每局一个家族、每局开始前都能重选大脑。</div>' +
      '<div class="btnrow"><button id="mmGo">进备战屏</button></div>'
    );
    document.getElementById('mmGo').onclick = function () { matchLoop(); };
  }

  /* ---------------------------------------------------------------- 对局 */
  function matchLoop() {
    stopTimers();
    M.matchTimer = setInterval(tickMatch, MATCH_POLL_MS);
    tickMatch();
  }

  async function tickMatch() {
    if (M.aborted) return;
    try {
      var st = await get('/match/' + M.matchId + '?ticket=' + encodeURIComponent(M.ticket));
      M.state = st;
      if (st.finished) { stopTimers(); renderFinal(st); return; }
      if (st.phase === 'loadout' && M.lastLoadout !== st.roundIdx) { M.lastLoadout = st.roundIdx; renderLoadout(st); return; }
      if (st.phase === 'dispatch' && !M.running && M.lastLoadout === st.roundIdx) { M.running = true; runRound(st); return; }
      renderPlaying(st);
    } catch (e) { /* 网络抖动下一轮 */ }
  }

  function famPlan(st) {
    return (st.families || []).map(function (f) {
      var cls = f.idx === st.roundIdx ? 'planrow on' : (f.idx < st.roundIdx ? 'planrow done' : 'planrow');
      return '<div class="' + cls + '"><b>第 ' + (f.idx + 1) + ' 局</b> · ' + f.familyName + ' · ' + f.size + '×' + f.size +
        (f.difficulty ? ' · 难度 ' + f.difficulty : '') + '</div>';
    }).join('');
  }

  function renderLoadout(st) {
    var models = B.models();
    var opts = models.map(function (m) { return '<option value="' + m.id + '">' + m.label + '</option>'; }).join('');
    var card = show(
      '<div class="kick">第 ' + (st.roundIdx + 1) + ' 局 / 共 ' + st.totalRounds + ' 局 · 比分 ' + (st.you.points || 0) + ' : ' + (st.foe.points || 0) + '</div>' +
      '<h2>' + st.round.familyName + '<span class="badge">' + st.round.size + '×' + st.round.size + ' · 难度 ' + st.round.difficulty + ' · 预算 ' + st.round.budget + ' 步</span></h2>' +
      '<div class="plan">' + famPlan(st) + '</div>' +
      '<div class="sub">对手：' + (st.foe.nick || '对手') + '</div>' +
      '<div class="row"><div style="flex:1"><div class="note">这局用哪个大脑</div>' +
      '<select id="mmModel" style="width:100%;padding:9px;border-radius:8px;background:#0d1421;color:#e9f0fb;border:1px solid rgba(140,170,210,.28)">' + opts + '</select></div></div>' +
      '<div class="btnrow"><button id="mmReady">就绪，开始这一局</button></div>'
    );
    var sel = card.querySelector('#mmModel');
    if (sel && M.model) sel.value = M.model;
    // 同步头像
    card.querySelector('#mmReady').onclick = async function () {
      if (sel) M.model = sel.value;
      this.disabled = true; this.textContent = '已就绪，等对手…';
      try {
        await post('/match/' + M.matchId + '/loadout', { ticket: M.ticket, model: M.model, effort: M.effort });
      } catch (e) {
        this.disabled = false; this.textContent = '就绪，开始这一局';
        card.querySelector('.btnrow').innerHTML += '<div class="toast">就绪失败：' + (e.message || e) + '</div>';
      }
    };
  }

  function promptFor(r) {
    var isF5 = !!(r.values && r.values.length) || r.family === 'F5';
    var lines = [];
    lines.push('你在玩「D宠大乐斗」解谜。地图 ' + r.size + '×' + r.size + '，字符含义：# 墙 . 地 S 你的起点 G 终点 K 钥匙 D 门' + (isF5 ? ' X 陷阱（踩到扣分）' : '') + '。');
    lines.push('规则：走到 K 自动拾取钥匙（同一把只算一次）；D 必须按从起点出发的先后顺序打开，开一扇消耗一把钥匙；没有钥匙或顺序不对时撞门算无效；撞墙也算无效。');
    lines.push('步数预算 ' + r.budget + ' 步：超过不会中断，但每多走 1 步都会扣分，所以尽量贴着最短路走。');
    if (r.keysTotal > 0) lines.push('本图有 ' + r.keysTotal + ' 把钥匙、' + r.doorsTotal + ' 扇门；钥匙都放在门的外侧，门只能按从起点出发的先后顺序开。');
    else lines.push('本图没有钥匙和门。');
    if (isF5 && r.values) {
      var lo = (r.gateLo == null ? r.gateSum : r.gateLo), hi = (r.gateHi == null ? r.gateSum : r.gateHi);
      lines.push('本关是「算数门」：沿途累计分值必须落在窗口 [' + lo + ', ' + hi + '] 且走到 G 才算通关；起点格不计分。');
      if (r.maxSteps != null) lines.push('最多 ' + r.maxSteps + ' 步内走到 G；最优 ' + (r.optSteps || '—') + ' 步。');
      lines.push('代价格表（行=北→南，列=西→东，负数=陷阱）：');
      (r.values || []).forEach(function (row) { lines.push('  ' + row.map(function (v) { return String(v).padStart(3, ' '); }).join('')); });
    }
    lines.push('');
    lines.push('地图（第 1 行是最北，第 1 列是最西）：');
    (r.grid || []).forEach(function (row) { lines.push(Array.isArray(row) ? row.join('') : row); });
    lines.push('');
    lines.push('方向：N=上 S=下 E=右 W=左（也认 上/下/左/右）。');
    lines.push('**第一行必须是 PLAN:**（哪怕还要再算，也先把已经能确定的步子写出来，后面再补）；先给答案、再解释，解释写在 CLAIM 之后。不要复述题目、不要复述示例，别把格式说明当成动作。');
    lines.push('PLAN: <方向字母，空格分隔>');
    lines.push('CLAIM: done=1, steps=<实际步数>' + (isF5 ? ', cost=<沿途累计分>' : ''));
    return lines.join('\n');
  }

  function laneSpec(r) {
    // 服务端新版直接给 doorIndex/keyIndex；老版只有坐标对，按数组顺序兜底
    var ki = {}, di = {};
    (r.keys || []).forEach(function (k, i) { ki[k[0] + ',' + k[1]] = (k.keyIndex != null ? k.keyIndex : i); });
    (r.doors || []).forEach(function (d, i) { di[d[0] + ',' + d[1]] = (d.doorIndex != null ? d.doorIndex : i); });
    return {
      family: r.family, size: r.size, grid: r.grid, start: r.start, exit: r.exit,
      keys: (r.keys || []).map(function (k) { return { x: k[0], y: k[1] }; }),
      doors: (r.doors || []).map(function (d) { return { x: d[0], y: d[1] }; }),
      keyIndex: ki, doorIndex: di,
      values: r.values || null, mode: r.values ? 'sum' : '',
      gateLo: (r.gateLo != null ? r.gateLo : r.gateSum), gateHi: (r.gateHi != null ? r.gateHi : r.gateSum),
      budget: r.budget, optSteps: r.optSteps || 0,
      trap: r.trap || null, maxSteps: r.maxSteps == null ? null : r.maxSteps,
    };
  }

  async function runRound(st) {
    var r = st.round;
    var card = show(
      '<div class="kick">第 ' + (st.roundIdx + 1) + ' 局 · ' + r.familyName + '</div>' +
      '<h2>它正在解 <span class="flash">' + r.size + '×' + r.size + '</span> 的图</h2>' +
      '<div class="sub" id="mmPlayNote">使用 ' + (M.model || 'deepseek-flash') + ' · 预算 ' + r.budget + ' 步 · 最优 ' + (r.optSteps || '—') + ' 步</div>' +
      '<div class="boards"><div class="board"><div class="who">' + M.nick + '</div><div class="grid" id="mmBoardA"></div></div>' +
      '<div class="board"><div class="who">' + ((M.opp && M.opp.nick) || '对手') + '</div><div class="grid" id="mmBoardB"></div></div></div>' +
      '<div class="note" id="mmPlayLine">等待对手提交…</div>'
    );
    var ga = card.querySelector('#mmBoardA'), gb = card.querySelector('#mmBoardB');
    var spec = laneSpec(r);
    var va = B.renderMap(ga, spec, B.avatarPath(M.avatarKey), 'A');
    var vb = B.renderMap(gb, spec, B.avatarPath((M.opp && M.opp.avatarKey) || 'botking'), 'B');
    var line = card.querySelector('#mmPlayLine');

    var t0 = Date.now(), text = '', sc = null;
    try {
      var out = await B.callModel(M.model, promptFor(r), M.effort, 2600, CALL_TIMEOUT_MS);
      text = (out && (out.text || out.raw)) || '';
    } catch (e) {
      text = 'PLAN: ' + '';
      if (line) line.textContent = '模型调用失败（' + (e.message || e) + '），本局按未完成提交';
    }
    var ms = Date.now() - t0;
    var parsed = text || '';
    // 没写出 CLAIM、或明显是「想太久被截断」的，按前缀计分提交（服务端 scoreRoundPartial）
    var partial = !/CLAIM/i.test(parsed) || ms > 15000;
    var sim = null;
    try {
      var sub = C2.parseStrict(parsed, {});
      sim = C2.simulate(spec, (sub && (sub.plan || sub.actions)) || []);
      sc = C2.scoreRound(spec, parsed);
    } catch (e) { sim = null; }

    if (sim && sim.actions && sim.actions.length) {
      for (var i = 1; i < sim.actions.length; i++) {
        var a = sim.actions[i];
        if (a.type === 'move' || a.type === 'key' || a.type === 'door') B.placePet(va, a.x, a.y);
        else if (a.type === 'bump') B.bump(va, a.x, a.y);
        if (i % 3 === 0) await sleep(90);
      }
      B.placePet(va, spec.exit[0], spec.exit[1]);
    }
    if (line) line.textContent = '已提交：走 ' + (sim ? sim.used : 0) + ' 步' + (sc ? '，本地预估 S=' + sc.S : '') + '，等对手…';

    try {
      await post('/match/' + M.matchId + '/submit', { ticket: M.ticket, game: st.roundIdx, round: 0, raw: parsed, text: parsed, ms: ms, partial: partial });
    } catch (e) {
      if (line) line.textContent = '提交失败：' + (e.message || e);
    }
    M.running = false;
  }

  function renderPlaying(st) {
    // 已经有战斗面板就不打断它（避免每次轮询闪一下）
    if (document.getElementById('mmBoardA')) {
      var line = document.getElementById('mmPlayLine');
      if (line && st.phase === 'dispatch') line.textContent = st.you.submitted ? '已提交，等对手…' : '正在解…';
      return;
    }
    if (st.phase === 'settle' || (st.history && st.history.length > M.lastResult)) {
      var h = (st.history || [])[st.history.length - 1];
      if (!h) return;
      M.lastResult = st.history.length - 1;
      var mine = st.you.points, foe = st.foe.points;
      show(
        '<div class="kick">第 ' + (h.idx + 1) + ' 局结束</div>' +
        '<h2>' + h.familyName + ' · ' + (h.winner === 'D' ? '平局' : (h.winner === M.side ? '你赢了这一局' : '对手赢了这一局')) + '</h2>' +
        '<div class="sub">你的 S ' + (h.a ? h.a.S : 0) + '（' + (h.a ? h.a.used : 0) + ' 步） vs 对手 S ' + (h.b ? h.b.S : 0) + '（' + (h.b ? h.b.used : 0) + ' 步）</div>' +
        '<div class="sub">当前比分 ' + mine + ' : ' + foe + '</div>' +
        '<div class="btnrow"><button id="mmNext">继续</button></div>'
      );
      document.getElementById('mmNext').onclick = function () { M.running = false; tickMatch(); };
      return;
    }
    show('<div class="kick">对局中</div><h2>等待中…</h2><div class="sub">阶段 ' + st.phase + '</div>');
  }

  function renderFinal(st) {
    var rows = (st.history || []).map(function (h) {
      var win = h.winner === 'D' ? '' : (h.winner === M.side ? ' win' : ' lose');
      var txt = h.winner === 'D' ? '平' : (h.winner === M.side ? '胜' : '负');
      return '<div class="resrow' + win + '"><span>第 ' + (h.idx + 1) + ' 局</span><span>' + h.familyName + '</span>' +
        '<span>S ' + (h.a ? h.a.S : 0) + '</span><span>S ' + (h.b ? h.b.S : 0) + '</span><span>' + txt + '</span></div>';
    }).join('');
    var verdict = st.draw ? '平局' : (st.winner === M.side ? '你赢了这场' : '对手赢了这场');
    show(
      '<div class="kick">整场结束 · 三局两胜</div>' +
      '<h2>' + verdict + '</h2>' +
      '<div class="sub">最终比分 ' + st.you.points + ' : ' + st.foe.points + ' · 对手 ' + (st.foe.nick || '对手') + '</div>' +
      '<div class="res" style="margin-top:14px">' + rows + '</div>' +
      '<div class="btnrow"><button id="mmAgain">再匹配一场</button><button id="mmLobby" class="ghost">回大厅</button></div>'
    );
    document.getElementById('mmAgain').onclick = function () { close(); start(); };
    document.getElementById('mmLobby').onclick = function () { close(); };
  }

  function bindClose() {
    var c = document.getElementById('mmClose');
    if (c) c.onclick = function () { stopTimers(); close(); };
  }

  window.MatchMake = { start: start, cancel: cancel, close: close, state: function () { return M; }, BASE: ARENA_MATCH_BASE };
})();
