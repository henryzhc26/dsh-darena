/* bigmap-core.js — 大画布骨架生成器（d9–d11 / 最高 29×29）
 *
 * 设计口径（Fable 难度阶梯 v2 §1–§3）：
 *   - 骨架层：一条「自避游走」的精确计步主路径，长度 = opt，绝不与其他格接触，
 *     所以 S→G 的最短路**恒等于** opt（不是近似、不是抽样验证）。
 *   - 装饰层：死胡同支路、房间、陷阱格，全部只在「只与一个骨架格相邻」的位置生长，
 *     因此不可能产生捷径；生成后仍跑一次 BFS 复核，不一致就丢掉该装饰。
 *   - 生成后 verifyShortest()：dist !== opt 直接返回 null，调用方换 seed。
 *
 * 供 core2.js / bigmap-preview.html / node 工具共用。
 */
(function (root) {
  'use strict';

  function mulberry32(a) {
    a = (a >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function blank(size) {
    var g = [];
    for (var y = 0; y < size; y++) { var row = []; for (var x = 0; x < size; x++) row.push('#'); g.push(row); }
    return g;
  }

  function bfsDist(grid, sx, sy) {
    var n = grid.length, dist = {}, q = [[sx, sy]];
    dist[sx + ',' + sy] = 0;
    for (var h = 0; h < q.length; h++) {
      var cx = q[h][0], cy = q[h][1], base = dist[cx + ',' + cy];
      for (var d = 0; d < 4; d++) {
        var nx = cx + D4[d][0], ny = cy + D4[d][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (grid[ny][nx] === '#') continue;
        var k = nx + ',' + ny;
        if (dist[k] !== undefined) continue;
        dist[k] = base + 1; q.push([nx, ny]);
      }
    }
    return dist;
  }

  /** 骨架：长度恰为 want 的自避游走（纯走廊，不与自身接触） */
  function carveSkeleton(rnd, size, want) {
    var lo = 1, hi = size - 2;
    var sx = lo + Math.floor(rnd() * (hi - lo + 1));
    var sy = lo + Math.floor(rnd() * (hi - lo + 1));
    var path = [[sx, sy]], mark = {};
    mark[sx + ',' + sy] = 1;

    // 允许挨着「上一格」和「当前格」，其它已占格一律不许碰 → 保证是一条纯走廊
    function neighboursClear(x, y, exempt) {
      var touch = 0;
      for (var d = 0; d < 4; d++) {
        var nx = x + D4[d][0], ny = y + D4[d][1];
        var k = nx + ',' + ny;
        if (!mark[k]) continue;
        if (exempt.indexOf(k) >= 0) continue;
        touch++;
      }
      return touch === 0;
    }

    function step(depth) {
      if (depth === want) return true;
      var dirs = shuffle([0, 1, 2, 3], rnd);
      var cur = path[depth];
      var prevKey = depth > 0 ? path[depth - 1][0] + ',' + path[depth - 1][1] : null;
      var curKey = cur[0] + ',' + cur[1];
      var exempt = prevKey ? [prevKey, curKey] : [curKey];
      for (var i = 0; i < 4; i++) {
        var nx = cur[0] + D4[dirs[i]][0], ny = cur[1] + D4[dirs[i]][1];
        if (nx < lo || ny < lo || nx > hi || ny > hi) continue;
        var k = nx + ',' + ny;
        if (mark[k]) continue;
        if (!neighboursClear(nx, ny, exempt)) continue;
        mark[k] = 1; path.push([nx, ny]);
        if (step(depth + 1)) return true;
        delete mark[k]; path.pop();
      }
      return false;
    }

    if (!step(0)) return null;
    return path;
  }

  /** 装饰支路：从任意已有地板格长出去，新格只与「上一格」相邻 → 不可能成捷径 */
  function growBranch(grid, floors, rnd, maxLen) {
    var n = grid.length;
    for (var t = 0; t < 12; t++) {
      var from = floors[Math.floor(rnd() * floors.length)];
      var d = D4[Math.floor(rnd() * 4)];
      var len = 1 + Math.floor(rnd() * maxLen);
      var cells = [], cx = from[0], cy = from[1], ok = true;
      for (var i = 0; i < len; i++) {
        cx += d[0]; cy += d[1];
        if (cx < 1 || cy < 1 || cx > n - 2 || cy > n - 2) { ok = false; break; }
        if (grid[cy][cx] !== '#') { ok = false; break; }
        var floorsN = 0;
        for (var q = 0; q < 4; q++) {
          var px = cx + D4[q][0], py = cy + D4[q][1];
          if (px < 0 || py < 0 || px >= n || py >= n) continue;
          if (grid[py][px] !== '#') floorsN++;
        }
        if (floorsN !== 1) { ok = false; break; }   // 只挨着上一格，才不会有第二条路
        grid[cy][cx] = '.';
        cells.push([cx, cy]);
      }
      if (ok && cells.length) { for (var c = 0; c < cells.length; c++) floors.push(cells[c]); return cells.length; }
      for (var r = 0; r < cells.length; r++) grid[cells[r][1]][cells[r][0]] = '#';
    }
    return 0;
  }

  /** 房间：把某个走廊格就地拓宽成 2×2 / 3×2 方厅（只吃掉墙，不改通行关系） */
  function carveRoom(grid, floors, rnd) {
    var n = grid.length;
    for (var t = 0; t < 40; t++) {
      var f = floors[Math.floor(rnd() * floors.length)];
      var w = 2 + Math.floor(rnd() * 2), h = 2;
      var x0 = f[0] - Math.floor(rnd() * w), y0 = f[1] - Math.floor(rnd() * h);
      if (x0 < 1 || y0 < 1 || x0 + w > n - 1 || y0 + h > n - 1) continue;
      var cells = [], bad = false;
      for (var y = y0; y < y0 + h && !bad; y++) for (var x = x0; x < x0 + w; x++) {
        if (grid[y][x] !== '#' && !(x === f[0] && y === f[1])) { bad = true; break; }
        if (grid[y][x] === '#') cells.push([x, y]);
      }
      if (bad || cells.length < 3) continue;
      for (var c = 0; c < cells.length; c++) grid[cells[c][1]][cells[c][0]] = '.';
      for (var e = 0; e < cells.length; e++) floors.push(cells[e]);
      return cells.length + 1;
    }
    return 0;
  }

  /**
   * genBigMap(seed, {size, optMin, optMax, deco, rooms, roomCap})
   * 返回 {size, grid, start, goal, opt, deco, roomCells, path} 或 null（调用方换 seed）
   */
  function genBigMap(seed, opts) {
    opts = opts || {};
    var size = opts.size || 21;
    var optMin = opts.optMin || 18;
    var optMax = opts.optMax || optMin;
    var rnd = mulberry32((Number(seed) >>> 0) || 1);

    for (var attempt = 0; attempt < 40; attempt++) {
      var want = optMin + Math.floor(rnd() * (optMax - optMin + 1));
      var path = carveSkeleton(rnd, size, want);
      if (!path) continue;

      var grid = blank(size);
      for (var i = 0; i < path.length; i++) grid[path[i][1]][path[i][0]] = '.';
      var start = path[0], goal = path[path.length - 1];

      // 装饰层：先房间后死路；每加一块都 BFS 复核，缩短主路的立刻回滚
      var floors = path.map(function (p) { return [p[0], p[1]]; });
      var roomCells = 0, roomsWanted = opts.rooms || 0, roomsMade = 0;
      var roomGuard = 0;
      while (roomsMade < roomsWanted && roomGuard++ < roomsWanted * 60) {
        var before = grid.map(function (r) { return r.join(''); });
        var nFloors = floors.length;
        var got = carveRoom(grid, floors, rnd);
        if (!got) continue;
        var d = bfsDist(grid, start[0], start[1]);
        if (d[goal[0] + ',' + goal[1]] !== want) {
          for (var y = 0; y < size; y++) grid[y] = before[y].split('');
          floors.length = nFloors;
          continue;
        }
        roomCells += got; roomsMade++;
      }

      var decoTarget = opts.deco || 0, deco = 0, guard = 0;
      while (deco < decoTarget && guard++ < decoTarget * 6) {
        var before2 = grid.map(function (r) { return r.join(''); });
        var nFloors2 = floors.length;
        var got2 = growBranch(grid, floors, rnd, 4);
        if (!got2) continue;
        var d2 = bfsDist(grid, start[0], start[1]);
        if (d2[goal[0] + ',' + goal[1]] !== want) {
          for (var y2 = 0; y2 < size; y2++) grid[y2] = before2[y2].split('');
          floors.length = nFloors2;
          continue;
        }
        deco += got2;
      }

      var chk = bfsDist(grid, start[0], start[1]);
      if (chk[goal[0] + ',' + goal[1]] !== want) continue;   // verifyShortest 失败 → 换 seed

      var chars = grid.map(function (row) { return row.join(''); });
      chars[start[1]] = replaceAt(chars[start[1]], start[0], 'S');
      chars[goal[1]] = replaceAt(chars[goal[1]], goal[0], 'G');
      return {
        size: size, grid: chars, start: start, goal: goal,
        opt: want, deco: deco, roomCells: roomCells, rooms: roomsMade,
        path: path.map(function (p) { return { x: p[0], y: p[1] }; })
      };
    }
    return null;
  }

  function replaceAt(str, i, ch) { return str.slice(0, i) + ch + str.slice(i + 1); }

  function verifyShortest(map) {
    if (!map) return { ok: false, opt: -1 };
    var grid = map.grid.map(function (r) { return r.split(''); });
    var d = bfsDist(grid, map.start[0], map.start[1]);
    var opt = d[map.goal[0] + ',' + map.goal[1]];
    return { ok: opt === map.opt, opt: opt === undefined ? -1 : opt };
  }

  var API = { genBigMap: genBigMap, verifyShortest: verifyShortest, mulberry32: mulberry32, bfsDist: bfsDist };
  root.BigmapCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
