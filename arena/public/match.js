/* D宠大乐斗 v2 · Bo3 前端驱动（取代 v1 的一局定胜负流程）
 *
 * 一场 = 三局两胜；每局一个家族 = 三段远征（服务端按 HMAC 派生，双方同图同规则）。
 * 每局开始前给预告卡（家族 / 尺寸 / 难度 / 三局比分），并可重选一次出战模型。
 * 计分 S = 1300 × (0.90Q + 0.10C)，时间不进分。
 *
 * 两种驱动方式：
 *   practice=true  一台机器驱动两边（练习房，服务端发 tokenB，永不进榜）
 *   practice=false 真实双人房：每个标签页只驱动自己那一侧，对手这一段交没交靠 /state 的 live 字段
 *
 * 依赖 window.ARENA_BRIDGE（arena2/index.html 导出）与 window.ArenaCore2（core2.js）。
 */
(function () {
  'use strict';

  var B = window.ARENA_BRIDGE;
  var C2 = window.ArenaCore2;
  var SEG = 3;

  var V = {
    code: '', side: 'A', token: '', tokenB: null, practice: false,
    match: null, results: [], wins: { A: 0, B: 0 },
    me: { modelId: '', modelLabel: '', effort: 'mid' },
    opp: { modelId: '', modelLabel: '', effort: 'mid' },
    playing: false, aborted: false
  };

  function api(p, body) { return B.api(p, body); }
  function statePath(side) {
    return '/api/arena/room/state?code=' + encodeURIComponent(V.code) + '&side=' + (side || V.side);
  }
  function readState() { return api(statePath()); }

  /* ------------------------------------------------------------ 样式 */
  function injectCss() {
    if (document.getElementById('v2css')) return;
    var css = document.createElement('style');
    css.id = 'v2css';
    css.textContent = [
      '.prac-toggle{display:flex;gap:7px;align-items:center;margin-top:9px;font-size:11.5px;color:#8b9ab0;cursor:pointer}',
      '.prac-toggle input{accent-color:#ffc65c}',
      '#v2preview{position:fixed;inset:0;z-index:60;display:none;place-items:center;background:rgba(4,7,14,.86);backdrop-filter:blur(6px)}',
      '#v2preview.on{display:grid}',
      '#v2preview .card{width:min(560px,92vw);border:1px solid rgba(255,198,92,.28);border-radius:16px;background:linear-gradient(180deg,rgba(18,26,42,.98),rgba(10,15,26,.98));padding:26px 28px;box-shadow:0 30px 90px rgba(0,0,0,.6)}',
      '#v2preview .kick{font:600 11px/1 ui-monospace;letter-spacing:.18em;color:#ffc65c;text-transform:uppercase}',
      '#v2preview h2{margin:10px 0 6px;font-size:24px;letter-spacing:.02em;color:#eaf2ff}',
      '#v2preview .fam{color:#4ee1ff;font-size:13px;margin-bottom:14px}',
      '#v2preview .rows{display:grid;gap:6px;margin:14px 0 18px;font-size:12.5px;color:#9fb0c8;line-height:1.7}',
      '#v2preview .rows b{color:#e9f0fb;font-weight:600}',
      '#v2preview .plan{display:grid;gap:5px;margin:12px 0 14px}',
      '#v2preview .planrow{padding:7px 10px;border-radius:8px;border:1px solid rgba(140,170,210,.16);background:rgba(12,19,32,.7);font-size:12.5px;color:#8b9ab0}',
      '#v2preview .planrow b{color:#c8d6ea;font-weight:600}',
      '#v2preview .planrow.on{border-color:rgba(255,198,92,.5);background:rgba(255,198,92,.07);color:#ffd899}',
      '#v2preview .planrow.on b{color:#ffd899}',
      '#v2preview .planrow.done{border-color:rgba(77,255,166,.32);color:#8ee6b4}',
      '#v2preview .segpill{display:inline-block;padding:3px 8px;margin-right:6px;border-radius:999px;border:1px solid rgba(140,170,210,.22);font:600 11px/1.5 ui-monospace;color:#9fb0c8}',
      '#v2preview .picks{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}',
      '#v2preview label{display:block;font-size:11px;color:#7c8ba1;margin:0 0 4px;letter-spacing:.06em}',
      '#v2preview select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(140,170,210,.28);background:#0d1421;color:#e9f0fb;font-size:12.5px}',
      '#v2preview .go{width:100%;padding:11px;border-radius:10px;border:1px solid rgba(255,198,92,.55);background:linear-gradient(180deg,rgba(255,198,92,.22),rgba(255,198,92,.08));color:#ffd899;font-size:14px;letter-spacing:.08em;cursor:pointer}',
      '#v2preview .go:hover{background:rgba(255,198,92,.28)}',
      '#v2preview .wait{margin-top:10px;font-size:12px;color:#8b9ab0;text-align:center}',
      '#v2strip{display:flex;gap:8px;align-items:center;justify-content:center;margin:2px 0 10px;font:600 11px/1 ui-monospace;color:#7c8ba1}',
      '#v2strip .seg{padding:5px 9px;border-radius:999px;border:1px solid rgba(140,170,210,.22);min-width:74px;text-align:center}',
      '#v2strip .seg.on{border-color:rgba(78,225,255,.6);color:#bfefff;background:rgba(78,225,255,.08)}',
      '#v2strip .seg.done{color:#8ee6b4;border-color:rgba(77,255,166,.4)}',
      '#v2strip .games{margin-left:10px;color:#ffd899}',
      '#v2banner{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:58;padding:14px 26px;border-radius:14px;border:1px solid rgba(255,198,92,.4);background:rgba(10,15,26,.95);color:#ffd899;font:600 15px/1.4 system-ui;text-align:center;display:none}',
      '#v2banner.on{display:block}',
      '#v2banner .mdl{margin-top:6px;font:600 12px/1.3 ui-monospace;color:#9db4cc;letter-spacing:.2px}',
      '#v2result td.mdl{font:600 11px/1.35 ui-monospace;color:#a9bed6}',
      '#v2result .mset{margin-top:12px;font:600 12px/1.6 ui-monospace;color:#9db4cc}',
      '#v2result .mset b{color:#ffd899;font-weight:700}',
      '#v2result .mset .who{color:#7c8ba1;font-weight:500;margin-left:6px}',
      '#v2result{position:fixed;inset:0;z-index:62;display:none;place-items:center;background:rgba(4,7,14,.92)}',
      '#v2result.on{display:grid}',
      '#v2result .card{width:min(820px,95vw);border:1px solid rgba(255,198,92,.28);border-radius:18px;background:linear-gradient(180deg,rgba(18,26,42,.99),rgba(9,13,22,.99));padding:28px 30px}',
      '#v2result h2{margin:6px 0 4px;font-size:30px;color:#eaf2ff}',
      '#v2result .sub{color:#9fb0c8;font-size:13px;margin-bottom:16px}',
      '#v2result table{width:100%;border-collapse:collapse;font-size:12.5px;color:#cfe0f5;table-layout:auto}',
      '#v2result th,#v2result td{padding:8px 7px;border-bottom:1px solid rgba(140,170,210,.14);text-align:left;white-space:nowrap}',
      '#v2result th{color:#7c8ba1;font-weight:600;font-size:11px;letter-spacing:.08em}',
      '#v2result td.mdl{white-space:normal;min-width:112px}',
      '#v2result td .rs{display:block;margin-top:2px}',
      '#v2result td.win{color:#ffd899;font-weight:700}',
      '.cell[data-v]::before{content:attr(data-v);position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:700 11px/1 ui-monospace;color:#ffe3a1;text-shadow:0 0 7px rgba(0,0,0,.9);z-index:3}',
      '#v2result .again{margin-top:18px;padding:10px 18px;border-radius:10px;border:1px solid rgba(140,170,210,.3);background:transparent;color:#cfe0f5;cursor:pointer}'
    ].join('\n');
    document.head.appendChild(css);
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function option(sel, items, value) {
    if (!sel) return;
    sel.innerHTML = items.map(function (it) {
      var v = it.id != null ? it.id : it.v;
      var t = it.label != null ? it.label : it.t;
      return '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
  }

  function banner(text, ms, sub) {
    var b = document.getElementById('v2banner');
    if (!b) { b = el('div'); b.id = 'v2banner'; document.body.appendChild(b); }
    b.textContent = '';
    var l1 = el('div'); l1.textContent = text; b.appendChild(l1);
    if (sub) { var l2 = el('div'); l2.className = 'mdl'; l2.textContent = sub; b.appendChild(l2); }
    b.classList.add('on');
    if (ms) setTimeout(function () { b.classList.remove('on'); }, ms);
  }

  /** 模型可读名（后端给的是 label，兜底再查一次模型表） */
  function mdLabel(x) {
    if (!x) return '未选模型';
    if (typeof x === 'object') return mdLabel(x.modelLabel || x.modelId);
    var hit = (B.models() || []).filter(function (m) { return m.id === x; })[0];
    return hit ? hit.label : x;
  }

  /* ------------------------------------------------------------ 每局预告卡 */
  /** 三局安排（家族开局前就定好）：预告卡一次列全，避免出现「三局都是同一家族」的误读 */
  function planHtml(gi) {
    var plan = V.plan || [];
    if (!plan.length) {
      plan = (V.match || []).map(function (g, i) { return { idx: i, familyLabel: g.familyLabel, diff: g.diff || 0, size: g.rounds[0] ? g.rounds[0].size : 0, ready: true }; });
    }
    return '<div class="plan">' + plan.map(function (p) {
      var cls = p.idx === gi ? 'planrow on' : (V.results.some(function (r) { return r.idx === p.idx; }) ? 'planrow done' : 'planrow');
      var tail = p.ready && p.diff ? ('d' + p.diff + '（' + p.size + '×' + p.size + '）') : '待开局';
      return '<div class="' + cls + '"><b>第 ' + (p.idx + 1) + ' 局</b> · ' + p.familyLabel + ' · ' + tail + '</div>';
    }).join('') + '</div>';
  }

  function previewCard(gi) {
    injectCss();
    var game = V.match[gi];
    var box = document.getElementById('v2preview');
    if (!box) { box = el('div'); box.id = 'v2preview'; document.body.appendChild(box); }

    var segs = game.rounds.map(function (r, i) {
      return '<span class="segpill">段' + (i + 1) + ' · ' + r.size + '×' + r.size + '</span>';
    }).join('');
    var models = B.models();
    if (!V.me.modelId) {
      V.me.modelId = B.$('modelA').value;
      V.me.modelLabel = B.labelOf(V.me.modelId);
      V.me.effort = B.effort();
    }
    if (!V.practice) {
      // 真实对局：对手模型由对方账号选，只展示
      V.opp.modelLabel = (V.opp.modelLabel || '对手');
    }
    box.innerHTML =
      '<div class="card">' +
      '<div class="kick">第 ' + (gi + 1) + ' 局 / 三局两胜 · 比分 ' + V.wins.A + ' : ' + V.wins.B + '</div>' +
      '<h2>' + game.familyLabel + '</h2>' +
      '<div class="fam">' + (game.diff ? ('本局难度 d' + game.diff + '（' + game.rounds[0].size + '×' + game.rounds[0].size + '）') : ('本局难度 ' + game.difficulty)) + ' · 三局家族不重复，同一局双方同图同规则</div>' +
      planHtml(gi) +
      '<div class="rows">本局 3 段：' + segs + '</div>' +
      '<div class="picks">' +
      '<div><label>' + (V.practice ? '我方模型' : '你的模型') + '</label><select id="v2mA"></select></div>' +
      (V.practice
        ? '<div><label>对面（练习用）</label><select id="v2mB"></select></div>'
        : '<div><label>对手</label><div style="padding:8px 10px;border:1px dashed rgba(140,170,210,.24);border-radius:8px;color:#9fb0c8;font-size:12.5px">' + (V.opp.modelLabel || '对手') + '</div></div>') +
      '</div>' +
      '<button class="go" id="v2go">开始第 ' + (gi + 1) + ' 局</button>' +
      (V.practice ? '' : '<div class="wait" id="v2wait">双方各自选好后开打，谁先点都会等对方这一段提交</div>') +
      '</div>';

    option(box.querySelector('#v2mA'), models, V.me.modelId);
    if (V.practice) {
      option(box.querySelector('#v2mB'), models, V.opp.modelId || V.me.modelId);
    }
    box.classList.add('on');

    return new Promise(function (resolve) {
      box.querySelector('#v2go').onclick = function () {
        var mA = box.querySelector('#v2mA').value;
        V.me = { modelId: mA, modelLabel: B.labelOf(mA), effort: V.me.effort || 'mid' };
        if (V.practice) {
          var mB = box.querySelector('#v2mB').value;
          V.opp = { modelId: mB, modelLabel: B.labelOf(mB), effort: V.opp.effort || 'mid' };
        }
        box.classList.remove('on');
        resolve();
      };
    });
  }

  /* ------------------------------------------------------------ 对战屏 */
  function strip(gi, ri, scA, scB) {
    var host = document.getElementById('v2strip');
    if (!host) {
      var battle = document.getElementById('scr-battle');
      if (!battle) return;
      host = el('div'); host.id = 'v2strip';
      var head = battle.querySelector('.battle-head');
      if (head && head.nextSibling) battle.insertBefore(host, head.nextSibling);
      else battle.insertBefore(host, battle.firstChild);
    }
    var html = '';
    for (var i = 0; i < SEG; i++) {
      var cls = 'seg' + (i === ri ? ' on' : '') + (i < ri ? ' done' : '');
      html += '<span class="' + cls + '">段' + (i + 1) + ' ' + (scA[i] == null ? '—' : scA[i]) + ':' + (scB[i] == null ? '—' : scB[i]) + '</span>';
    }
    html += '<span class="games">第 ' + (gi + 1) + ' 局 · ' + V.wins.A + ':' + V.wins.B + '</span>';
    host.innerHTML = html;
  }

  function bindLanes() {
    var A = B.meta.A, Bm = B.meta.B;
    B.$('avaA').src = A.src; B.$('avaB').src = Bm.src;
    B.$('nameA').textContent = A.nick; B.$('nameB').textContent = Bm.nick;
    B.$('modelA2').textContent = A.modelLabel;
    B.$('modelB2').textContent = Bm.modelLabel;
    B.$('bRoom').textContent = (V.practice ? '练习房 ' : '房间 ') + V.code;
    B.$('laneA').className = 'lane panel active';
    B.$('laneB').className = 'lane panel active';
    ['mv', 'sec', 'bad', 'tok'].forEach(function (k) { B.$(k + 'A').textContent = '—'; B.$(k + 'B').textContent = '—'; });
    B.$('pfillA').style.width = '0%'; B.$('pfillB').style.width = '0%';
    B.$('pnumA').textContent = '0%'; B.$('pnumB').textContent = '0%';
  }

  /* ------------------------------------------------------------ 单段 */
  function fetchBrief(gi, ri) {
    return api('/api/arena/room/brief?code=' + encodeURIComponent(V.code) + '&game=' + gi + '&round=' + ri)
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || 'brief-failed');
        return d;
      });
  }

  function submitRound(gi, ri, side, token, call, rawSnap, timeout) {
    return api('/api/arena/room/submit', {
      code: V.code, side: side, token: token, game: gi, round: ri,
      raw: (call && call.text) || '', rawSnap: rawSnap == null ? null : String(rawSnap),
      timeout: !!timeout, ms: (call && call.ms) || 0, usage: (call && call.usage) || null
    }).catch(function () { return null; });
  }

  /** 真实双人房：等对方把这一段交上来，只读分数不读动作 */
  async function waitOppRound(gi, ri, timeoutMs) {
    var other = V.side === 'A' ? 'B' : 'A';
    var t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 60000)) {
      var st = await readState();
      if (st && st.games && st.games[gi] && st.games[gi].result) return { done: true, S: null, gameOver: true };
      var live = st && st.live;
      if (live && live.game === gi && live[other] && live[other][ri] && live[other][ri].in) {
        return { done: true, S: live[other][ri].S };
      }
      await B.sleep(1200);
    }
    return { done: false };
  }

  // F5 算数门：代价格必须画在格子上，否则玩家看不到怎么攒分
  function paintValues(view, spec) {
    if (!spec || spec.mode !== 'sum' || !spec.values || !view || !view.el) return;
    for (var y = 0; y < spec.size; y++) {
      for (var x = 0; x < spec.size; x++) {
        var v = spec.values[y] && spec.values[y][x];
        if (!v) continue;
        var cell = view.el.querySelector('[data-x="' + x + '"][data-y="' + y + '"]');
        if (cell) cell.setAttribute('data-v', v);
      }
    }
  }

  var warnedStreamFallback = false;

  /** 单段流式采集：软截止记快照，硬截止保留已流出前缀；不可用时回退 callModel。 */
  async function collectRound(modelId, prompt, effort, maxTokens, brief, lane, ri) {
    var tag = '第 ' + (ri + 1) + ' 段 · ';
    var log = B.$('log' + lane);
    var softMs = Number(brief && brief.softMs) || 0;
    var hardMs = Number(brief && (brief.hardMs || brief.timeoutMs)) || 25000;
    var t0 = performance.now();
    var acc = '', snap = null, snapped = false, finished = false;
    if (log) log.textContent = tag + '采集中';
    B.setStatusChip(lane, '采集中', 'solving');
    ['mv', 'sec', 'bad', 'tok'].forEach(function (k) {
      var cell = B.$(k + lane); if (cell) cell.textContent = '—';
    });
    var fill = B.$('pfill' + lane), pnum = B.$('pnum' + lane);
    if (fill) fill.style.width = '0%';
    if (pnum) pnum.textContent = '0%';

    function softMark(prefix) {
      if (finished || snapped) return;
      snapped = true; snap = prefix;
      if (log) log.textContent = tag + '软截止·收尾中';
      B.setStatusChip(lane, '软截止·收尾中', 'play');
    }
    var softTimer = softMs > 0 ? setTimeout(function () { softMark(acc); }, softMs) : null;

    if (typeof B.streamChat !== 'function') {
      if (!warnedStreamFallback) {
        warnedStreamFallback = true;
        console.warn('[arena2] 桥接层没有 streamChat，回退非流式 callModel');
      }
      var fb = await B.callModel(modelId, prompt, effort, maxTokens, hardMs);
      if (softTimer) clearTimeout(softTimer);
      if (log) log.textContent = tag + '采集中（非流式回退）';
      return { call: fb, rawSnap: null, timeout: false, fallback: true, ms: fb.ms };
    }

    var res = await B.streamChat({
      model: modelId, messages: [
        { role: 'system', content: '你是迷宫求解器。可以先推理，但回复的最后一行必须是非空的 <PLAN>方向 方向 …</PLAN>，方向只用单个 N/S/E/W。' },
        { role: 'user', content: prompt }
      ],
      maxTokens: maxTokens, effort: effort, hardMs: hardMs
    }, function (delta, whole) {
      acc = whole;
      if (finished) return;
      if (performance.now() - t0 >= softMs) softMark(whole);
      if (log) log.textContent = tag + '采集中 · 已收 ' + whole.length + ' 字';
      var sec = B.$('sec' + lane);
      if (sec) sec.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
    });
    finished = true;
    if (softTimer) clearTimeout(softTimer);

    if (!res.ok) {
      if (!warnedStreamFallback) {
        warnedStreamFallback = true;
        console.warn('[arena2] /api/pet-llm/stream 不可用，回退 callModel：', res.error || 'unknown');
      }
      if (log) log.textContent = tag + '采集中（非流式回退）';
      var call = await B.callModel(modelId, prompt, effort, maxTokens, hardMs);
      return { call: call, rawSnap: null, timeout: false, fallback: true, ms: call.ms };
    }

    var ms = performance.now() - t0;
    var finalText = res.text != null ? res.text : acc;
    var hardTimeout = !!res.aborted;
    if (hardTimeout) {
      var voidOut = !String(finalText || '').trim() && !String(snap || '').trim();
      if (log) log.textContent = tag + (voidOut ? '硬截止·无有效输出（不计分）' : '硬截止·按已流出内容计分');
      B.setStatusChip(lane, voidOut ? '无有效输出' : '硬截止·按已流出内容计分', 'fail');
      await B.sleep(800);
    } else if (log) {
      log.textContent = tag + (finalText ? '收尾完成' : '无输出');
    }
    return {
      call: { text: finalText, ms: ms, usage: res.usage || null },
      rawSnap: snapped ? snap : null, timeout: hardTimeout, fallback: false, ms: ms
    };
  }

  async function playRound(gi, ri, scoresA, scoresB) {
    var brief = await fetchBrief(gi, ri);
    var spec = brief.spec;
    var myLane = V.side, oppLane = V.side === 'A' ? 'B' : 'A';
    var myLog = myLane === 'A' ? B.$('logA') : B.$('logB');
    var oppLog = oppLane === 'A' ? B.$('logA') : B.$('logB');
    B.views.A = B.renderMap(B.$('gridA'), spec, B.meta.A.src, 'A');
    B.views.B = B.renderMap(B.$('gridB'), spec, B.meta.B.src, 'B');
    paintValues(B.views.A, spec); paintValues(B.views.B, spec);
    B.$('bRound').textContent = (gi + 1) + '.' + (ri + 1);
    myLog.textContent = '第 ' + (ri + 1) + ' 段 · 采集中';
    oppLog.textContent = '第 ' + (ri + 1) + ' 段 · ' + (V.practice ? '待开始' : '等对手');
    B.setStatusChip(myLane, '采集中', 'solving');
    B.setStatusChip(oppLane, V.practice ? '待开始' : '等对手', 'solving');
    B.say('第 ' + (gi + 1) + ' 局 第 ' + (ri + 1) + ' 段：' + brief.family + '（' + spec.size + '×' + spec.size + '，步数上限 ' + spec.budget + '）');

    // 自己的调用（流式采集 + 软/硬截止）
    var mine = await collectRound(V.me.modelId, brief.prompt, V.me.effort, B.maxFor(V.me.modelId, V.me.effort), brief, myLane, ri);
    var mineCall = mine.call;
    var mySub = await submitRound(gi, ri, V.side, V.token, mineCall, mine.rawSnap, mine.timeout);
    var myScore = mySub && mySub.mine ? mySub.mine.S : 0;
    var myVoid = !!(mine.timeout && !String(mineCall && mineCall.text || '').trim());

    // 对手：练习房自己打，真实房等对方提交
    var oppCall = null, oppScore = null, oppVoid = false;
    if (V.practice) {
      var opp = await collectRound(V.opp.modelId, brief.prompt, V.opp.effort, B.maxFor(V.opp.modelId, V.opp.effort), brief, oppLane, ri);
      oppCall = opp.call;
      var oppSub = await submitRound(gi, ri, oppLane, V.tokenB, oppCall, opp.rawSnap, opp.timeout);
      oppScore = oppSub && oppSub.mine ? oppSub.mine.S : 0;
      oppVoid = !!(opp.timeout && !String(oppCall && oppCall.text || '').trim());
    } else {
      B.setStatusChip(oppLane, '等对手', 'solving');
      var w = await waitOppRound(gi, ri, 60000);
      if (!w.done) { banner('对手这一段没有提交，对局中断', 6000); V.aborted = true; return { aborted: true }; }
      oppScore = w.S;
    }

    // 播放：自己的宠物走一遍（练习房两边都走）
    var myParsed = C2.parseSubmission(mineCall ? mineCall.text : '');
    var mySim = C2.simulate(spec, myParsed.plan);
    B.$('mv' + myLane).textContent = mySim.used; B.$('bad' + myLane).textContent = mySim.invalid;
    B.$('tok' + myLane).textContent = B.tokOf({ usage: mineCall && mineCall.usage });
    B.$('sec' + myLane).textContent = B.fmtMs(mineCall && mineCall.ms);
    B.setStatusChip(myLane, '播放中', 'play');
    B.$('pfill' + myLane).parentNode.classList.remove('solving');
    var jobs = [B.playLane(myLane, B.views[myLane], mySim, { plan: myParsed.plan }, B.meta[myLane].nick)];
    if (V.practice && oppCall) {
      var oParsed = C2.parseSubmission(oppCall.text || '');
      var oSim = C2.simulate(spec, oParsed.plan);
      B.$('mv' + oppLane).textContent = oSim.used; B.$('bad' + oppLane).textContent = oSim.invalid;
      B.$('tok' + oppLane).textContent = B.tokOf({ usage: oppCall.usage });
      B.$('sec' + oppLane).textContent = B.fmtMs(oppCall.ms);
      B.setStatusChip(oppLane, '播放中', 'play');
      B.$('pfill' + oppLane).parentNode.classList.remove('solving');
      jobs.push(B.playLane(oppLane, B.views[oppLane], oSim, { plan: oParsed.plan }, B.meta[oppLane].nick));
    } else {
      oppLog.textContent = '已提交 · ' + (oppScore == null ? '结算中' : 'S ' + oppScore);
      B.setStatusChip(oppLane, '已提交', 'ok');
    }
    await Promise.all(jobs);
    await B.sleep(300);

    if (V.side === 'A') { scoresA[ri] = myScore; scoresB[ri] = oppScore; }
    else { scoresB[ri] = myScore; scoresA[ri] = oppScore; }
    strip(gi, ri + 1, scoresA, scoresB);
    var myShown = myVoid ? '无有效输出（不计分）' : myScore;
    var oppShown = oppVoid ? '无有效输出（不计分）' : (oppScore == null ? '—' : oppScore);
    banner('段 ' + (ri + 1) + '　你 ' + myShown + ' : 对手 ' + oppShown, 1900,
      '你 ' + mdLabel(V.me.modelLabel) + '　vs　' + mdLabel(V.opp.modelLabel));
    await B.sleep(900);
    return { myScore: myScore, oppScore: oppScore };
  }

  /* ------------------------------------------------------------ 一局 */
  async function waitGameResult(gi, timeoutMs) {
    var t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 90000)) {
      var st = await readState();
      if (st && st.games && st.games[gi] && st.games[gi].result) {
        return st.games[gi].result;
      }
      if (st && st.status === 'done') return null;
      await B.sleep(1500);
    }
    return null;
  }

  async function runGame(gi) {
    // 家族在开局前就定好，档位按当时比分：开打前刷一次，预告卡才能列全三局
    try {
      var pre = await readState(V.side);
      if (pre && pre.plan) { V.plan = pre.plan; }
      if (pre && pre.games && pre.games.length) { V.match = pre.games; }
    } catch (e) { /* 读不到就沿用 boot 的值 */ }
    await previewCard(gi);
    try {
      await api('/api/arena/room/pick', {
        code: V.code, side: V.side, token: V.token, game: gi,
        modelId: V.me.modelId, modelLabel: V.me.modelLabel, effort: V.me.effort
      });
    } catch (e) { /* 展示用，失败不影响判定 */ }
    if (V.practice) {
      try {
        await api('/api/arena/room/pick', {
          code: V.code, side: V.side === 'A' ? 'B' : 'A', token: V.tokenB, game: gi,
          modelId: V.opp.modelId, modelLabel: V.opp.modelLabel, effort: V.opp.effort
        });
      } catch (e) { /* 同上 */ }
    }

    var meMeta = {
      nick: B.petName(), src: B.avatarPath(B.petKey()), avatarKey: B.petKey(),
      modelLabel: V.me.modelLabel, effort: V.me.effort
    };
    var oppMeta = {
      nick: V.opp.nick || '对手', src: B.avatarPath(V.opp.avatarKey || 'botking'), avatarKey: V.opp.avatarKey || 'botking',
      modelLabel: V.opp.modelLabel || '对手', effort: V.opp.effort
    };
    // 车道 A/B 是全局视角：自己在哪边由 V.side 决定
    B.meta.A = V.side === 'A' ? meMeta : oppMeta;
    B.meta.B = V.side === 'A' ? oppMeta : meMeta;
    bindLanes();
    B.setScreen('battle');

    var scoresA = [], scoresB = [];
    for (var ri = 0; ri < SEG; ri++) {
      if (V.aborted) break;
      strip(gi, ri, scoresA, scoresB);
      var out = await playRound(gi, ri, scoresA, scoresB);
      if (out.aborted) break;
    }

    var res = null;
    if (!V.aborted) {
      banner('这一局结算中…', 4000);
      res = await waitGameResult(gi);
    }
    var winner = res ? res.winner : 'D';
    var models = {
      A: V.side === 'A' ? mdLabel(V.me.modelLabel) : mdLabel(V.opp.modelLabel),
      B: V.side === 'B' ? mdLabel(V.me.modelLabel) : mdLabel(V.opp.modelLabel)
    };
    V.results[gi] = {
      idx: gi,
      models: models,
      modelIds: {
        A: V.side === 'A' ? V.me.modelId : V.opp.modelId,
        B: V.side === 'B' ? V.me.modelId : V.opp.modelId
      },
      familyLabel: V.match[gi].familyLabel,
      difficulty: V.match[gi].difficulty,
      S: res ? res.S : { A: scoresA.reduce(function (a, b) { return a + (b || 0); }, 0), B: scoresB.reduce(function (a, b) { return a + (b || 0); }, 0) },
      winner: winner,
      roundsA: scoresA.slice(), roundsB: scoresB.slice()
    };
    V.wins = recount();
    var myS = V.results[gi].S[V.side], oppS = V.results[gi].S[V.side === 'A' ? 'B' : 'A'];
    banner('第 ' + (gi + 1) + ' 局 ' + (winner === 'D' ? '平局' : winner + ' 胜') + '　S ' + myS + ' : ' + oppS, 2400,
      '你 ' + models[V.side] + '　vs　对手 ' + models[V.side === 'A' ? 'B' : 'A']);
    await B.sleep(2600);
  }

  /* ------------------------------------------------------------ 整场 */
  async function runMatch() {
    V.playing = true;
    for (var gi = 0; gi < 3; gi++) {
      if (V.aborted) break;
      if (V.wins.A >= 2 || V.wins.B >= 2) break;
      if (!V.match[gi]) break;
      await runGame(gi);
    }
    V.playing = false;
    showFinal();
  }

  function recount() {
    var w = { A: 0, B: 0 };
    V.results.forEach(function (r) { if (r && r.winner === 'A') w.A++; else if (r && r.winner === 'B') w.B++; });
    return w;
  }

  /** 整场双方各自用过的模型集合（去重，按局顺序；A / B 为全局车道） */
  function modelSetHtml() {
    var setA = [], setB = [];
    V.results.filter(Boolean).forEach(function (r) {
      if (!r.models) return;
      var a = r.models.A || '', b = r.models.B || '';
      if (a && setA.indexOf(a) < 0) setA.push(a);
      if (b && setB.indexOf(b) < 0) setB.push(b);
    });
    return 'A 方 用过 <b>' + (setA.join(' / ') || '—') + '</b>　·　B 方 用过 <b>' + (setB.join(' / ') || '—') + '</b>'
      + '<span class="who">（你是 ' + V.side + ' 方' + (V.side === 'A' ? '，即左边' : '，即右边') + '）</span>';
  }

  function showFinal() {
    injectCss();
    var win = V.wins.A > V.wins.B ? 'A' : V.wins.B > V.wins.A ? 'B' : 'D';
    var box = document.getElementById('v2result');
    if (!box) { box = el('div'); box.id = 'v2result'; document.body.appendChild(box); }
    var myWin = win === V.side;
    var oppSide = V.side === 'A' ? 'B' : 'A';
    var rows = V.results.filter(Boolean).map(function (r) {
      var w = r.winner === 'D' ? '平' : (r.winner === V.side ? '你胜' : '对手胜');
      var mine = (r.models && r.models[V.side]) || '—';
      var theirs = (r.models && r.models[oppSide]) || '—';
      var myRounds = ((r.roundsA && r.roundsB) ? (V.side === 'A' ? r.roundsA : r.roundsB) : []).join(' / ') || '—';
      var oppRounds = ((r.roundsA && r.roundsB) ? (V.side === 'A' ? r.roundsB : r.roundsA) : []).join(' / ') || '—';
      var myS = r.S && r.S[V.side] != null ? r.S[V.side] : '—';
      var oppS = r.S && r.S[oppSide] != null ? r.S[oppSide] : '—';
      var winCls = r.winner === V.side ? ' class="win"' : '';
      return '<tr><td>第 ' + (r.idx + 1) + ' 局</td><td>' + r.familyLabel + (r.diff ? ' · d' + r.diff : ' · 难度 ' + r.difficulty) + '</td><td class="mdl">' + mine + '</td><td class="mdl">' + theirs + '</td><td>' +
        myRounds + '</td><td>' + oppRounds + '</td><td' + winCls + '>你 ' + myS + ' : ' + oppS + '<span class="rs">' + w + '</span></td></tr>';
    }).join('');
    var myWins = V.wins[V.side] || 0, oppWins = V.wins[V.side === 'A' ? 'B' : 'A'] || 0;
    var title = V.aborted ? '对局中断' : (win === 'D' ? '平局' : (myWin ? '你赢了' : '你输了'));
    box.innerHTML = '<div class="card">' +
      '<div class="kick">BO3 · 结算 · ' + (V.practice ? '练习房（不进榜）' : '真人对局') + '</div>' +
      '<h2>' + title + '</h2>' +
      '<div class="sub">三局比分 你 ' + myWins + ' : ' + oppWins + ' 对手 · S = 1300×(0.90Q+0.10C)，时间不进分' +
      (V.practice ? ' · 练习房不计入排行榜' : '') + '</div>' +
      '<table><thead><tr><th>局</th><th>家族 / 难度</th><th>你的模型</th><th>对手模型</th><th>你的各段 S</th><th>对手各段 S</th><th>局分 / 结果</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      '<div class="mset">本场模型 · ' + modelSetHtml() + '</div>' +
      '<button class="again" id="v2again">再来一场</button></div>';
    box.classList.add('on');
    box.querySelector('#v2again').onclick = function () { location.reload(); };
  }

  /* ------------------------------------------------------------ 入口 */
  async function boot(payload) {
    injectCss();
    V.code = payload.code;
    V.side = payload.side || 'A';
    V.token = payload.token;
    V.tokenB = payload.tokenB || null;
    V.practice = !!payload.practice;
    V.results = []; V.wins = { A: 0, B: 0 }; V.aborted = false;

    var st = await readState(V.side);
    if (!st || !st.ok) { banner('房间状态读取失败', 5000); return; }
    V.match = st.games || [];
    V.plan = st.plan || [];
    V.wins = recount();
    if (st.opponent) {
      V.opp.nick = st.opponent.nick;
      V.opp.avatarKey = st.opponent.avatarKey;
      V.opp.modelLabel = st.opponent.modelLabel || '对手';
      V.opp.effort = st.opponent.effort || 'mid';
    }
    V.me.modelId = B.$('modelA').value;
    V.me.modelLabel = B.labelOf(V.me.modelId);
    V.me.effort = B.effort();
    if (V.practice) {
      V.opp.modelId = (B.$('modelB') && B.$('modelB').value) || 'deepseek-flash';
      V.opp.modelLabel = B.labelOf(V.opp.modelId);
      V.opp.effort = 'mid';
      V.opp.nick = '对手 · 练习';
      V.opp.avatarKey = 'botking';
    }
    await runMatch();
  }

  window.V2 = {
    beginRoom: function (payload) { boot(payload).catch(function (e) { banner('开局失败：' + (e && e.message || e), 6000); }); },
    state: V
  };
})();
