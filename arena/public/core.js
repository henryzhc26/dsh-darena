/* D宠大乐斗 2.0 · 大乐斗核心（纯函数，浏览器与 node 通用）
 * 地图：9x9，'#'=墙 '.'=地 'S'=起点 'G'=终点 'K'=钥匙 'D'=门
 * 规则：走到 K 自动拾取；没有钥匙时 D 不可通过。
 * 计划：一串方向字母（N/S/E/W），空格或逗号分隔都可。
 */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DIRS = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

  function clone(g) { return g.map(function (r) { return r.slice(); }); }

  // 挖迷宫：奇数尺寸，墙体在偶数格
  function carve(size, rnd) {
    var g = [];
    for (var y = 0; y < size; y++) { g.push(new Array(size).fill('#')); }
    var stack = [[1, 1]];
    g[1][1] = '.';
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var x = cur[0], y = cur[1];
      var opts = [];
      [[0, -2], [0, 2], [-2, 0], [2, 0]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && g[ny][nx] === '#') opts.push(d);
      });
      if (!opts.length) { stack.pop(); continue; }
      var d = opts[Math.floor(rnd() * opts.length)];
      g[y + d[1] / 2][x + d[0] / 2] = '.';
      g[y + d[1]][x + d[0]] = '.';
      stack.push([x + d[0], y + d[1]]);
    }
    // 随机打通几堵墙，形成多条路线（避免唯一解）
    var extra = 2 + Math.floor(rnd() * 3);
    for (var i = 0; i < extra; i++) {
      var wx = 1 + Math.floor(rnd() * (size - 2));
      var wy = 1 + Math.floor(rnd() * (size - 2));
      if (g[wy][wx] === '#' && ((wx % 2 === 0) !== (wy % 2 === 0))) g[wy][wx] = '.';
    }
    return g;
  }

  // BFS：状态 [x, y, hasKey]
  function bfs(g, start) {
    var size = g.length;
    var dist = {}, prev = {};
    var q = [[start[0], start[1], 0]];
    var k0 = start[0] + ',' + start[1] + ',0';
    dist[k0] = 0; prev[k0] = null;
    while (q.length) {
      var s = q.shift();
      var x = s[0], y = s[1], hk = s[2];
      var k = x + ',' + y + ',' + hk;
      var d0 = dist[k];
      for (var name in DIRS) {
        var nx = x + DIRS[name][0], ny = y + DIRS[name][1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        var t = g[ny][nx];
        if (t === '#') continue;
        if (t === 'D' && !hk) continue;
        var nh = hk || (t === 'K' ? 1 : 0);
        var nk = nx + ',' + ny + ',' + nh;
        if (dist[nk] !== undefined) continue;
        dist[nk] = d0 + 1;
        prev[nk] = k;
        q.push([nx, ny, nh]);
      }
    }
    return { dist: dist, prev: prev };
  }

  function pathTo(b, goal, hasKey) {
    var k = goal[0] + ',' + goal[1] + ',' + hasKey;
    if (b.dist[k] === undefined) return null;
    var out = [];
    while (k) {
      var p = k.split(',');
      out.push([Number(p[0]), Number(p[1])]);
      k = b.prev[k];
    }
    return out.reverse();
  }

  function findChar(g, ch) {
    for (var y = 0; y < g.length; y++) for (var x = 0; x < g.length; x++) if (g[y][x] === ch) return [x, y];
    return null;
  }

  // 生成一关：终点藏在死胡同里，门口放门 → 必须先拿钥匙
  function genMap(seed, opts) {
    opts = opts || {};
    var minLen = opts.minLen || 8, maxLen = opts.maxLen || 16;
    var size = opts.size || 9;
    for (var attempt = 0; attempt < 400; attempt++) {
      var rnd = mulberry32(seed + attempt * 7919);
      var g = carve(size, rnd);
      var start = [1, 1];
      g[start[1]][start[0]] = 'S';
      var b0 = bfs(g, start);

      // 找死胡同作为终点候选
      var ends = [];
      for (var y = 1; y < size - 1; y++) for (var x = 1; x < size - 1; x++) {
        if (g[y][x] !== '.') continue;
        var nb = [];
        for (var dn in DIRS) {
          var nx = x + DIRS[dn][0], ny = y + DIRS[dn][1];
          if (g[ny] && g[ny][nx] !== undefined && g[ny][nx] !== '#') nb.push([nx, ny]);
        }
        if (nb.length !== 1) continue;
        var d0 = b0.dist[x + ',' + y + ',0'];
        if (d0 === undefined || d0 < minLen - 2 || d0 > maxLen + 2) continue;
        ends.push({ cell: [x, y], door: nb[0], dist: d0 });
      }
      if (!ends.length) continue;

      var pick = ends[Math.floor(rnd() * ends.length)];
      var goal = pick.cell, door = pick.door;
      g[goal[1]][goal[0]] = 'G';
      g[door[1]][door[0]] = 'D';

      // 钥匙：门外的任意通道，离起点至少 3 步
      var b1 = bfs(g, start);
      var keys = [];
      for (var yy = 1; yy < size - 1; yy++) for (var xx = 1; xx < size - 1; xx++) {
        if (g[yy][xx] !== '.') continue;
        var dk = b1.dist[xx + ',' + yy + ',0'];
        if (dk === undefined || dk < 3) continue;
        keys.push([xx, yy]);
      }
      if (!keys.length) continue;
      var key = keys[Math.floor(rnd() * keys.length)];
      g[key[1]][key[0]] = 'K';

      // 验证：没钥匙到不了终点，有钥匙能到
      var b2 = bfs(g, start);
      if (b2.dist[goal[0] + ',' + goal[1] + ',0'] !== undefined) continue;
      var path = pathTo(b2, goal, 1);
      if (!path) continue;
      var bestLen = path.length - 1;
      if (bestLen < minLen || bestLen > maxLen) continue;

      return {
        seed: seed + attempt * 7919,
        size: size,
        grid: g,
        start: start,
        goal: goal,
        key: key,
        door: door,
        bestLen: bestLen,
        bestPath: path,
        attempt: attempt
      };
    }
    return null;
  }

  // 解析模型输出
  function parsePlan(text) {
    if (!text) return { plan: [], raw: '', ok: false };
    var m = String(text).match(/<PLAN>([\s\S]*?)<\/PLAN>/i);
    var body = m ? m[1] : '';
    var tipm = String(text).match(/<TIP>([\s\S]*?)<\/TIP>/i);
    var tip = tipm ? tipm[1].trim().slice(0, 60) : '';
    if (!body) {
      // 兜底：只认「整行都是单字母方向」的行，避免把 "We need" 这类散文当成路线
      var lines = String(text).split(/\r?\n/);
      for (var li = lines.length - 1; li >= 0; li--) {
        var line = lines[li].trim().replace(/^[<\[（(]+|[>\]）)]+$/g, '').trim();
        if (!line) continue;
        var toks = line.split(/[\s,，]+/).filter(Boolean);
        if (toks.length >= 3 && toks.every(function (t) { return /^[NSEWnsew]$/.test(t); })) { body = line; break; }
      }
    }
    // 兼容英文方向单词（DOWN/RIGHT…）与中文
    var words = { NORTH: 'N', UP: 'N', SOUTH: 'S', DOWN: 'S', EAST: 'E', RIGHT: 'E', WEST: 'W', LEFT: 'W', '北': 'N', '南': 'S', '东': 'E', '西': 'W' };
    body = body.toUpperCase()
      .replace(/\b(NORTH|SOUTH|EAST|WEST|UP|DOWN|RIGHT|LEFT)\b/g, function (w) { return words[w] || ''; })
      .replace(/[北南东西]/g, function (w) { return words[w] || ''; });
    var tok = body.toUpperCase().replace(/[^NSEW]/g, '');
    var plan = tok.split('');
    return { plan: plan, raw: body.trim(), tip: tip, ok: plan.length > 0 };
  }

  // 模拟执行
  function simulate(map, plan) {
    var g = map.grid, size = map.size;
    var x = map.start[0], y = map.start[1];
    var hasKey = false;
    var steps = [{ x: x, y: y, ev: 'start' }];
    var actions = [{ type: 'start', x: x, y: y, ev: 'start' }];
    var invalid = 0, keys = 0, doors = 0, reached = false;
    for (var i = 0; i < plan.length; i++) {
      var d = DIRS[plan[i]];
      if (!d) { invalid++; actions.push({ type: 'bump', x: x, y: y, dir: plan[i] }); continue; }
      var nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) { invalid++; actions.push({ type: 'bump', x: x, y: y, dir: plan[i] }); continue; }
      var t = g[ny][nx];
      if (t === '#') { invalid++; actions.push({ type: 'bump', x: x, y: y, dir: plan[i] }); continue; }
      if (t === 'D' && !hasKey) { invalid++; actions.push({ type: 'bump', x: x, y: y, dir: plan[i], ev: 'locked' }); continue; }
      var px = x, py = y;
      x = nx; y = ny;
      var ev = 'move';
      if (t === 'K') { hasKey = true; keys++; ev = 'key'; }
      if (t === 'D') { doors++; ev = 'door'; }
      if (t === 'G') { reached = true; ev = 'goal'; }
      steps.push({ x: x, y: y, ev: ev });
      actions.push({ type: 'move', x: x, y: y, from: [px, py], dir: plan[i], ev: ev });
      if (reached) break;
    }
    // 未到达时算离终点还有多远（从当前位置到 G，按当前是否持钥匙）
    var remain = null;
    if (!reached) {
      var bg = bfs(g, [x, y]);
      var gk = g[map.goal[1]][map.goal[0]];
      void gk;
      var a1 = bg.dist[map.goal[0] + ',' + map.goal[1] + ',1'];
      var a0 = bg.dist[map.goal[0] + ',' + map.goal[1] + ',0'];
      if (hasKey && a1 !== undefined) remain = a1;
      else if (a0 !== undefined) remain = a0;
      else if (a1 !== undefined) remain = a1 + 6; // 还得先去拿钥匙
      else remain = 99;
    }
    return {
      steps: steps, actions: actions, reached: reached, invalid: invalid, keys: keys, doors: doors,
      moves: steps.length - 1, remain: remain, end: [x, y], hasKey: hasKey
    };
  }

  // 评分：到达为主，步数与用时为辅
  function score(run, ms, tactic) {
    var t = tactic || 'steady';
    var speedW = t === 'rush' ? 6 : t === 'steady' ? 4 : 3;
    var stepW = t === 'steady' ? 10 : t === 'rush' ? 6 : 8;
    if (run.reached) {
      var base = 1000;
      var stepBonus = Math.max(0, 300 - run.moves * stepW);
      var timeBonus = Math.max(0, 180 - Math.round(ms / 1000) * speedW);
      var penalty = run.invalid * 20;
      var mult = t === 'gamble' ? 1.15 : 1;
      return Math.round((base + stepBonus + timeBonus - penalty) * mult);
    }
    var left = run.remain === null ? 30 : run.remain;
    return Math.max(0, 260 - left * 12 - run.invalid * 10);
  }

  // 胜负判定顺序（Henry 2026-11-12 定）：先比分数差（≥8 分直接分胜负），不足再比是否到终点 → 剩余步数 → 推进深度；全平则平局
  function judge(a, b) {
    if (a.reached !== b.reached) return a.reached ? 'A' : 'B';
    if (a.moves !== b.moves) return a.moves < b.moves ? 'A' : 'B';
    if (a.ms !== b.ms) return a.ms < b.ms ? 'A' : 'B';
    return 'D';
  }

  var api = {
    mulberry32: mulberry32, genMap: genMap, bfs: bfs, parsePlan: parsePlan,
    simulate: simulate, score: score, judge: judge, DIRS: DIRS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
