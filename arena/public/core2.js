/* D宠大乐斗 2.0 · 大乐斗核心 v2.1（Fable 5.2 校准版，纯函数 / 浏览器 + node 通用，零依赖）
 *
 * 产出模型：DeepSeek V4.1 Flash（执行）
 *
 * 口径（唯一）：deliverables/bot-office-community/reports/2026-11-12-arena-calib-impl-fable.md
 * 配套：reports/2026-11-12-arena-calib-fable.md §2/§3/§6（冲突时以 impl 裁决为准）
 *
 * 与 v2.0 的差异：
 *   1) parseStrict：只认 <PLAN>…</PLAN> 或 PLAN 行；没有 PLAN 标记 → 不可解析 S=0；删除散文 salvage
 *   2) n_eff：按 (x,y,keys,opened) 全状态 BFS，取执行轨迹上 dist 最大的状态（平手取较晚那步）
 *   3) 评分：P=g^0.9（未到点 ×0.7）、V=0.65^bad × 0.6^excess、R=到点 0.5·stepEff+0.5·credits、
 *      Q=Q_raw·(0.70+0.30·到达)、C 四档、S=round(1300·(0.90Q+0.10C))；超预算步不再截断
 *   4) judgeRound：到达 → |ΔS|≥8 → 剩余步数 → n_eff → 平；整场 decide |ΔS|≥13
 *   5) 家族：F1 7×7 恒 opt=9/b=11；F2 9×9 双钥双门顺序 + 可选第三钥 b=opt+3；
 *      F3 9×9 b=n_star+1 + 假支路；F5 9×9 算数窗口 [29,37] / 陷阱 X / b=n_star+5
 *
 * 地图字符：'#'墙 '.'地 'S'起点 'G'终点 'K'钥匙 'D'门 'X'陷阱（负代价，仅 F5）
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ 基础 */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var DIRS = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  var DIRLIST = ['N', 'S', 'W', 'E'];
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clone(g) { return g.map(function (r) { return r.slice(); }); }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function key2(x, y) { return x + ',' + y; }
  function skey(x, y, k, o, m) { return x + ',' + y + ',' + k + ',' + o + ',' + (m || 0); }
  function adjacent(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= 1; }

  /* ------------------------------------------------------------ 地图 */

  // 完美迷宫（递归回溯）+ 2~4 处随机破墙（可能形成环）
  function carve(size, rnd) {
    var g = [], y, x;
    for (y = 0; y < size; y++) g.push(new Array(size).fill('#'));
    var stack = [[1, 1]];
    g[1][1] = '.';
    while (stack.length) {
      var cur = stack[stack.length - 1], cx = cur[0], cy = cur[1], opts = [];
      [[0, -2], [0, 2], [-2, 0], [2, 0]].forEach(function (d) {
        var nx = cx + d[0], ny = cy + d[1];
        if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && g[ny][nx] === '#') opts.push(d);
      });
      if (!opts.length) { stack.pop(); continue; }
      var d = opts[Math.floor(rnd() * opts.length)];
      g[cy + d[1] / 2][cx + d[0] / 2] = '.';
      g[cy + d[1]][cx + d[0]] = '.';
      stack.push([cx + d[0], cy + d[1]]);
    }
    var extra = 2 + Math.floor(rnd() * 3);
    for (var i = 0; i < extra; i++) {
      var wx = 1 + Math.floor(rnd() * (size - 2));
      var wy = 1 + Math.floor(rnd() * (size - 2));
      if (g[wy][wx] === '#' && ((wx % 2 === 0) !== (wy % 2 === 0))) g[wy][wx] = '.';
    }
    return g;
  }

  // 只看地形（门当墙），返回 {"x,y": 步数}
  function bfsDist(grid, start) {
    var size = grid.length, dist = {}, q = [[start[0], start[1]]];
    dist[key2(start[0], start[1])] = 0;
    while (q.length) {
      var s = q.shift(), x = s[0], y = s[1], d0 = dist[key2(x, y)];
      for (var i = 0; i < DIRLIST.length; i++) {
        var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (grid[ny][nx] === '#') continue;
        var k = key2(nx, ny);
        if (dist[k] !== undefined) continue;
        dist[k] = d0 + 1; q.push([nx, ny]);
      }
    }
    return dist;
  }

  function openCells(grid) {
    var out = [];
    for (var y = 0; y < grid.length; y++) for (var x = 0; x < grid.length; x++) {
      if (grid[y][x] !== '#') out.push([x, y]);
    }
    return out;
  }

  // 所有非墙格是否互相可达
  function allReachable(grid, start) {
    var dist = bfsDist(grid, start), all = openCells(grid);
    for (var i = 0; i < all.length; i++) if (dist[key2(all[i][0], all[i][1])] === undefined) return false;
    return true;
  }

  function bfsPath(grid, start, goal) {
    var size = grid.length, dist = {}, prev = {}, q = [[start[0], start[1]]];
    var k0 = key2(start[0], start[1]);
    dist[k0] = 0; prev[k0] = null;
    while (q.length) {
      var s = q.shift(), x = s[0], y = s[1], d0 = dist[key2(x, y)];
      for (var i = 0; i < DIRLIST.length; i++) {
        var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (grid[ny][nx] === '#') continue;
        var nk = key2(nx, ny);
        if (dist[nk] !== undefined) continue;
        dist[nk] = d0 + 1; prev[nk] = key2(x, y); q.push([nx, ny]);
      }
    }
    var gk = key2(goal[0], goal[1]);
    if (dist[gk] === undefined) return null;
    var out = [], k = gk;
    while (k && prev[k] !== undefined) { var p = k.split(','); out.push([Number(p[0]), Number(p[1])]); k = prev[k]; }
    out.reverse();
    return out;
  }

  function degree(grid, x, y) {
    var n = 0;
    for (var i = 0; i < DIRLIST.length; i++) {
      var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
      if (grid[ny] && grid[ny][nx] !== undefined && grid[ny][nx] !== '#') n++;
    }
    return n;
  }

  function neighbors(grid, x, y) {
    var out = [];
    for (var i = 0; i < DIRLIST.length; i++) {
      var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
      if (grid[ny] && grid[ny][nx] !== undefined && grid[ny][nx] !== '#') out.push([nx, ny]);
    }
    return out;
  }

  function deadEnds(grid) {
    var out = [];
    for (var y = 1; y < grid.length - 1; y++) for (var x = 1; x < grid.length - 1; x++) {
      if (grid[y][x] === '#' || grid[y][x] === 'S' || grid[y][x] === 'G') {
        if (grid[y][x] === 'S' || grid[y][x] === 'G') continue;
      }
      if (grid[y][x] !== '.') continue;
      if (degree(grid, x, y) === 1) out.push([x, y]);
    }
    return out;
  }

  /* ------------------------------------------- 状态空间（钥匙 / 门）寻路 */

  function requiredDoors(spec) {
    if (spec.requiredDoors != null) return spec.requiredDoors;
    return spec.doors ? spec.doors.length : 0;
  }
  function doorIndexAt(spec, x, y) {
    var di = spec.doorIndex || {}, v = di[key2(x, y)];
    return v == null ? -1 : v;
  }

  // 桶队列 Dijkstra，状态 (x,y,keys,opened)；stopAtGoal 时一弹出终点即停
  // 门的两条额外规则（§3 机制）：需要几把钥匙、必须是哪一把
  function doorNeedOf(spec, di) {
    var a = spec.doorNeeds; return (a && di >= 0 && a[di] != null) ? a[di] : 1;
  }
  function blockedAt(spec, nx, ny) {
    var b = spec._blocked;
    return !!(b && b[nx + ',' + ny]);
  }
  function markBlocked(spec, nx, ny) {
    if (!spec._blocked) spec._blocked = {};
    spec._blocked[nx + ',' + ny] = 1;
  }
  function trapPenaltyAt(spec, nx, ny) {
    var ti = spec.trapIndex;
    if (!ti) return 0;
    var v = ti[nx + ',' + ny];
    return typeof v === 'number' ? v : 0;
  }
  function doorKeysOk(spec, di, mask) {
    var list = spec.doorKeys && spec.doorKeys[di];
    if (!list || !list.length) return true;
    for (var i = 0; i < list.length; i++) if (!(mask & (1 << list[i]))) return false;
    return true;
  }
  function gateDoorOk(spec, di, sum) {
    var g = spec.gateDoors;
    if (!g) return true;
    for (var i = 0; i < g.length; i++) if (g[i].doorIndex === di && sum < g[i].minSum) return false;
    return true;
  }
  function doorKeyOf(spec, di) {
    var a = spec.doorNeedKey; return (a && di >= 0 && a[di] != null) ? a[di] : -1;
  }

  function keyMaskBit(spec, x, y) {
    var ki = spec.keyIndex || {}, idx = ki[key2(x, y)];
    return idx == null ? -1 : idx;
  }

  function stateSearch(spec, sx, sy, sKeys, sOpened, stopAtGoal, sMask) {
    var grid = spec.grid, size = spec.size || grid.length;
    var req = requiredDoors(spec);
    var gx = spec.exit[0], gy = spec.exit[1];
    var dist = {}, prev = {}, buckets = [], ptr = 0, goalKey = null, goalCost = -1;
    var k0 = skey(sx, sy, sKeys, sOpened, sMask || 0);
    dist[k0] = 0; prev[k0] = null;
    buckets[0] = [k0];
    while (ptr < buckets.length) {
      var b = buckets[ptr];
      if (!b || !b.length) { ptr++; continue; }
      var key = b.pop();
      if (dist[key] !== ptr) continue;
      var p = key.split(','), x = +p[0], y = +p[1], k = +p[2], o = +p[3], m = +p[4];
      if (stopAtGoal && x === gx && y === gy && o >= req) { goalKey = key; goalCost = ptr; break; }
      for (var i = 0; i < DIRLIST.length; i++) {
        var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        var t = grid[ny][nx];
        if (t === '#') continue;
        var nk = k, no = o, nm = m;
        if (t === 'K') {
          var kb = keyMaskBit(spec, nx, ny);
          if (kb >= 0 && !(nm & (1 << kb))) { nk = Math.min(9, nk + 1); nm = nm | (1 << kb); }
        }
        if (t === 'D') {
          var di = doorIndexAt(spec, nx, ny);
          var needS = doorNeedOf(spec, di), kreqS = doorKeyOf(spec, di);
          if (di !== o || nk < needS) continue;              // 门必须按顺序开
          if (kreqS >= 0 && !(nm & (1 << kreqS))) continue;  // 顺序门：必须是指定那把钥匙
          if (!doorKeysOk(spec, di, nm)) continue;            // d9 双钥定序
          nk -= needS; no += 1;
        }
        var nkey = skey(nx, ny, nk, no, nm);
        if (dist[nkey] !== undefined && dist[nkey] <= ptr + 1) continue;
        // 注：钥匙只在首次踩到 K 时 +1（bitmask 记录），回头不重复刷钥匙
        dist[nkey] = ptr + 1; prev[nkey] = key;
        (buckets[ptr + 1] || (buckets[ptr + 1] = [])).push(nkey);
      }
    }
    return { dist: dist, prev: prev, goalKey: goalKey, goalCost: goalCost };
  }

  function statesOfPath(prev, endKey) {
    var out = [], k = endKey;
    while (k && prev[k] !== undefined) {
      var p = k.split(',');
      out.push({ x: +p[0], y: +p[1], keys: +p[2], opened: +p[3], mask: +(p[4] || 0) });
      k = prev[k];
    }
    out.reverse();
    return out;
  }

  function solveOpt(spec) {
    var r = stateSearch(spec, spec.start[0], spec.start[1], 0, 0, true, 0);
    if (r.goalCost < 0) return { cost: Infinity, path: null };
    return { cost: r.goalCost, path: statesOfPath(r.prev, r.goalKey) };
  }

  function remainFrom(spec, x, y, keys, opened, mask) {
    var r = stateSearch(spec, x, y, keys, opened, true, mask || 0);
    return r.goalCost < 0 ? -1 : r.goalCost;
  }

  // 起点全状态距离表（n_eff 用），按 spec 缓存但不参与 JSON 序列化
  function stateDistOf(spec) {
    if (spec.__stateDist) return spec.__stateDist;
    var r = stateSearch(spec, spec.start[0], spec.start[1], 0, 0, false, 0);
    try {
      Object.defineProperty(spec, '__stateDist', { value: r.dist, enumerable: false, writable: true, configurable: true });
    } catch (e) { spec.__stateDist = r.dist; }
    return r.dist;
  }

  /** n_eff：执行轨迹上「实际到过的最远状态」的最短步数；平手取较晚那步 */
  function nEffOf(spec, traj) {
    var dist = stateDistOf(spec), best = { d: 0, i: -1 };
    for (var i = 0; i < traj.length; i++) {
      var s = traj[i], d = dist[skey(s.x, s.y, s.keys, s.opened, s.mask || 0)];
      if (d != null && (d > best.d || (d === best.d && i > best.i))) best = { d: d, i: i };
    }
    return best.d;
  }

  /* ------------------------------------------------------------ 执行 */

  function valueAt(spec, x, y) {
    if (!spec.values || !spec.values[y]) return 0;
    var v = spec.values[y][x];
    return typeof v === 'number' ? v : 0;
  }

  function gateOk(spec, sum) {
    if (spec.gateLo == null && spec.gateHi == null) return true;
    var lo = spec.gateLo == null ? -Infinity : spec.gateLo;
    var hi = spec.gateHi == null ? Infinity : spec.gateHi;
    return sum >= lo && sum <= hi;
  }

  // 超预算不截断（impl §1）：所有合法步都执行，由 V 的 excess 项扣分
  function simulate(spec, plan) {
    plan = Array.isArray(plan) ? plan : [];
    var grid = spec.grid, size = spec.size || grid.length;
    var req = requiredDoors(spec);
    var x = spec.start[0], y = spec.start[1], keys = 0, opened = 0;
    var used = 0, invalid = 0, sum = Number(spec.startValue) || 0;
    var arrived = false, reached = false, mask = 0, doorBang = 0;   // doorBang：钥匙没拿全就撞真门 → 本局判未完成
    spec._blocked = {};   // 单向门是「这一次走法内」的状态
    var actions = [], traj = [{ x: x, y: y, keys: keys, opened: opened, mask: mask }];
    for (var i = 0; i < plan.length; i++) {
      var d = DIRS[plan[i]];
      if (!d) { invalid++; continue; }
      var nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) { invalid++; continue; }
      var t = grid[ny][nx];
      if (t === '#') { invalid++; continue; }
      if (blockedAt(spec, nx, ny)) { invalid++; continue; }   // d8 单向门：过了就回不去
      if (t === 'D') {
        var di = doorIndexAt(spec, nx, ny);
        var needD = doorNeedOf(spec, di), kreqD = doorKeyOf(spec, di);
        if (keys < needD && di >= 0) doorBang++;                        // 少钥匙撞真门（d5/d7 口径）：不能靠后续补钥匙洗白
        if (keys < needD || di !== opened || (kreqD >= 0 && !(mask & (1 << kreqD)))) { invalid++; continue; }
        if (!doorKeysOk(spec, di, mask)) { invalid++; continue; }        // d9 双钥定序：指定两把都在
        if (!gateDoorOk(spec, di, sum)) { invalid++; continue; }         // d8 算数门：累计分不够
        keys -= needD; opened += 1;
        if (spec.oneWay && spec.oneWayDoor === di) markBlocked(spec, x, y);   // 关门后原地变墙
      } else if (t === 'K') {
        var kb = keyMaskBit(spec, nx, ny);
        if (kb < 0 || !(mask & (1 << kb))) { keys = Math.min(9, keys + 1); if (kb >= 0) mask = mask | (1 << kb); }
      }
      sum += valueAt(spec, nx, ny);
      x = nx; y = ny; used++;
      var trapPen = trapPenaltyAt(spec, nx, ny);
      if (trapPen > 0) { used += trapPen; invalid += 1; }   // d10 陷阱阵：踩上去多耗步、记一次无效
      actions.push(plan[i]);
      traj.push({ x: x, y: y, keys: keys, opened: opened, mask: mask });
      if (t === 'G' && opened >= req) {
        arrived = true;
        var withinSteps = !spec.maxSteps || used <= spec.maxSteps;
        if (gateOk(spec, sum) && withinSteps) { reached = true; break; }
      }
    }
    if (arrived && !reached) { /* 已经站在终点但窗口不满足：不再往前走 */ }
    if (doorBang > 0) reached = false;      // 撞过门 = 本局未完成（不是「记无效步后继续通关」）
    var dRem = -1;
    if (!reached) dRem = remainFrom(spec, x, y, keys, opened, mask);
    return {
      used: used, invalid: invalid, reached: reached, arrived: arrived, doorBang: doorBang,
      sum: sum, keysLeft: keys, opened: opened, dRem: dRem,
      traj: traj, actions: actions, truncated: false
    };
  }

  /* ------------------------------------------------------------ 解析 */

  var WORD_DIR = {
    N: 'N', NORTH: 'N', UP: 'N', U: 'N', '上': 'N', '北': 'N',
    S: 'S', SOUTH: 'S', DOWN: 'S', D: 'S', '下': 'S', '南': 'S',
    E: 'E', EAST: 'E', RIGHT: 'E', R: 'E', '右': 'E', '东': 'E',
    W: 'W', WEST: 'W', LEFT: 'W', L: 'W', '左': 'W', '西': 'W'
  };

  // partial=true 时丢弃末尾「可能没写完」的 token（流式前缀计分用）
  function tokenizePlan(body, partial) {
    var s = String(body == null ? '' : body);
    if (partial && s.length && !/[\s,、]$/.test(s)) s = s.replace(/[^\s,、]+$/, '');
    var raw = s.match(/[A-Za-z]+|[\u4e00-\u9fff]/g) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i], up = t.toUpperCase();
      if (/^[NSEW]+$/.test(up)) { for (var j = 0; j < up.length; j++) out.push(up.charAt(j)); continue; }
      if (WORD_DIR[up]) { out.push(WORD_DIR[up]); continue; }
      if (WORD_DIR[t]) out.push(WORD_DIR[t]);
    }
    return out;
  }

  function readClaim(src) {
    if (!/CLAIM/i.test(src)) return null;
    var dm = /done\s*=\s*([01])/i.exec(src);
    var sm = /steps\s*=\s*(-?\d+)/i.exec(src);
    var cm = /cost\s*=\s*(-?\d+)/i.exec(src);
    if (!dm && !sm) return null;
    return {
      done: dm ? dm[1] === '1' : null,
      steps: sm ? Number(sm[1]) : null,
      cost: cm ? Number(cm[1]) : null,
      raw: (String(src).match(/CLAIM[^\n\r]*/i) || [''])[0].trim()
    };
  }

  /**
   * 严格解析：只认 <PLAN>…</PLAN> 闭合块，或一行 PLAN: …。
   * 没有 PLAN 标记 / PLAN 里没有方向 token → 不可解析（S=0）。
   * 散文 salvage 已删除；salvage 字段仅作调试恒 false。
   */
  function parseStrict(text, opts) {
    opts = opts || {};
    var src = String(text == null ? '' : text);
    var body = null, form = null;
    var m = /<PLAN>([\s\S]*?)<\/PLAN>/i.exec(src);
    if (m) { body = m[1]; form = 'tag'; }
    else {
      var lines = src.split(/\r?\n/);
      for (var i = lines.length - 1; i >= 0; i--) {
        var mm = /^\s*PLAN\s*:\s*(.*)$/i.exec(lines[i]);
        if (mm) { body = mm[1]; form = 'line'; break; }
      }
    }
    var claim = readClaim(src);
    if (body == null) {
      return { parseable: false, parse_ok: false, plan: [], claim: claim, form: null, reason: 'no-plan', salvage: false };
    }
    var plan = tokenizePlan(body, !!opts.partial);
    if (!plan.length) {
      return { parseable: false, parse_ok: false, plan: [], claim: claim, form: form, reason: 'empty-plan', salvage: false };
    }
    return { parseable: true, parse_ok: true, plan: plan, claim: claim, form: form, reason: '', salvage: false };
  }

  // 兼容旧调用名（match.js / 旧脚本）；行为等同 parseStrict，不再 salvage
  function parseSubmission(text) { return parseStrict(text, { allowSalvage: false }); }

  function toPlan(text) { return parseStrict(text).plan; }

  /* ------------------------------------------------------------ 评分 */

  /** credits：钥匙留存（F1/F5 无钥匙恒 1；F2 剩一把可选钥匙 = 0.833，下限 0.5） */
  function creditsOf(spec, sim) {
    var kc = spec.keyCount || 0;
    if (!kc) return 1;
    return clamp(1 - 0.5 * Math.max(0, sim.keysLeft) / kc, 0, 1);
  }

  /* Fable 校准规格 §2.2：P=g^0.9、V=0.65^n_bad、R=1/(1+slack/K)、Q 完成门 0.70+0.30G、
     C 四档、S=1300*(0.90Q+0.10C)；n_eff 做效率分母，超预算不再截断。 */
  function scoreFrom(spec, sim, sub, nEff) {
    var parseOk = !!(sub && sub.parseable);
    var opt = Math.max(1, spec.optSteps || 1);
    var nEffV = (nEff == null || !isFinite(nEff)) ? opt : Math.max(0, nEff);
    var slack = Math.max(0, sim.used - nEffV);
    var zero = {
      S: 0, q: 0, Q: 0, P: 0, V: 0, R: 0, C: 0, stepEff: 0, credits: 0, excess: slack
    };
    if (!parseOk) return zero;

    var G = !!sim.reached;
    var g = clamp(nEffV / opt, 0, 1);
    var P = Math.pow(g, 0.9);
    var V = clamp(Math.pow(0.65, sim.invalid), 0, 1);
    var K = Math.max(5, 0.5 * nEffV);
    var R = clamp(1 / (1 + slack / K), 0, 1);

    var stepEff = 0, credits = 0;
    if (G) {
      stepEff = clamp(1 - Math.max(0, sim.used - opt) / opt, 0, 1);
      credits = creditsOf(spec, sim);
    }

    /* C 四档：1.00 全对 / 0.85 偏差 ≤20% / 0.55 沉默 / 0.35 声明错误 */
    var isF5 = spec.family === 'F5' || spec.gateLo != null;
    var C = 0.55, claim = sub && sub.claim;
    if (claim) {
      var claimedDone = claim.done === true;
      if (claimedDone !== G) C = 0.35;
      else {
        var off = Math.abs((Number(claim.steps) || 0) - sim.used);
        if (isF5 && claim.cost == null) C = 0.35;              /* F5 必须带 cost= */
        else {
          if (isF5) off = Math.max(off, Math.abs((Number(claim.cost) || 0) - sim.sum));
          if (off <= 1) C = 1.00;
          else if (off <= Math.max(1, 0.2 * Math.max(1, sim.used))) C = 0.85;
          else C = 0.35;
        }
      }
    }

    var Qraw = 0.50 * P + 0.28 * V + 0.22 * R;
    var Q = Qraw * (0.70 + 0.30 * (G ? 1 : 0));                 // 完成门
    if (claim && claim.done === true && !G) Q *= 0.85;          // 虚报：额外折扣
    Q = clamp(Q, 0, 1);
    var S = Math.round(1300 * (0.90 * Q + 0.10 * C));
    return {
      S: S, q: Qraw, Q: Q, P: P, V: V, R: R, C: C,
      stepEff: stepEff, credits: credits, excess: slack
    };
  }

  /* 超时/截断专用：按「流中最后一个完整可解析的 PLAN: 前缀」正常计分，不加任何时间乘子 */
  function scoreRoundPartial(spec, text) {
    var sub = parseStrict(text, { partial: true, allowSalvage: false });
    var sim = simulate(spec, sub.plan);
    var nEff = nEffOf(spec, sim.traj);
    var sc = scoreFrom(spec, sim, sub, nEff);
    return {
      S: sc.S, q: sc.q, Q: sc.Q, P: sc.P, V: sc.V, R: sc.R, C: sc.C,
      reached: sim.reached, arrived: sim.arrived, used: sim.used, invalid: sim.invalid,
      doorBang: sim.doorBang || 0,
      credits: sc.credits, stepEff: sc.stepEff, excess: sc.excess,
      sum: sim.sum, d_rem: sim.dRem, n_eff: nEff,
      n_star: spec.optSteps, opt: spec.optSteps, budget: spec.budget,
      actions: sim.actions, family: spec.family, seed: spec.seed,
      truncated: true
    };
  }

  function scoreRound(spec, text) {
    var sub = parseStrict(text, { allowSalvage: false });
    var sim = simulate(spec, sub.plan);
    var nEff = nEffOf(spec, sim.traj);
    var sc = scoreFrom(spec, sim, sub, nEff);
    return {
      S: sc.S, q: sc.q, Q: sc.Q, P: sc.P, V: sc.V, R: sc.R, C: sc.C,
      stepEff: sc.stepEff, credits: sc.credits, excess: sc.excess,
      parseable: sub.parseable, parse_ok: sub.parseable, plan: sub.plan,
      claim: sub.claim, form: sub.form, reason: sub.reason, salvage: false,
      reached: sim.reached, arrived: sim.arrived, used: sim.used, n: sim.used, doorBang: sim.doorBang || 0,
      invalid: sim.invalid, n_bad: sim.invalid, truncated: false,
      keys_held: sim.keysLeft, keysLeft: sim.keysLeft, opened: sim.opened,
      sum: sim.sum, d_rem: sim.dRem, n_eff: nEff,
      n_star: spec.optSteps, opt: spec.optSteps, budget: spec.budget,
      actions: sim.actions, family: spec.family, seed: spec.seed
    };
  }

  var W3 = [0.26, 0.33, 0.41];
  function matchScore(rounds) {
    var Q = 0, C = 0;
    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i] || {};
      var q = (r.q != null) ? r.q : (0.55 * (r.P || 0) + 0.25 * (r.V || 0) + 0.20 * (r.R || 0));
      Q += (W3[Math.min(i, 2)] || 0) * q;
      C += (r.C || 0);
    }
    C = C / Math.max(1, rounds.length);
    return { S: Math.round(1300 * (0.90 * Q + 0.10 * C)), Q: Q, C: C };
  }

  function decide(a, b) {
    var d = (a.S || 0) - (b.S || 0);
    if (Math.abs(d) >= 13) return d > 0 ? 'A' : 'B';
    if (a.doneRounds !== b.doneRounds) return a.doneRounds > b.doneRounds ? 'A' : 'B';
    if (a.totalMs !== b.totalMs) return a.totalMs < b.totalMs ? 'A' : 'B';
    return 'D';
  }

  /** 单段判定（impl §6）：|ΔS|≥8 → 到达 → 剩余步数 → n_eff → 平 */
  function judgeRound(a, b) {
    var d = (a.S || 0) - (b.S || 0);
    if (Math.abs(d) >= 8) return d > 0 ? 'A' : 'B';
    var ra = !!a.reached, rb = !!b.reached;
    if (ra !== rb) return ra ? 'A' : 'B';
    var remA = (a.budget || 0) - (a.used || 0);
    var remB = (b.budget || 0) - (b.used || 0);
    if (remA !== remB) return remA > remB ? 'A' : 'B';
    var na = a.n_eff || 0, nb = b.n_eff || 0;
    if (na !== nb) return na > nb ? 'A' : 'B';
    return 'D';
  }

  /* ------------------------------------------------------------ 家族元数据 */

  // softMs：只做快照不中断；hardMs：abort。Fable 第三轮暂定全族 8s/20s，后续只改这里
  var FAMILIES = {
    F1: { id: 'F1', name: '疾风径', desc: '7×7，预算 = 最短路 +1，比谁更少绕路', softMs: 8000, hardMs: 20000 },
    F2: { id: 'F2', name: '双钥连门', desc: '9×9，三钥三门按序开，第三钥开捷径门省 3 步', softMs: 8000, hardMs: 20000 },
    F3: { id: 'F3', name: '零余量', desc: '9×9，预算 = 最短路 +1，浪费一步就掉分', softMs: 8000, hardMs: 20000 },
    F5: { id: 'F5', name: '算数门', desc: '9×9，预算 = 最优步数，累计分值落在窗口内才算通关', softMs: 8000, hardMs: 20000 }
  };
  /* ------------------------------------------------------ 难度阶梯 d1–d11（Fable v2 §1–§4） */
  // 画布 / opt 区间照 §1；四家族参数照 §2（open 是骨架密度目标，这里用于装饰配比）

  /* §4 base 标定：各档「快模型目标完成率」（d1→98% … d11→14%，取自难度阶梯规格 §1） */
  var TARGET_DONE = { 1: 0.98, 2: 0.92, 3: 0.84, 4: 0.74, 5: 0.66, 6: 0.57, 7: 0.48, 8: 0.40, 9: 0.32, 10: 0.24, 11: 0.14 };

  /**
   * baseFromRate(rate, sample, meanDiff)：把「近 20 局」换成 base 档位。
   * 有 meanDiff 时按相对口径：拿观察到的完成率去比「他们打的那一档的目标完成率」，
   * 超出 5 点升 1 档、超出 15 点升 2 档，反之同理，单次最多动 2 档。
   * 没有档位信息（老记录）就按「完成率最接近哪个目标完成率」就近取。
   * 没有样本 → d1。
   */
  function baseFromRate(rate, sample, meanDiff) {
    if (!sample || rate == null) return 1;
    rate = clamp(rate, 0, 1);
    if (meanDiff && TARGET_DONE[meanDiff] != null) {
      var tgt = TARGET_DONE[meanDiff], delta = 0;
      if (rate >= tgt + 0.15) delta = 2;
      else if (rate >= tgt + 0.05) delta = 1;
      else if (rate <= tgt - 0.15) delta = -2;
      else if (rate <= tgt - 0.05) delta = -1;
      return Math.max(1, Math.min(11, meanDiff + delta));
    }
    var best = 1, bestGap = Infinity;
    for (var d = 1; d <= 11; d++) {
      var gap = Math.abs(rate - TARGET_DONE[d]);
      if (gap < bestGap) { bestGap = gap; best = d; }
    }
    return Math.max(1, Math.min(11, best));
  }

  var TARGET_BY_DIFF = {
    1:  { size: 7,  opt: [9, 11],  rooms: 0,  deco: 0.18, F1: 1, F2: 2, F3: 1, F5: 0 },
    2:  { size: 9,  opt: [12, 14], rooms: 1,  deco: 0.22, F1: 2, F2: 2, F3: 1, F5: 1 },
    3:  { size: 9,  opt: [15, 17], rooms: 1,  deco: 0.26, F1: 2, F2: 2, F3: 1, F5: 1 },
    4:  { size: 11, opt: [18, 19], rooms: 3,  deco: 0.35, F1: 4, F2: 4, F3: 3, F5: 3 },
    5:  { size: 13, opt: [20, 20], rooms: 3,  deco: 0.38, F1: 3, F2: 3, F3: 3, F5: 2 },
    6:  { size: 15, opt: [21, 22], rooms: 4,  deco: 0.39, F1: 3, F2: 2, F3: 2, F5: 2 },
    7:  { size: 17, opt: [23, 23], rooms: 5,  deco: 0.41, F1: 2, F2: 2, F3: 2, F5: 1 },
    8:  { size: 19, opt: [24, 25], rooms: 6,  deco: 0.43, F1: 2, F2: 2, F3: 1, F5: 1 },
    9:  { size: 21, opt: [26, 26], rooms: 7,  deco: 0.44, F1: 2, F2: 1, F3: 1, F5: 1 },
    10: { size: 25, opt: [27, 27], rooms: 8,  deco: 0.48, F1: 1, F2: 1, F3: 1, F5: 1 },
    11: { size: 29, opt: [28, 28], rooms: 10, deco: 0.52, F1: 1, F2: 1, F3: 1, F5: 1 }
  };
  // 每档 8 个冻结 seed（verifyShortest 通过、opt 落表；seed 冻结后只因 opt 超档才换）
  var LADDER_SEEDS = {1:[349686, 355837, 361988, 368139, 374290, 380441, 386592, 392743], 2:[357605, 363756, 369907, 376058, 382209, 388360, 394511, 400662], 3:[365524, 371675, 377826, 383977, 390128, 396279, 402430, 408581], 4:[373443, 379594, 385745, 391896, 398047, 404198, 410349, 416500], 5:[381362, 387513, 393664, 399815, 405966, 412117, 418268, 424419], 6:[389281, 395432, 401583, 407734, 413885, 420036, 426187, 432338], 7:[397200, 403351, 409502, 415653, 421804, 427955, 434106, 440257], 8:[405119, 411270, 417421, 423572, 429723, 435874, 442025, 448176], 9:[413038, 419189, 425340, 431491, 437642, 443793, 449944, 456095], 10:[420957, 427108, 433259, 439410, 445561, 451712, 457863, 464014], 11:[428876, 435027, 441178, 447329, 453480, 459631, 465782, 471933]};

  var DIFF_MAX = 11;
  // §4：band B1=d1–3 / B2=d4–6 / B3=d7–9 / B4=d10–11
  function bandOf(diff) {
    var d = Math.max(1, Math.min(DIFF_MAX, Math.round(diff) || 1));
    if (d <= 3) return 1;
    if (d <= 6) return 2;
    if (d <= 9) return 3;
    return 4;
  }
  function bandRange(band) {
    return { 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 11] }[band];
  }
  /**
   * pickDiff({base, wins:{A,B}, roundIdx, used}) —— 比分调档 + 三条硬帽
   *  - 第 1 局 base；1:0 → base+2；0:1 → base−2；1:1 → base+3
   *  - 硬帽①三局内最多一次 d11 ②任一局 ≤ base+4 且 ≤ d11 ③局间单调不减
   */
  function pickDiff(opt) {
    opt = opt || {};
    var base = Math.max(1, Math.min(DIFF_MAX, Math.round(opt.base) || 3));
    var roundIdx = Math.max(0, Math.min(2, opt.roundIdx == null ? 0 : opt.roundIdx));
    var wins = opt.wins || {};
    var a = Number(wins.A) || 0, b = Number(wins.B) || 0;
    var want = base;
    if (roundIdx === 1) want = a > b ? base + 2 : (b > a ? base - 2 : base);
    else if (roundIdx === 2) want = (a === b) ? base + 3 : (a > b ? base + 2 : base - 2);
    want = Math.max(1, Math.min(DIFF_MAX, want));
    want = Math.min(want, base + 4, DIFF_MAX);            // 硬帽②
    var prev = Number(opt.prevDiff) || 0;
    if (prev && want < prev) want = prev;                  // 硬帽③单调不减
    var used11 = !!(opt.used && opt.used[11]) || !!opt.usedEleven;
    if (want >= DIFF_MAX && used11) want = DIFF_MAX - 1;    // 硬帽①
    return want;
  }

  var FAMILY_IDS = ['F1', 'F2', 'F3', 'F5'];
  var P0_META = {
    F1: { id: 'F1', name: '疾风径', difficulty: 1, weight: 0.12, tags: ['#速度'], group: 'S' },
    F2: { id: 'F2', name: '双钥连门', difficulty: 3, weight: 0.15, tags: ['#长链', '#顺序'], group: 'P' },
    F3: { id: 'F3', name: '零余量', difficulty: 3, weight: 0.13, tags: ['#贪心', '#预算'], group: 'P' },
    F5: { id: 'F5', name: '算数门', difficulty: 4, weight: 0.13, tags: ['#算数', '#自检'], group: 'P' }
  };

  /* ------------------------------------------------------------ 规格收尾 */

  function baseSpec(grid, start, exit, family) {
    return {
      family: family, size: grid.length, grid: grid, start: start, exit: exit,
      doors: [], keys: [], doorIndex: {}, values: null,
      budget: 0, optSteps: 0, keyCount: 0, doorCount: 0, requiredDoors: null,
      creditsStart: 0, gateSum: null, gateLo: null, gateHi: null, startValue: 0
    };
  }

  function finishSpec(spec, extra) {
    extra = extra || {};
    var o = solveOpt(spec);
    spec.optSteps = o.cost === Infinity ? -1 : o.cost;
    spec.solution = o.path;
    spec.keyCount = spec.keys.length;
    spec.doorCount = spec.doors.length;
    if (spec.requiredDoors == null) spec.requiredDoors = spec.doors.length;
    spec.creditsStart = spec.keyCount;
    if (extra.optSteps != null) spec.optSteps = extra.optSteps;
    if (extra.budget != null) spec.budget = extra.budget;
    else if (extra.budgetPlus != null) spec.budget = spec.optSteps + extra.budgetPlus;
    else spec.budget = spec.optSteps;
    spec.difficulty = spec.optSteps > 0 ? Math.round((spec.budget / Math.max(1, spec.optSteps)) * 10) / 10 : 0;
    return spec;
  }

  /* ------------------------------------------------------------ 家族拓扑（Fable 新表，全盘口径） */

  // 全盘口径（含边界格）：Fable 表的「墙/通路/交叉点/死胡同」都按整个 7×7 / 9×9 数
  function fullStats(grid) {
    var n = grid.length, j = 0, de = 0, open = 0, j3 = 0, j4 = 0, sumDeg = 0;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (grid[y][x] === '#') continue;
      open++;
      var d = degree(grid, x, y);
      sumDeg += d;
      if (d >= 3) j++;
      if (d === 3) j3++;
      if (d === 4) j4++;
      if (d === 1) de++;
    }
    var edges = sumDeg / 2, cycles = edges - open + 1;
    return { junctions: j, deadEnds: de, open: open, j3: j3, j4: j4, edges: edges, cycles: cycles, sumDeg: sumDeg };
  }

  // 随机墙 + 精确墙数（墙允许落在边界；连通性由调用方检查）
  function randWallGrid(seed, size, minW, maxW) {
    var rnd = mulberry32((seed >>> 0) || 1);
    var cells = [], x, y;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) cells.push([x, y]);
    shuffle(cells, rnd);
    var w = minW + Math.floor(rnd() * (maxW - minW + 1));
    var g = [];
    for (y = 0; y < size; y++) { g.push([]); for (x = 0; x < size; x++) g[y].push('.'); }
    for (var i = 0; i < w; i++) g[cells[i][1]][cells[i][0]] = '#';
    return g;
  }

  // 旧口径（仅内部格）——保留导出给旧脚本；新校验一律用 fullStats
  function topoStats(grid) {
    var j = 0, de = 0, open = 0;
    for (var y = 1; y < grid.length - 1; y++) for (var x = 1; x < grid.length - 1; x++) {
      if (grid[y][x] === "#") continue;
      open++;
      var d = degree(grid, x, y);
      if (d >= 3) j++;
      if (d === 1) de++;
    }
    return { junctions: j, deadEnds: de, open: open };
  }

  // 旧接口：均匀随机墙（边界强制为墙），保留给旧脚本
  function randGrid(seed, size, wall) {
    var rnd = mulberry32((seed >>> 0) || 1);
    var g = [];
    for (var y = 0; y < size; y++) {
      var row = [];
      for (var x = 0; x < size; x++) {
        var border = (y === 0 || x === 0 || y === size - 1 || x === size - 1);
        row.push(border ? "#" : (rnd() < wall ? "#" : "."));
      }
      g.push(row);
    }
    return g;
  }

  // S 的死胡同口袋：S(度1) — a — b — c — d(度≥3)，四格全通道
  function findPocket(grid) {
    for (var y = 1; y < grid.length - 1; y++) for (var x = 1; x < grid.length - 1; x++) {
      if (grid[y][x] !== ".") continue;
      if (degree(grid, x, y) !== 1) continue;
      var S0 = [x, y], cur = S0, prev = null, chain = [];
      for (var step = 0; step < 8; step++) {
        var nb = neighbors(grid, cur[0], cur[1]).filter(function (c) {
          return !prev || c[0] !== prev[0] || c[1] !== prev[1];
        });
        if (nb.length !== 1) break;
        prev = cur; cur = nb[0]; chain.push(cur);
        if (chain.length === 4) {
          if (degree(grid, cur[0], cur[1]) >= 2) return { S: S0, chain: chain };
          break;
        }
      }
    }
    return null;
  }

  /* 连通修复：把孤岛用墙格打通，直到只剩一个连通块（生成器专用） */
  function repairConnected(g) {
    var size = g.length, DIR4 = [[1,0],[-1,0],[0,1],[0,-1]];
    for (var guard = 0; guard < 40; guard++) {
      var id = [], cid = -1, comps = 0, y, x, i;
      for (y = 0; y < size; y++) { id.push([]); for (x = 0; x < size; x++) id[y].push(-1); }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
        if (g[y][x] === '#' || id[y][x] >= 0) continue;
        cid++; comps++; var q = [[x, y]], h = 0; id[y][x] = cid;
        while (h < q.length) {
          var a = q[h++];
          for (i = 0; i < 4; i++) {
            var nx = a[0] + DIR4[i][0], ny = a[1] + DIR4[i][1];
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            if (g[ny][nx] === '#' || id[ny][nx] >= 0) continue;
            id[ny][nx] = cid; q.push([nx, ny]);
          }
        }
      }
      if (comps <= 1) return g;
      var found = null;
      for (y = 0; y < size && !found; y++) for (x = 0; x < size && !found; x++) {
        if (g[y][x] !== '#') continue;
        var seen = {};
        for (i = 0; i < 4; i++) {
          var ax = x + DIR4[i][0], ay = y + DIR4[i][1];
          if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
          if (g[ay][ax] !== '#') seen[id[ay][ax]] = 1;
        }
        if (Object.keys(seen).length >= 2) found = [x, y];
      }
      if (!found) return g;
      g[found[1]][found[0]] = '.';
    }
    return g;
  }

  function nearPath(path, x, y) {
    for (var i = 0; i < path.length; i++) {
      if (Math.abs(path[i][0] - x) + Math.abs(path[i][1] - y) <= 1) return true;
    }
    return false;
  }

  // 「≤50% 交叉点贴身」的反面：最短路 ±1 格内的度≥3 节点占比
  function pathProximity(grid, path) {
    var n = grid.length, near = 0, tot = 0;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (grid[y][x] === '#') continue;
      if (degree(grid, x, y) >= 3) { tot++; if (nearPath(path, x, y)) near++; }
    }
    return tot ? near / tot : 0;
  }

  // 选 (S,G)：距离 ∈ [lo,hi]、最短路/曼哈顿 ≥ ratio、贴身交叉点占比 ≥ prox
  function pickPair(grid, lo, hi, mdMax, prox, sOk) {
    var cells = openCells(grid), n = cells.length, i, j;
    var dm = {};
    for (i = 0; i < n; i++) dm[key2(cells[i][0], cells[i][1])] = bfsDist(grid, cells[i]);
    for (i = 0; i < n; i++) {
      var S = cells[i];
      if (sOk && !sOk(grid, S)) continue;
      var ds = dm[key2(S[0], S[1])];
      for (j = 0; j < n; j++) {
        if (i === j) continue;
        var G = cells[j], d = ds[key2(G[0], G[1])];
        if (d == null || d < lo || d > hi) continue;
        var md = Math.abs(S[0] - G[0]) + Math.abs(S[1] - G[1]);
        if (md > mdMax) continue;
        var path = bfsPath(grid, S, G);
        if (!path || path.length - 1 !== d) continue;
        if (prox && pathProximity(grid, path) < prox) continue;
        return { S: S, G: G, opt: d, path: path };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------ F1 疾风径 */

  // 唯一待定常量：Lead/Fable 若把 opt 定死 9，只改这两行
  var F1_OPT_MIN = 9, F1_OPT_MAX = 9;   // Fable 第三轮定死：opt=9 / budget=10 / M<=7

  function genSpeed(seed) {
    for (var att = 0; att < 800; att++) {
      var s2 = (seed + att * 0x9e3779b9) >>> 0;
      var g = repairConnected(randWallGrid(s2, 7, 24, 28));
      var cells = openCells(g);
      if (!cells.length || !allReachable(g, cells[0])) continue;
      var topo = fullStats(g);
      if (topo.open < 27 || topo.open > 31) continue;
      if (topo.junctions < 12 || topo.junctions > 15) continue;
      if (topo.deadEnds < 5 || topo.deadEnds > 7) continue;
      var pr = pickPair(g, F1_OPT_MIN, F1_OPT_MAX, 7, 0.50, null);
      if (!pr) continue;
      g[pr.S[1]][pr.S[0]] = 'S'; g[pr.G[1]][pr.G[0]] = 'G';
      var spec = baseSpec(g, pr.S, pr.G, 'F1');
      finishSpec(spec, { budgetPlus: 1 });
      if (spec.optSteps < F1_OPT_MIN || spec.optSteps > F1_OPT_MAX) continue;
      if (spec.budget !== spec.optSteps + 1) continue;
      spec.topo = topo;
      spec.proximity = pathProximity(g, pr.path);
      return spec;
    }
    return null;
  }

  /* ------------------------------------------------------------ F2 双钥连门 */

  /* F2 双钥连门：两把钥匙两扇门串在唯一主路上（P0 修复版）
     - 先选一条长度恰为 16 的 S→G 主路；
     - 两扇门插在主路上，两把钥匙分别落在「门1 之前」「门1 与门2 之间」的路面上，
       顺路就能捡，所以 opt 仍是 16、预算 = opt + 2 = 18；
     - 0 钥 / 1 钥都到不了终点（门的先后顺序是真约束，不是装饰）。 */
  function genKeyOrder(seed) {
    var DBG = null; if (typeof global !== 'undefined' && global.__F2DBG === null) { global.__F2DBG = { grid: 0, topo: 0, pair: 0, pre: 0, k2: 0, opt: 0, prox: 0 }; }
    if (typeof global !== 'undefined' && global.__F2DBG) DBG = global.__F2DBG;
    for (var att = 0; att < 6000; att++) {
      var s2 = (seed + att * 0x85ebca6b) >>> 0;
      var g = repairConnected(randWallGrid(s2, 9, 30, 34));   // open 47..51
      if (DBG) DBG.grid++;
      var topo = fullStats(g);
      if (DBG) DBG.topo++;
      if (topo.open < 47 || topo.open > 51) continue;
      if (topo.junctions < 8 || topo.junctions > 11) continue;
      if (topo.deadEnds < 6 || topo.deadEnds > 9) continue;
      var cells = openCells(g);
      if (!cells.length || !allReachable(g, cells[0])) continue;

      /* 起点/终点：找一对恰好相隔 16 步、曼哈顿 <= 12 的格子（起点优先靠角落） */
      var S = null, G = null;
      var ordered = cells.slice().sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]); });
      for (var si = 0; si < ordered.length && !G; si++) {
        var c0 = ordered[si];
        if (degree(g, c0[0], c0[1]) < 2) continue;
        var dd = bfsDist(g, c0);
        for (var gi = 0; gi < cells.length; gi++) {
          var gc = cells[gi];
          if (gc[0] === c0[0] && gc[1] === c0[1]) continue;
          if (dd[key2(gc[0], gc[1])] !== 16) continue;
          if (Math.abs(c0[0] - gc[0]) + Math.abs(c0[1] - gc[1]) > 12) continue;
          if (degree(g, gc[0], gc[1]) < 2) continue;
          S = c0; G = gc; break;
        }
      }
      if (!S || !G) continue;
      if (DBG) DBG.pair++;
      g[S[1]][S[0]] = 'S'; g[G[1]][G[0]] = 'G';   /* 模拟器只认格子里的 S/G 标记 */
      var P = bfsPath(g, S, G);
      if (!P || P.length !== 17) continue;

      /* 两扇门：主路 40% ~ 70% 之间 */
      var i1 = 6, i2 = 11, doors = null, di = {}, keys = null;
      if (P[i1][0] === S[0] && P[i1][1] === S[1]) continue;
      if (g[P[i1][1]][P[i1][0]] !== '.') continue;
      if (g[P[i2][1]][P[i2][0]] !== '.') continue;
      g[P[i1][1]][P[i1][0]] = 'D'; di[key2(P[i1][0], P[i1][1])] = 0;
      g[P[i2][1]][P[i2][0]] = 'D'; di[key2(P[i2][0], P[i2][1])] = 1;
      doors = [{ x: P[i1][0], y: P[i1][1], index: 0 }, { x: P[i2][0], y: P[i2][1], index: 1 }];

      /* 钥匙：门1 之前放一把、门1~门2 之间放一把，都摆在主路 P 的路面上；
         然后要求最优解（16 步）真的顺路把两把都捡了，否则换一组位置。 */
      var r0 = bfsDistWalls(g, S, di, 0), r1 = bfsDistWalls(g, S, di, 1), r2 = bfsDistWalls(g, S, di, 2);
      if (r0[key2(G[0], G[1])] != null) continue;               /* 零钥不该通 */
      if (r1[key2(G[0], G[1])] != null) continue;               /* 一钥不该通 */
      if (r2[key2(G[0], G[1])] == null) continue;               /* 两钥必须通 */

      var spec = null, k1 = null, k2 = null;
      var k1cand = [2, 3, 4, 5], k2cand = [7, 8, 9, 10];
      for (var a1 = 0; a1 < k1cand.length && !spec; a1++) {
        for (var a2 = 0; a2 < k2cand.length && !spec; a2++) {
          var t1 = [P[k1cand[a1]][0], P[k1cand[a1]][1]];
          var t2 = [P[k2cand[a2]][0], P[k2cand[a2]][1]];
          if (g[t1[1]][t1[0]] !== '.' || g[t2[1]][t2[0]] !== '.') continue;
          if (r0[key2(t1[0], t1[1])] == null) continue;          /* 钥1 门外可达 */
          if (r1[key2(t2[0], t2[1])] == null) continue;          /* 钥2 要开过门1 */
          if (r0[key2(t2[0], t2[1])] != null) continue;          /* 关着门1 够不到钥2 */
          g[t1[1]][t1[0]] = 'K'; g[t2[1]][t2[0]] = 'K';
          var cand = baseSpec(g, S, G, 'F2');
          cand.doors = doors; cand.doorIndex = di;
          cand.keys = [{ x: t1[0], y: t1[1] }, { x: t2[0], y: t2[1] }];
          cand.keyIndex = {};
          cand.keyIndex[key2(t1[0], t1[1])] = 0;
          cand.keyIndex[key2(t2[0], t2[1])] = 1;
          finishSpec(cand, { budgetPlus: 2 });
          var solHasKeys = false;
          if (cand.optSteps === 16 && cand.solution && cand.solution.length === 17) {
            var ks = {}, st;
            for (var si2 = 0; si2 < cand.solution.length; si2++) {
              st = cand.solution[si2];
              if ((st.x === t1[0] && st.y === t1[1]) || (st.x === t2[0] && st.y === t2[1])) ks[st.x + ',' + st.y] = 1;
            }
            solHasKeys = !!(ks[t1[0] + ',' + t1[1]] && ks[t2[0] + ',' + t2[1]]);
          }
          if (solHasKeys) { spec = cand; k1 = t1; k2 = t2; }
          else { g[t1[1]][t1[0]] = '.'; g[t2[1]][t2[0]] = '.'; }
        }
      }
      if (DBG) DBG.k2++;
      if (!spec) {
        g[P[i1][1]][P[i1][0]] = '.'; g[P[i2][1]][P[i2][0]] = '.';
        continue;
      }
      if (DBG) DBG.opt++;
      if (spec.optSteps !== 16 || spec.budget !== 18) continue;
      var pathXY = spec.solution.map(function (st2) { return [st2.x, st2.y]; });
      var prox = pathProximity(g, pathXY);
      if (DBG) DBG.prox++;
      if (prox < 0.50) continue;
      spec.topo = topo; spec.proximity = prox;
      return spec;
    }
    return null;
  }

  // 门按「已开数量 = openBefore」放行的 BFS（与 stateSearch 的门语义一致）
  function bfsDistWalls(grid, start, doorIndex, openBefore) {
    var size = grid.length, dist = {}, q = [[start[0], start[1]]];
    dist[key2(start[0], start[1])] = 0;
    while (q.length) {
      var s = q.shift(), x = s[0], y = s[1], d0 = dist[key2(x, y)];
      for (var i = 0; i < DIRLIST.length; i++) {
        var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        var t = grid[ny][nx];
        if (t === "#") continue;
        if (t === "D") {
          var di = doorIndex[key2(nx, ny)];
          if (di == null || di >= openBefore) continue;
        }
        var k = key2(nx, ny);
        if (dist[k] !== undefined) continue;
        dist[k] = d0 + 1; q.push([nx, ny]);
      }
    }
    return dist;
  }

  /* ------------------------------------------------------------ F3 零余量 */

  function genTight(seed) {
    for (var att = 0; att < 4000; att++) {
      var s2 = (seed + att * 0xc2b2ae35) >>> 0;
      var g = repairConnected(randWallGrid(s2, 9, 33, 36));
      var cells = openCells(g);
      if (!cells.length || !allReachable(g, cells[0])) continue;
      var topo = fullStats(g);
      if (topo.open < 49 || topo.open > 53) continue;
      if (topo.junctions < 10 || topo.junctions > 14) continue;
      if (topo.deadEnds < 8 || topo.deadEnds > 12) continue;
      var pr = pickPair(g, 24, 24, 18, 0.50, function (grid, S) { return degree(grid, S[0], S[1]) >= 2; });
      if (!pr) continue;
      // 假捷径：S 2~3 步内、明显短于最短路的死胡同支路
      var fake = null, dS = bfsDist(g, pr.S), des = deadEnds(g);
      for (var j = 0; j < des.length; j++) {
        var cell = des[j];
        if (cell[0] === pr.S[0] && cell[1] === pr.S[1]) continue;
        var d0 = dS[key2(cell[0], cell[1])];
        if (d0 == null || d0 < 2 || d0 > 3) continue;
        var pth = bfsPath(g, pr.S, cell);
        if (pth && pth.length - 1 < pr.opt) { fake = pth; break; }
      }
      if (!fake) continue;
      g[pr.S[1]][pr.S[0]] = 'S'; g[pr.G[1]][pr.G[0]] = 'G';
      var spec = baseSpec(g, pr.S, pr.G, 'F3');
      spec.fakePath = fake;
      finishSpec(spec, { budgetPlus: 1 });
      if (spec.optSteps < 20 || spec.optSteps > 24) continue;
      if (spec.budget !== spec.optSteps + 1) continue;
           spec.topo = topo; spec.proximity = pathProximity(g, pr.path);
      return spec;
    }
    return null;
  }

  /* ------------------------------------------------------------ F5 算数门 */

  // 从任意 (x,y,sum) 到「站在 G 且 sum 在窗口」的最少步数；无解 -1（F5 专用）
  function f5RemainFrom(spec, sx, sy, ssum) {
    var size = spec.size, lo = spec.gateLo, hi = spec.gateHi;
    var q = [[sx, sy, ssum, 0]], head = 0, seen = {};
    seen[sx + ',' + sy + ',' + ssum] = true;
    while (head < q.length) {
      var cur = q[head++], x = cur[0], y = cur[1], sum = cur[2], st = cur[3];
      if (x === spec.exit[0] && y === spec.exit[1] && sum >= lo && sum <= hi && (!spec.maxSteps || st <= spec.maxSteps)) return st;
      if (spec.maxSteps && st >= spec.maxSteps) continue;
      if (!spec.maxSteps && st >= spec.budget) continue;
      for (var i = 0; i < DIRLIST.length; i++) {
        var d = DIRS[DIRLIST[i]], nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (spec.grid[ny][nx] === '#') continue;
        var ns = sum + valueAt(spec, nx, ny);
        if (ns < -40 || ns > 80) continue;
        var k = nx + ',' + ny + ',' + ns;
        if (seen[k]) continue;
        seen[k] = true;
        q.push([nx, ny, ns, st + 1]);
      }
    }
    return -1;
  }

  function f5ShortestWinning(spec) {
    return f5RemainFrom(spec, spec.start[0], spec.start[1], Number(spec.startValue) || 0);
  }

  function genArith(seed) {
    for (var att = 0; att < 2500; att++) {
      var s2 = (seed + att * 0x27d4eb2d) >>> 0;
      var g = repairConnected(randWallGrid(s2, 9, 31, 34));
      var cells = openCells(g);
      if (!cells.length || !allReachable(g, cells[0])) continue;
      var topo = fullStats(g);
      if (topo.open < 51 || topo.open > 55) continue;
      if (topo.junctions < 14 || topo.junctions > 17) continue;
      if (topo.deadEnds < 10 || topo.deadEnds > 14) continue;
      var pr = pickPair(g, 20, 20, 14, 0.50, null);
      if (!pr) continue;
      var opt = pr.opt, path = pr.path, x, y;
      var vals = [];
      for (y = 0; y < 9; y++) {
        vals.push([]);
        for (x = 0; x < 9; x++) vals[y].push(g[y][x] === '#' ? 0 : 1);
      }
      // 在最短路中间格加 2 分：base=opt，补到 29~34（窗口 [29,37] 内）
      var rnd = mulberry32((s2 ^ 0x5bf03635) >>> 0);
      var inner = path.slice(1, path.length - 1);
      var want = Math.max(0, Math.min(inner.length, 29 - opt));   // 只用 2 分补到窗口下沿：<opt 步绝不可能凑到 29
      var picks = shuffle(inner.slice(), rnd).slice(0, want);
      for (var i = 0; i < picks.length; i++) vals[picks[i][1]][picks[i][0]] = 2;
      // 陷阱：S 2~3 步内、且不在解路径上的死胡同
      g[pr.S[1]][pr.S[0]] = 'S'; g[pr.G[1]][pr.G[0]] = 'G';
      var trap = null, dS = bfsDist(g, pr.S), des = deadEnds(g), onPath = {};
      for (i = 0; i < path.length; i++) onPath[key2(path[i][0], path[i][1])] = true;
      for (i = 0; i < des.length; i++) {
        var q = des[i], qk = key2(q[0], q[1]);
        if (onPath[qk] || g[q[1]][q[0]] === 'G' || g[q[1]][q[0]] === 'S') continue;
        var d0 = dS[qk];
        if (d0 == null || d0 < 2 || d0 > 3) continue;
        trap = q; break;
      }
      if (!trap) continue;
      if (vals[trap[1]][trap[0]] > 0) vals[trap[1]][trap[0]] = -8;
      var spec = baseSpec(g, pr.S, pr.G, 'F5');
      spec.values = vals;
      spec.mode = 'sum';
      spec.gateSum = 34;
      spec.gateLo = Math.ceil(0.85 * 34);
      spec.gateHi = Math.floor(1.10 * 34);
      spec.trap = { x: trap[0], y: trap[1], cost: -8 };
      spec.optSteps = opt; spec.budget = opt; spec.maxSteps = opt;
      spec.solution = path.map(function (c) { return { x: c[0], y: c[1], keys: 0, opened: 0, mask: 0 }; });
      spec.difficulty = 1;
      if (f5ShortestWinning(spec) !== opt) continue;
      var plan = [], sumOk = true;
      for (i = 1; i < path.length; i++) {
        var dx = path[i][0] - path[i - 1][0], dy = path[i][1] - path[i - 1][1];
        plan.push(dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N');
      }
      var chk = simulate(spec, plan);
      if (!chk.reached || chk.used !== opt) continue;
      if (chk.sum < spec.gateLo || chk.sum > spec.gateHi) continue;
      spec.solutionSum = chk.sum;
      spec.topo = topo;
      spec.proximity = pathProximity(g, path);
      return spec;
    }
    return null;
  }

  /* ------------------------------------------------------------ 生成入口 */

  function genOnce(seed, family) {
    if (family === 'F2') return genKeyOrder(seed);
    if (family === 'F3') return genTight(seed);
    if (family === 'F5') return genArith(seed);
    return genSpeed(seed);
  }

  var GEN_RETRY = { F1: 20, F2: 4, F3: 6, F5: 6 };
  var FROZEN_SEEDS = {
    F1: [0x5eed01, 0x5eed02, 0x0f1, 0x0f11],
    F2: [0x5eed01, 0x5eed02, 0x0f2, 0x0f22],
    F3: [0x5eed01, 0x5eed02, 0x0f3, 0x0f33],
    F5: [0x5eed01, 0x5eed02, 0x0f5, 0x0f55]
  };

  /**
   * 生成入口。家族几何固定（F1 7×7，F2/F3/F5 9×9，入参 size 仅兼容）。
   * 生成器内部已按 Fable 表拒绝采样；这里再做 checkFamilySpec 终检，
   * 不过就换 seed+k 重试，仍失败用冻结种子，再失败才抛错。
   */
  /* ------------------------------------------------ 阶梯生成器（bigmap-core.js 骨架 + 家族装配） */
  var BIGMAP = null;
  try {
    if (typeof require === 'function') BIGMAP = require('./bigmap-core.js');
    else if (typeof window !== 'undefined' && window.BigmapCore) BIGMAP = window.BigmapCore;
  } catch (e) { BIGMAP = null; }

  function ladderDecor(spec, map) { return { deco: map.deco, rooms: map.rooms }; }

  /** 把 bigmap 骨架装配成家族 spec：F1 无门 / F2 两钥两门 / F3 预算严格 = opt / F5 代价格累计门 */

  /* ----------------------------------------------------------------------------
     §3 具名机制：叠加在骨架之上，不改拓扑长度（opt 仍由骨架决定）
       d4 假门诱饵  decoy: 主路径 1/3 处旁的死格摆一扇打不开的门（doorIndex=-1），
                    贪心最近邻先撞它 → 白走 2 步 + V 罚一次
       d5 零预算门  zero : 最后一扇门要「一次拿够 2 把钥匙」才开得动，
                    路径上因此必须提前攒满两把；攒一把就冲门 = 被拒
       d6 顺序门    order: 每扇门绑定指定那把钥匙，且最近的钥匙是错的那把，
                    单约束策略（先拿最近的）必然在门口撞墙
     ------------------------------------------------------------ */
  function applyMechanics(spec, grid, path, family, diff, map) {
    var n = path.length;
    if (n < 8) return false;
    function at(t) { return path[Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))))]; }
    function free(c) { return c && grid[c.y] && grid[c.y][c.x] === '.'; }

    // ---- d4 假门诱饵：找一个只贴着主路径一格、其余三面是墙的死格
    if (diff >= 4) {
      var decoy = null, order = [];
      for (var i = 2; i < n - 2; i++) order.push(i);
      order.sort(function (a, b) { return Math.abs(a - n * 0.34) - Math.abs(b - n * 0.34); });
      for (var oi = 0; oi < order.length && !decoy; oi++) {
        var c = path[order[oi]];
        var nb = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (var k = 0; k < 4; k++) {
          var nx = c.x + nb[k][0], ny = c.y + nb[k][1];
          if (nx < 0 || ny < 0 || nx >= map.size || ny >= map.size) continue;
          if (grid[ny][nx] !== '#') continue;
          var around = 0;
          for (var q = 0; q < 4; q++) {
            var ax = nx + nb[q][0], ay = ny + nb[q][1];
            if (ax < 0 || ay < 0 || ax >= map.size || ay >= map.size) continue;
            if (grid[ay][ax] !== '#') around++;
          }
          if (around === 1) { grid[ny][nx] = 'D'; decoy = { x: nx, y: ny }; break; }   // 不写进 doorIndex → 永远开不了
        }
      }
      if (!decoy) return false;
      spec.decoy = decoy;
    }

    // ---- F2 自带两门，机制只做「第二扇门要两把钥匙」
    if (family === 'F2') {
      if (diff >= 5 && spec.doors && spec.doors.length >= 2) {
        spec.doorNeeds = [1, 2];
        var need = 3, have = (spec.keys || []).length;   // 第一门吃 1，第二门要一次拿 2 → 全程 3 把
        for (var pi = 2; pi < n - 2 && have < need; pi++) {
          var pc = path[pi];
          if (!free(pc)) continue;
          grid[pc.y][pc.x] = 'K';
          spec.keys = (spec.keys || []).concat([{ x: pc.x, y: pc.y }]);
          spec.keyIndex[pc.x + ',' + pc.y] = spec.keys.length - 1;
          have++;
        }
        if (have < need) return false;
      }
      return true;
    }

    // ---- 非 F2：自己摆门
    var wantDoors = diff >= 6 ? 2 : (diff >= 5 ? 1 : 0);
    if (wantDoors > 0) {
      var dPts = wantDoors === 2 ? [at(0.46), at(0.72)] : [at(0.58)];
      for (var di = 0; di < dPts.length; di++) if (!free(dPts[di])) return false;
      var seenD = {};
      for (var dj = 0; dj < dPts.length; dj++) {
        var kk = dPts[dj].x + ',' + dPts[dj].y;
        if (seenD[kk]) return false; seenD[kk] = 1;
      }
      spec.doors = []; spec.doorIndex = {};
      for (var dk = 0; dk < dPts.length; dk++) {
        grid[dPts[dk].y][dPts[dk].x] = 'D';
        spec.doors.push({ x: dPts[dk].x, y: dPts[dk].y });
        spec.doorIndex[dPts[dk].x + ',' + dPts[dk].y] = dk;
      }
      spec.keyIndex = spec.keyIndex || {};
      spec.keys = spec.keys || [];

      // 钥匙：d5 起保证门口之前攒够；d6 起最近的钥匙是「错的那把」；d9 自己摆四把
      if (diff >= 9) { spec.doors = spec.doors; spec.keyIndex = {}; spec.keys = spec.keys || []; }
      var kPts = diff >= 6 ? [at(0.16), at(0.33)] : [at(0.24), at(0.40)];
      for (var ki = 0; ki < kPts.length; ki++) if (!free(kPts[ki])) return false;
      // d6：先放 keyIndex=1（离起点最近），再放 keyIndex=0；两把都必须在第一扇门之前
      var plan = diff >= 9 ? [] : (diff >= 6 ? [[kPts[0], 1], [kPts[1], 0]] : [[kPts[0], 0], [kPts[1], 1]]);
      for (var kj = 0; kj < plan.length; kj++) {
        var cell = plan[kj][0], idx = plan[kj][1];
        grid[cell.y][cell.x] = 'K';
        spec.keys.push({ x: cell.x, y: cell.y });
        spec.keyIndex[cell.x + ',' + cell.y] = idx;
      }
      if (diff >= 9) { /* d9 自己布四把钥匙，跳过 d7 交叉依赖布点 */ } else if (diff >= 7 && spec.doors.length >= 2) {
        // d7 顺序门对 + 交叉依赖：门0 要「后放到最前」的那把，门1 的钥匙在门0 之后 → 必须先开门0
        var xk = at(0.56);
        if (!free(xk)) return false;
        grid[xk.y][xk.x] = 'K';
        spec.keys.push({ x: xk.x, y: xk.y });
        if (diff === 7) {
          // d7 收紧（Henry 口径，同 d5）：门0 必须两把钥匙同时持有才开，少一把撞门即判未完成；
          // 门1 要门0 之后（0.56 处）那把钥匙 → 仍保留交叉依赖，先拿最近一把必然卡在门0
          spec.keyIndex[xk.x + ',' + xk.y] = 2;   // 与门前的 key0/key1 用不同位号，否则位图里视为已拿、计数不增
          spec.doorNeeds = [2, 1];
          spec.doorNeedKey = [-1, -1];
        } else {
          spec.keyIndex[xk.x + ',' + xk.y] = 0;
          spec.doorNeeds = [1, 1];
          spec.doorNeedKey = [1, 0];              // 门0 只认 key1（0.16 处那把）、门1 只认 key0（门0 之后）
        }
        spec.crossDep = true;
      } else if (diff >= 6) { spec.doorNeeds = [1, 1]; spec.doorNeedKey = [0, 1]; }   // 顺序门：各一把、且必须是指定那把
      else if (diff >= 5) spec.doorNeeds = [2];
    }
    // ---- d10 陷阱阵：沿主路挑死端埋 6 个陷阱，踩上去多耗 2 步并记一次无效
    if (diff >= 10) {
      var trapIdx = {}, placed = 0;
      for (var ti = 2; ti < n - 2 && placed < 6; ti++) {
        var tc = path[ti], nbs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (var tq = 0; tq < 4; tq++) {
          var tx = tc.x + nbs[tq][0], ty = tc.y + nbs[tq][1];
          if (tx < 0 || ty < 0 || tx >= map.size || ty >= map.size) continue;
          if (grid[ty][tx] !== '.') continue;
          var tAround = 0;
          for (var tq2 = 0; tq2 < 4; tq2++) {
            var axx = tx + nbs[tq2][0], ayy = ty + nbs[tq2][1];
            if (axx < 0 || ayy < 0 || axx >= map.size || ayy >= map.size) continue;
            if (grid[ayy][axx] !== '#') tAround++;
          }
          if (tAround === 1) { grid[ty][tx] = 'T'; trapIdx[tx + ',' + ty] = 2; placed++; break; }
        }
      }
      if (placed < 3) return false;
      spec.trapIndex = trapIdx;
      spec.trapCount = placed;
    }

    // ---- d9 双钥定序：门0 要 key0+key1，门1 要 key2+key3；每扇门缺一把都开不了
    if (diff >= 9) {
      if (!spec.doors || spec.doors.length < 2) return false;
      var roles = [[0.10, 0], [0.18, 1], [0.56, 2], [0.64, 3]];
      for (var ri = 0; ri < roles.length; ri++) {
        var rc = at(roles[ri][0]);
        if (!free(rc)) return false;
        grid[rc.y][rc.x] = 'K';
        spec.keys.push({ x: rc.x, y: rc.y });
        spec.keyIndex[rc.x + ',' + rc.y] = roles[ri][1];
      }
      spec.doorNeeds = [2, 2];
      spec.doorNeedKey = [-1, -1];
      spec.doorKeys = { 0: [0, 1], 1: [2, 3] };
      spec.dualKeyed = true;
    }

    // ---- d8 不可逆算数门：门0 单向（过后原路封死）；门槛与代价格在 finishSpec 之后按真实最优解算
    if (diff >= 8) {
      if (!spec.doors || !spec.doors.length) return false;
      spec.wantGate = true;
      spec.oneWay = true; spec.oneWayDoor = 0;
    }

    // ---- d11 镜像陷阱：整张图左右镜像，起终点与所有道具坐标一起换 → 记路要重新算
    if (diff >= 11) {
      var size2 = map.size, mg = [];
      for (var my = 0; my < size2; my++) {
        var row = [];
        for (var mx = 0; mx < size2; mx++) row.push(grid[my][size2 - 1 - mx]);
        mg.push(row);
      }
      for (var my2 = 0; my2 < size2; my2++) for (var mx2 = 0; mx2 < size2; mx2++) grid[my2][mx2] = mg[my2][mx2];
      function fx(x) { return size2 - 1 - x; }
      spec.start = [fx(spec.start[0]), spec.start[1]];
      spec.exit = [fx(spec.exit[0]), spec.exit[1]];
      (spec.keys || []).forEach(function (k) { k.x = fx(k.x); });
      (spec.doors || []).forEach(function (d) { d.x = fx(d.x); });
      (function remap(idx) {
        var out = {};
        Object.keys(idx || {}).forEach(function (key) {
          var p2 = key.split(','), nx2 = fx(+p2[0]), ny2 = +p2[1];
          out[nx2 + ',' + ny2] = idx[key];
        });
        return out;
      });
      spec.keyIndex = (function () {
        var out = {};
        Object.keys(spec.keyIndex || {}).forEach(function (key) {
          var p3 = key.split(','); out[fx(+p3[0]) + ',' + p3[1]] = spec.keyIndex[key];
        });
        return out;
      })();
      spec.doorIndex = (function () {
        var out = {};
        Object.keys(spec.doorIndex || {}).forEach(function (key) {
          var p4 = key.split(','); out[fx(+p4[0]) + ',' + p4[1]] = spec.doorIndex[key];
        });
        return out;
      })();
      if (spec.trapIndex) {
        var tOut = {};
        Object.keys(spec.trapIndex).forEach(function (key) {
          var p5 = key.split(','); tOut[fx(+p5[0]) + ',' + p5[1]] = spec.trapIndex[key];
        });
        spec.trapIndex = tOut;
      }
      if (spec.values) {
        var vOut = [];
        for (var vy2 = 0; vy2 < size2; vy2++) { var vr = []; for (var vx2 = 0; vx2 < size2; vx2++) vr.push(spec.values[vy2][size2 - 1 - vx2]); vOut.push(vr); }
        spec.values = vOut;
      }
      if (spec.decoy) spec.decoy = { x: fx(spec.decoy.x), y: spec.decoy.y };
      spec.mirrored = true;
      spec.grid = grid;
    }

    return true;
  }

  function buildLadderSpec(map, family, diff, plus) {
    var grid = map.grid.map(function (r) { return r.split(''); });
    var path = map.path || [];
    if (path.length !== map.opt + 1) return null;
    var spec = baseSpec(grid, [map.start[0], map.start[1]], [map.goal[0], map.goal[1]], family);
    spec.diff = diff;
    spec.seedHint = map.seed;

    function at(t) { return path[Math.min(path.length - 1, Math.max(0, Math.round(t * (path.length - 1))))]; }

    if (family === 'F2') {
      if (path.length < 9) return null;
      var k1 = at(0.20), d1 = at(0.42), k2 = at(0.64), d2 = at(0.84);
      var pts = [k1, d1, k2, d2], seen = {};
      for (var i = 0; i < pts.length; i++) {
        var key = pts[i].x + ',' + pts[i].y;
        if (seen[key]) return null; seen[key] = 1;
        if (grid[pts[i].y][pts[i].x] !== '.') return null;
      }
      grid[k1.y][k1.x] = 'K'; grid[d1.y][d1.x] = 'D';
      grid[k2.y][k2.x] = 'K'; grid[d2.y][d2.x] = 'D';
      spec.keys = [{ x: k1.x, y: k1.y }, { x: k2.x, y: k2.y }];
      spec.doors = [{ x: d1.x, y: d1.y }, { x: d2.x, y: d2.y }];
      spec.doorIndex = {}; spec.doorIndex[d1.x + ',' + d1.y] = 0; spec.doorIndex[d2.x + ',' + d2.y] = 1;
      spec.keyIndex = {}; spec.keyIndex[k1.x + ',' + k1.y] = 0; spec.keyIndex[k2.x + ',' + k2.y] = 1;
    }

    if (!applyMechanics(spec, grid, path, family, diff, map)) return null;

    finishSpec(spec, { budgetPlus: plus });

    if (family === 'F5') {
      // 代价格必须挂在**最优解实际经过的格**上（骨架可能被装饰成等长多解）
      var vals = [], y, x, sum = 0;
      for (y = 0; y < map.size; y++) { vals.push([]); for (x = 0; x < map.size; x++) vals[y].push(0); }
      var sol = spec.solution || [];
      for (var j = 1; j < sol.length; j++) {
        var v = 1 + ((j * 7 + diff * 3) % 9);
        vals[sol[j].y][sol[j].x] = v; sum += v;
      }
      spec.values = vals; spec.mode = 'sum';
      spec.gateSum = sum; spec.gateLo = sum; spec.gateHi = sum;
      spec.maxSteps = spec.budget || spec.optSteps;      // 阶梯里 F5 的步数上限 = 本档预算
    }
    if (spec.wantGate && family !== 'F5') {
      var gvals = [], gy, gx;
      for (gy = 0; gy < map.size; gy++) { gvals.push([]); for (gx = 0; gx < map.size; gx++) gvals[gy].push(0); }
      var gsol = spec.solution || [], d0g = spec.doors[0], gsum = 0, hit = false;
      for (var gi = 1; gi < gsol.length; gi++) {
        if (gsol[gi].x === d0g.x && gsol[gi].y === d0g.y) { hit = true; break; }
        gvals[gsol[gi].y][gsol[gi].x] = 1 + (gi % 3);
        gsum += gvals[gsol[gi].y][gsol[gi].x];
      }
      if (!hit || gsum <= 0) return null;
      spec.values = gvals; spec.mode = 'sum';
      spec.gateDoors = [{ doorIndex: 0, minSum: gsum }];
    }

    if (spec.optSteps !== map.opt) return null;         // 家族装配不许改步数（§2 读表要点）
    spec.budget = spec.optSteps + plus + (spec.extraBudget || 0);
    if (family === 'F3') spec.budget = spec.optSteps + Math.max(0, plus);
    spec.difficulty = diff;
    spec.ladder = { diff: diff, size: map.size, deco: map.deco, rooms: map.rooms, opt: map.opt };
    return spec;
  }

  /** genLadder(seed, family, diff)：按档位生成（d1–d11 同一套骨架算法，画布随档位放大） */
  function genLadder(seed, family, diff) {
    if (!BIGMAP) return null;
    var t = TARGET_BY_DIFF[diff];
    if (!t) return null;
    var plus = t[family] != null ? t[family] : 1;
    var decoTarget = Math.round(t.size * t.size * t.deco);
    var s0 = (Number(seed) >>> 0) || 1;
    for (var k = 0; k < 10; k++) {
      var m = BIGMAP.genBigMap((s0 + k * 2654435761) >>> 0, {
        size: t.size, optMin: t.opt[0], optMax: t.opt[1], deco: decoTarget, rooms: t.rooms
      });
      if (!m) continue;
      var v = BIGMAP.verifyShortest(m);
      if (!v.ok || v.opt < t.opt[0] || v.opt > t.opt[1]) continue;
      var spec = null;
      try { spec = buildLadderSpec(m, family, diff, plus); } catch (e) { spec = null; }
      if (!spec) continue;
      var o = solveOpt(spec);
      if (o.cost !== spec.optSteps) continue;           // 装配后最短路必须没变
      spec.family = family; spec.seed = s0;
      return spec;
    }
    return null;
  }

  function genFamily(seed, family, size, diff) {
    var s = (Number(seed) >>> 0) || 1;
    if (FAMILY_IDS.indexOf(family) < 0) family = 'F1';
    if (diff) {
      var lad = null;
      try { lad = genLadder(s, family, diff); } catch (e) { lad = null; }
      if (lad) return lad;
    }
    var spec = null, tries = GEN_RETRY[family] || 10;
    for (var k = 0; k < tries; k++) {
      try { spec = genOnce((s + k * 2654435761) >>> 0, family); } catch (e) { spec = null; }
      if (spec && checkFamilySpec(spec).ok) break;
      spec = null;
    }
    if (!spec) {
      var fs = FROZEN_SEEDS[family] || [];
      for (var j = 0; j < fs.length && !spec; j++) {
        try { spec = genOnce(fs[j], family); } catch (e2) { spec = null; }
        if (spec && !checkFamilySpec(spec).ok) spec = null;
      }
    }
    if (!spec) throw new Error('genFamily failed: ' + family + ' seed=' + s);
    spec.family = family;
    spec.seed = s;
    return spec;
  }

  /* ------------------------------------------------------------ 家族自检（供 test / 验收使用） */

  var FAMILY_TARGET = {
    F1: { size: 7, open: [27, 31], j: [12, 15], de: [5, 7], opt: [9, 9], budgetPlus: 1, mdMax: 7 },
    F2: { size: 9, open: [47, 51], j: [8, 11], de: [6, 9], opt: [16, 16], budgetPlus: 2, mdMax: 12 },
    F3: { size: 9, open: [49, 53], j: [10, 14], de: [8, 12], opt: [24, 24], budgetPlus: 1, mdMax: 18 },
    F5: { size: 9, open: [51, 55], j: [14, 17], de: [10, 14], opt: [20, 20], budgetPlus: 0, mdMax: 14 }
  };

  function specPathXY(spec) {
    if (spec.solution && spec.solution.length > 1) {
      return spec.solution.map(function (st) { return [st.x, st.y]; });
    }
    return bfsPath(spec.grid, spec.start, spec.exit) || [spec.start];
  }

  function checkFamilySpec(spec) {
    var fails = [];
    if (!spec || !spec.grid) return { ok: false, fails: ['no-spec'] };
    var fam = spec.family, S = spec.start, G = spec.exit, t = FAMILY_TARGET[fam];
    if (!t) return { ok: false, fails: ['unknown-family:' + fam] };
    var dS = bfsDist(spec.grid, S);
    var topo = fullStats(spec.grid);
    if (spec.optSteps < 0) fails.push('unsolvable');
    if (dS[key2(G[0], G[1])] == null) fails.push('exit-unreachable-terrain');
    if (spec.grid.length !== t.size) fails.push('size!=' + t.size);
    if (topo.open < t.open[0] || topo.open > t.open[1]) fails.push('open:' + topo.open);
    if (topo.junctions < t.j[0] || topo.junctions > t.j[1]) fails.push('junctions:' + topo.junctions);
    if (topo.deadEnds < t.de[0] || topo.deadEnds > t.de[1]) fails.push('deadEnds:' + topo.deadEnds);
    if (spec.optSteps < t.opt[0] || spec.optSteps > t.opt[1]) fails.push('opt:' + spec.optSteps);
    if (spec.budget !== spec.optSteps + t.budgetPlus) fails.push('budget:' + spec.budget);
    if (!allReachable(spec.grid, S)) fails.push('not-all-reachable');
    var md = Math.abs(S[0] - G[0]) + Math.abs(S[1] - G[1]);
    if (md > t.mdMax) fails.push('md:' + md);
    if (pathProximity(spec.grid, specPathXY(spec)) < 0.50) fails.push('proximity');
    if (fam === 'F1') {
      if (spec.doorCount) fails.push('f1-has-door');
    } else if (fam === 'F2') {
      if (spec.doorCount !== 2) fails.push('doors!=2:' + spec.doorCount);
      if (spec.keyCount < 2) fails.push('keys<2:' + spec.keyCount);
      var r0 = bfsDistWalls(spec.grid, S, spec.doorIndex, 0);
      var r1 = bfsDistWalls(spec.grid, S, spec.doorIndex, 1);
      var r2 = bfsDistWalls(spec.grid, S, spec.doorIndex, 2);
      if (r0[key2(G[0], G[1])] != null) fails.push('doors-bypassable');
      if (r1[key2(G[0], G[1])] != null) fails.push('one-key-enough');
      if (r2[key2(G[0], G[1])] == null) fails.push('two-doors-not-enough');
      if (spec.keys[0] && r0[key2(spec.keys[0].x, spec.keys[0].y)] == null) fails.push('k1-not-outer');
      if (spec.keys[1] && (r1[key2(spec.keys[1].x, spec.keys[1].y)] == null || r0[key2(spec.keys[1].x, spec.keys[1].y)] != null)) fails.push('k2-not-behind-d1');
      if (spec.solution) {
        var opened = 0;
        spec.solution.forEach(function (st) { if (spec.doorIndex[key2(st.x, st.y)] != null) opened++; });
        if (opened < 2) fails.push('solution-opens<2');
      }
    } else if (fam === 'F3') {
      if (spec.doorCount) fails.push('f3-has-door');
      if (!spec.fakePath) fails.push('no-fake-path');
      if (spec.fakePath && spec.fakePath.length - 1 >= spec.optSteps) fails.push('fake-not-short');
    } else if (fam === 'F5') {
      if (spec.maxSteps !== spec.optSteps) fails.push('maxSteps!=opt');
      if (spec.gateLo !== 29 || spec.gateHi !== 37) fails.push('window:' + spec.gateLo + '-' + spec.gateHi);
      var digitCells = 0;
      for (var y = 0; y < 9; y++) for (var x = 0; x < 9; x++) {
        var v = spec.values[y][x];
        if (v > 0) { digitCells++; if (v > 9) fails.push('digit>9'); }
      }
      if (digitCells < 8) fails.push('digitCells<8');
      if (!spec.trap || spec.trap.cost >= 0) fails.push('trap-not-negative');
      if (f5ShortestWinning(spec) !== spec.optSteps) fails.push('nstar-mismatch');
      if (!spec.solution || spec.solution.length - 1 !== spec.optSteps) fails.push('solution-length');
      else {
        var solPlan = [], hitTrap = false;
        for (var i = 1; i < spec.solution.length; i++) {
          var a = spec.solution[i - 1], b = spec.solution[i];
          var dx = b.x - a.x, dy = b.y - a.y;
          solPlan.push(dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N');
          if (b.x === spec.trap.x && b.y === spec.trap.y) hitTrap = true;
        }
        if (hitTrap) fails.push('trap-on-solution');
        var sim = simulate(spec, solPlan);
        if (!sim.reached) fails.push('solution-not-winning');
        if (sim.used !== spec.optSteps) fails.push('solution-steps:' + sim.used);
        if (sim.sum < spec.gateLo || sim.sum > spec.gateHi) fails.push('solution-sum:' + sim.sum);
      }
    }
    return { ok: fails.length === 0, fails: fails };
  }

  /* ------------------------------------------------------------ 导出 */

  var api = {
    mulberry32: mulberry32, carve: carve, shuffle: shuffle,
    bfsDist: bfsDist, bfsFrom: bfsDistWalls, bfsPath: bfsPath, bfsDistWalls: bfsDistWalls,
    deadEnds: deadEnds, degree: degree, neighbors: neighbors, allReachable: allReachable,
    solveOpt: solveOpt, remainFrom: remainFrom, stateSearch: stateSearch, stateDistOf: stateDistOf,
    nEffOf: nEffOf, simulate: simulate,
    parseStrict: parseStrict, parseSubmission: parseSubmission, toPlan: toPlan,
    scoreRound: scoreRound, scoreRoundPartial: scoreRoundPartial, scoreFrom: scoreFrom, creditsOf: creditsOf,
    matchScore: matchScore, decide: decide, judgeRound: judgeRound,
    genFamily: genFamily, genSpeed: genSpeed, genKeyOrder: genKeyOrder, genTight: genTight, genArith: genArith,
    topoStats: topoStats, fullStats: fullStats, repairConnected: repairConnected, pickPair: pickPair, pathProximity: pathProximity, findPocket: findPocket, randWallGrid: randWallGrid, FAMILY_TARGET: FAMILY_TARGET, randGrid: randGrid, f5RemainFrom: f5RemainFrom, f5ShortestWinning: f5ShortestWinning,
    finishSpec: finishSpec, baseSpec: baseSpec, checkFamilySpec: checkFamilySpec,
    FAMILIES: FAMILIES, FAMILY_IDS: FAMILY_IDS, P0_META: P0_META,
    TARGET_BY_DIFF: TARGET_BY_DIFF,
    TARGET_DONE: TARGET_DONE, baseFromRate: baseFromRate, LADDER_SEEDS: LADDER_SEEDS, DIFF_MAX: DIFF_MAX,
    bandOf: bandOf, bandRange: bandRange, pickDiff: pickDiff, genLadder: genLadder,
    pointsOf: pointsOf, clamp: clamp, W3: W3
  };

  function pointsOf(results) {
    var p = { A: 0, B: 0 };
    (results || []).forEach(function (r) {
      if (r === 'A') p.A++; else if (r === 'B') p.B++; else { p.A += 0.5; p.B += 0.5; }
    });
    return p;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaCore2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
