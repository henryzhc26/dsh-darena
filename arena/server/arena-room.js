/* arena-room.js — D宠大乐斗 v2 · Bo3 房间服务端（零第三方依赖）
 *
 * 一场 = 三局两胜；每局 = 三段远征（7×7 / 9×9 / 9×9，每段随机家族），段内独立计分。
 *   S_game = 1300 × (0.92 × Σ w_r·q_r + 0.08 × mean(C_r))     w = (0.26, 0.33, 0.41)
 *   胜负：先比 S_game；|ΔS| ≤ 13 才比完成段数、再比总耗时。一局胜者得 1 分，先到 2 分者赢一场。
 *
 * 端点（由 pet-llm.js 的 handle() 尽早转交）：
 *   POST /api/arena/room/create  {nick,avatarKey,modelId,modelLabel,effort,uid}
 *   POST /api/arena/room/join    {code,nick,avatarKey,modelId,modelLabel,effort,uid}
 *   GET  /api/arena/room/state?code=XXXXXX
 *   GET  /api/arena/room/brief?code=XXXXXX&game=0&round=0
 *   POST /api/arena/room/submit  {code,side,token,game,round,raw,ms,usage}
 *   POST /api/arena/room/pick    {code,side,token,game,modelId,modelLabel,effort}   每局开始前重选
 *   POST /api/arena/room/leave   {code,side}
 *
 * 房间只在内存：30 分钟 TTL、最多 200 间。座位 token 只在 create/join 响应里出现。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_ROOMS = 200;
const CODE_LEN = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_RAW = 4000;
const SEGMENTS = [{ size: 7 }, { size: 9 }, { size: 9 }];
// 软截止只做快照、不中断；硬截止才 abort。F1 段单独 10s（impl §4）
const ROUND_SOFT_MS = 18000;     // 校准规格 §4：软 18s 开始结算 / 硬 25s 强制终止
const ROUND_TIMEOUT_MS = 25000;
const F1_HARD_MS = 10000;        // F1 疾风径：deadline 10s（只调 deadline 就能调速度权重）
function roundTimeouts(family) {
  const fam = String(family || '');
  if (fam === 'F1' || fam === 'F1a') return { softMs: 6000, hardMs: F1_HARD_MS };
  return { softMs: ROUND_SOFT_MS, hardMs: ROUND_TIMEOUT_MS };
}

const BOARD_DIR = process.env.ARENA_BOARD_DIR
  ? path.resolve(process.env.ARENA_BOARD_DIR)
  : path.join(os.homedir(), '.dsh', 'bot', 'pet-hub');
const BOARD_FILE = path.join(BOARD_DIR, 'arena-board.json');

/* ---------------------------------------------------------- 排行榜（真实玩家） */
// 口径：只统计「双人房间里双方都是真人的 Bo3」；单机/系统匹配/脚本实验一律不写榜。
// 榜按账号宠物 uid 聚合，字段：uid/nick/avatarKey/models/w/l/d/streak/lastAt/matches。
const LEGACY_BOARD_FILE = path.join(BOARD_DIR, 'arena-board.legacy.json');
const MATCH_LOG_FILE = path.join(BOARD_DIR, 'arena-matches.jsonl');
const BOARD_ENDPOINT = (process.env.ARENA_BOARD_ENDPOINT || '').trim();
const BOARD_VERSION = 2;
const REAL_UID_RE = /^[A-Za-z0-9:_-]{4,60}$/;
const FAKE_UID_RE = /^(bot|script|ai|system|test|exp|guest)/i;

/** family_seed = HMAC(match_id, "family|game")；map_seed = HMAC(family_seed, "map|round|k") */
function hmacHex(key, msg) {
  return crypto.createHmac('sha256', String(key)).update(String(msg)).digest('hex');
}

/** 三局家族：P0 只有 S={F1}、P={F2,F3,F5}；约束「至少 1 局 S∪T、至少 1 局 P、家族不重复」 */
function planFamilies(matchId) {
  const p = ['F2', 'F3', 'F5'];
  const h = hmacHex(matchId, 'families');
  const i0 = parseInt(h.slice(0, 8), 16) % p.length;
  let i1 = parseInt(h.slice(8, 16), 16) % (p.length - 1);
  if (i1 >= i0) i1++;
  const fams = ['F1', p[i0], p[i1]];
  const meta = (core && core.P0_META) || {};
  return fams.sort((a, b) => ((meta[a] || {}).difficulty || 0) - ((meta[b] || {}).difficulty || 0) || a.localeCompare(b));
}

/** 核心：demo 里是 ./arena2/core2.js；插件目录里是 ./core2.cjs（ESM 包里用沙箱装 public/core2.js） */
function loadCore() {
  for (const rel of ['./arena2/core2.js', './core2.cjs', './core2.js', '../public/core2.js']) {
    try {
      const m = require(rel);
      if (m && typeof m.genFamily === 'function' && typeof m.scoreRound === 'function') return m;
    } catch { /* 换下一个候选 */ }
  }
  return null;
}
const core = loadCore();

/* ------------------------------------------------------------------ 工具 */

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const AVATAR_RE = /^[a-z0-9_-]{1,40}$/i;
const EFFORTS = new Set(['off', 'minimal', 'low', 'mid', 'medium', 'high', 'max']);
const SIDES = new Set(['A', 'B']);

function sanitizeIdentity(body) {
  const modelId = str(body.modelId, 80);
  return {
    nick: str(body.nick, 20) || '玩家',
    avatarKey: AVATAR_RE.test(str(body.avatarKey, 40)) ? str(body.avatarKey, 40) : 'chudan',
    modelId: modelId,
    modelLabel: str(body.modelLabel, 60) || modelId || '未命名模型',
    effort: EFFORTS.has(body.effort) ? body.effort : null,
    uid: str(body.uid, 60),
  };
}

function sanitizeUsage(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const k of Object.keys(v).slice(0, 20)) {
    const n = Number(v[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

function newCode(rooms) {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let k = 0; k < CODE_LEN; k++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/* ------------------------------------------------------- 一局的规格与计分 */

function buildGame(matchId, idx, family, diff) {
  const rounds = [];
  const familySeed = hmacHex(matchId, 'family|' + idx + '|d' + (diff || 0));
  const ladder = !!(diff && core.TARGET_BY_DIFF && core.TARGET_BY_DIFF[diff]);
  for (let r = 0; r < SEGMENTS.length; r++) {
    const size = ladder ? core.TARGET_BY_DIFF[diff].size : SEGMENTS[r].size;
    let spec = null, mapSeed = 0;
    for (let k = 0; k < (ladder ? 6 : 4) && !spec; k++) {
      mapSeed = parseInt(hmacHex(familySeed, 'map|' + r + '|' + k).slice(0, 8), 16);
      const cand = core.genFamily(mapSeed, family, size, ladder ? diff : 0);
      if (cand && cand.family === family) spec = cand;
    }
    if (!spec) spec = core.genFamily(mapSeed, family, size, ladder ? diff : 0);
    rounds.push({
      idx: r,
      family: family,
      familyName: (core.P0_META[family] || {}).name || spec.familyName || family,
      size: spec.size,
      difficulty: spec.difficulty,
      seed: mapSeed,
      spec: spec,
    });
  }
  return {
    idx: idx, family: family,
    familyLabel: (core.P0_META[family] || {}).name || family,
    tags: (core.P0_META[family] || {}).tags || [],
    rounds: rounds,
    diff: diff || 0,
    ladder: ladder,
    difficulty: Math.max.apply(null, rounds.map(function (r) { return r.difficulty; })),
  };
}

function publicRound(spec) {
  return {
    family: spec.family || 'F1',
    familyName: spec.familyName || '疾风径',
    difficulty: spec.difficulty || 1,
    size: spec.size,
    grid: spec.grid,
    start: spec.start,
    exit: spec.exit,
    keys: spec.keys,
    doors: spec.doors,
    doorIndex: spec.doorIndex || {},
    keyIndex: spec.keyIndex || {},
    budget: spec.budget,
    keyCount: spec.keys.length,
    doorCount: spec.doors.length,
    // F5 算数门：代价格必须公开，否则玩家没法算（值只在地图内格子）
    mode: spec.mode || '',
    values: spec.values || null,
    gateSum: spec.gateSum || 0,
    gateLo: spec.gateLo == null ? null : spec.gateLo,
    gateHi: spec.gateHi == null ? null : spec.gateHi,
    maxSteps: spec.maxSteps || 0,
    trap: spec.trap || null,
    diff: spec.diff || 0,                 // 难度阶梯档位 d1–d11（0 = 未走阶梯）
    ladder: spec.ladder || null,
  };
}

function promptFor(game, round) {
  const spec = round.spec;
  const lines = [];
  const isF5 = spec.mode === 'sum' || spec.gateLo != null;
  lines.push('你在玩「D宠大乐斗」解谜。地图 ' + spec.size + '×' + spec.size + '，字符含义：# 墙 . 地 S 你的起点 G 终点 K 钥匙 D 门' + (isF5 ? ' X 陷阱（踩到扣分）' : '') + '。');
  lines.push('规则：走到 K 自动拾取钥匙（同一把只算一次）；D 必须按从起点出发的先后顺序打开，开一扇消耗一把钥匙；没有钥匙或顺序不对时撞门算无效；撞墙也算无效。');
  lines.push('步数预算 ' + spec.budget + ' 步：超过不会中断，但每多走 1 步都会扣分，所以尽量贴着最短路走。');
  if (spec.keyCount > 0) {
    lines.push('本图有 ' + spec.keyCount + ' 把钥匙、' + spec.doorCount + ' 扇门；钥匙都放在门的外侧，门只能按从起点出发的先后顺序开，顺序不可交换。多出来的钥匙不捡也不影响通关。');
  } else {
    lines.push('本图没有钥匙和门。');
  }
  if (isF5) {
    const lo = spec.gateLo, hi = spec.gateHi;
    lines.push('本关是「算数门」：沿途累计分值必须落在窗口 [' + lo + ', ' + hi + ']（含端点）并且走到 G 才算通关；起点格不计分。');
    lines.push('陷阱 X 踩到会扣 ' + Math.abs((spec.trap && spec.trap.cost) || 8) + ' 分，掉出窗口就不算通关。');
    lines.push('本关最多 ' + spec.maxSteps + ' 步内走到 G，超过 ' + spec.maxSteps + ' 步即使分够也不算通关；最优 ' + spec.optSteps + ' 步。');
    lines.push('代价格表（行=北→南，列=西→东，负数=陷阱）：');
    for (const row of spec.values || []) {
      lines.push('  ' + row.map(function (v) { return String(v).padStart(3, ' '); }).join(''));
    }
  } else if (spec.family === 'F3') {
    lines.push('本关预算只比最短路多 1 步，绕远就掉分；起点附近有一条看着更短的岔路，走进去会撞墙。');
  }
  lines.push('');
  lines.push('地图（第 1 行是最北，第 1 列是最西）：');
  for (const row of spec.grid) lines.push(row.join(''));
  lines.push('');
  lines.push('方向：N=上 S=下 E=右 W=左（也认 上/下/左/右）。');
  lines.push('只输出两行，不要任何解释：');
  lines.push('PLAN: E E S S W W       （方向字母，空格分隔）');
  lines.push('CLAIM: done=1, steps=<实际步数>' + (isF5 ? ', cost=<沿途累计分>' : '') + '   （done=1 表示走到终点并满足通关条件，done=0 表示没有）');
  return lines.join('\n');
}

function scorePlay(spec, play) {
  if (!play) return { sc: core.scoreRound(spec, ''), snapUsed: false, invalidSample: true };
  const raw = play.raw || '';
  const snap = play.rawSnap || '';
  // 硬截止：用已完成前缀重算，S x0.6（软快照只在未超时时择优）
  if (play.timeout) {
    // 校准规格 §4：超时不记 0、不加时间乘子，按「最后一个完整可解析的 PLAN: 前缀」正常计分
    const text = snap || raw;
    if (!text.trim()) {
      const z = core.scoreRound(spec, '');
      z.invalid_sample = true; z.hard_cut = true; z.S = 0;
      return { sc: z, snapUsed: !!snap, invalidSample: true };
    }
    const sc = core.scoreRoundPartial(spec, text);
    sc.hard_cut = true; sc.invalid_sample = false;
    return { sc: sc, snapUsed: true, invalidSample: false };
  }
  const sc = core.scoreRound(spec, raw);
  sc.invalid_sample = false;
  let snapUsed = false;
  if (snap) {
    const ss = core.scoreRound(spec, snap);
    if (ss.S > sc.S) { ss.invalid_sample = false; return { sc: ss, snapUsed: true, invalidSample: false }; }
  }
  return { sc: sc, snapUsed: snapUsed, invalidSample: false };
}

function scoreSide(game, side) {
  const out = [];
  for (let r = 0; r < game.rounds.length; r++) {
    const play = side.play[r];
    const spec = game.rounds[r].spec;
    if (!play) { out.push({ S: 0, q: 0, P: 0, V: 0, R: 0, C: 0, missing: true }); continue; }
    const got = scorePlay(spec, play);
    const sc = got.sc;
    sc.ms = play.ms || 0;
    sc.timeout = !!play.timeout;
    sc.snap_used = got.snapUsed;
    sc.invalid_sample = !!got.invalidSample;
    out.push(sc);
  }
  const ms = core.matchScore(out);
  const doneRounds = out.filter((x) => x.reached).length;
  const totalMs = out.reduce((s, x) => s + (x.ms || 0), 0);
  return { rounds: out, S: ms.S, Q: ms.Q, C: ms.C, doneRounds: doneRounds, totalMs: totalMs };
}

/* ------------------------------------------------------------------ 房间 */

const rooms = new Map();

function cleanup() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > ROOM_TTL_MS) rooms.delete(code);
  }
  if (rooms.size > MAX_ROOMS) {
    const sorted = [...rooms.entries()].sort((a, b) => a[1].touched - b[1].touched);
    for (const [code] of sorted.slice(0, rooms.size - MAX_ROOMS)) rooms.delete(code);
  }
}

function newRoom(matchId, mode) {
  const families = planFamilies(matchId);
  // mode='legacy'：旧页面（一局定胜负，3 段）；mode='bo3'：三局两胜，每局一个家族
  const isLegacy = mode === 'legacy';
  return {
    code: null,
    touched: Date.now(),
    matchId: matchId,
    mode: isLegacy ? 'legacy' : 'bo3',
    startAt: Date.now() + 3200,
    families: isLegacy ? [families[0]] : families,
    paired: false,          // 只有 /join 真正进来才算双人房（单机测试的 B 侧不算）
    recorded: false,
    baseDiff: 0,            // 由 /create 按玩家水平写入（base），默认 d3
    diffs: [],
    games: [],
    sides: { A: null, B: null },
    picks: { A: [], B: [] },
    wins: { A: 0, B: 0 },
    results: [],          // [{idx, scoreA, scoreB, winner, detail}]
    status: 'waiting',    // waiting | playing | done
    winner: null,
  };
}

/** 第 gi 局的档位：第 1 局 base，之后按比分 + 三条硬帽（失败时退回上一局档位） */
function diffForRound(room, gi) {
  if (!core.pickDiff) return 0;
  const base = room.baseDiff || 3;
  const used = {};
  for (let i = 0; i < room.diffs.length; i++) used[room.diffs[i]] = 1;
  const prev = gi > 0 ? (room.diffs[gi - 1] || 0) : 0;
  return core.pickDiff({
    base: base, roundIdx: gi, wins: room.wins || { A: 0, B: 0 },
    prevDiff: prev, used: used,
  });
}

/** 确保第 gi 局存在（地图在开局前生成，档位依赖当时比分） */
function ensureGame(room, gi) {
  if (room.games[gi]) return room.games[gi];
  const fam = room.families[gi];
  if (!fam) return null;
  const isLegacy = room.mode === 'legacy';
  const diff = isLegacy ? 0 : diffForRound(room, gi);
  const game = buildGame(room.matchId, gi, fam, diff);
  room.games[gi] = game;
  room.diffs[gi] = diff;
  return game;
}

function sideView(room, which) {
  const s = room.sides[which];
  if (!s) return null;
  return { nick: s.ident.nick, avatarKey: s.ident.avatarKey, modelLabel: s.ident.modelLabel, effort: s.ident.effort, ready: true };
}

/** 某一局开始时双方重选后的模型（每局可重选，所以必须按局存，不能只看 ident） */
function gameModels(room, gi) {
  const pick = function (w) {
    const p = (room.picks && room.picks[w] && room.picks[w][gi]) || null;
    const s = room.sides[w];
    return {
      modelId: (p && p.modelId) || (s && s.ident.modelId) || '',
      modelLabel: (p && p.modelLabel) || (s && s.ident.modelLabel) || '',
      effort: (p && p.effort) || (s && s.ident.effort) || '',
    };
  };
  return { A: pick('A'), B: pick('B') };
}

/** 整场用过的模型集合（去重，按局顺序） */
function modelsUsedBy(room, w) {
  const seen = {};
  const list = [];
  room.games.forEach(function (_, gi) {
    const m = gameModels(room, gi)[w];
    if (!m.modelId || seen[m.modelId]) return;
    seen[m.modelId] = true;
    list.push({ modelId: m.modelId, modelLabel: m.modelLabel });
  });
  return list;
}

function gameView(room, gi) {
  const g = room.games[gi];
  const res = room.results.find((r) => r.idx === gi) || null;
  return {
    idx: gi,
    familyLabel: g.familyLabel,
    difficulty: g.difficulty,
    diff: g.diff || 0,
    rounds: g.rounds.map((r) => ({ idx: r.idx, familyName: r.familyName, size: r.size, difficulty: r.difficulty })),
    models: gameModels(room, gi),
    result: res ? { S: { A: res.scoreA.S, B: res.scoreB.S }, winner: res.winner, models: gameModels(room, gi) } : null,
  };
}

/** 当前这一局的实时状态：两侧每段交没交、各自多少分（不含动作串） */
function liveView(room) {
  if (room.status !== 'playing') return null;
  const gi = room.curGame || 0;
  const game = room.games[gi];
  if (!game) return null;
  const pick = function (w) {
    const s = room.sides[w];
    if (!s) return [];
    return game.rounds.map(function (_, i) {
      const p = s.play[i];
      return p ? { in: true, S: typeof p.S === 'number' ? p.S : null } : { in: false, S: null };
    });
  };
  return { game: gi, rounds: game.rounds.length, A: pick('A'), B: pick('B') };
}

/** 三局安排（家族在开局前就定好，档位随比分走）：预告卡要能一次看到三局各是什么家族 */
function planView(room) {
  return (room.families || []).map(function (fam, i) {
    const g = room.games[i];
    return {
      idx: i,
      family: fam,
      familyLabel: (core.P0_META[fam] || {}).name || fam,
      ready: !!g,
      size: g && g.rounds[0] ? g.rounds[0].size : 0,
      diff: g ? (g.diff || 0) : 0,
    };
  });
}

function stateView(room, which) {
  if (!room.games.length) ensureGame(room, 0);
  const me = room.sides[which];
  const opp = room.sides[which === 'A' ? 'B' : 'A'];
  return {
    ok: true,
    code: room.code,
    status: room.status,
    side: which,
    wins: room.wins,
    winner: room.winner,
    me: me ? sideView(room, which) : null,
    opponent: opp ? sideView(room, which === 'A' ? 'B' : 'A') : null,
    games: room.games.map((g, i) => gameView(room, i)),
    current: room.status === 'playing' ? { game: room.curGame, round: room.curRound || 0 } : null,
    // v2 前端要对局中看到「对方这一格交没交 / 这段各自多少分」，只暴露分数不暴露动作串
    practice: !!room.practice,
    live: liveView(room),
    results: room.results.map((r) => ({ idx: r.idx, winner: r.winner, S: { A: r.scoreA.S, B: r.scoreB.S } })),
    plan: planView(room),
    // ---- 旧页面（arena2/index.html v1）兼容字段：旧版只认一局 + 同图同时开跑 ----
    mode: room.mode,
    startAt: room.startAt,
    host: sideView(room, 'A'),
    guest: room.paired ? sideView(room, 'B') : null,
    map: room.games[0] && room.games[0].rounds[0] ? room.games[0].rounds[0].spec.grid : null,
    seed: room.games[0] && room.games[0].rounds[0] ? room.games[0].rounds[0].seed : null,
    size: room.games[0] && room.games[0].rounds[0] ? room.games[0].rounds[0].size : null,
  };
}

function newSide(ident) {
  // play = 本局三段的动作缓存；plays[gi] = 已结算那局的快照（写榜记录要用，不能被清空）
  return { ident: ident, token: crypto.randomBytes(12).toString('hex'), play: [], plays: [], ready: true };
}

/* ------------------------------------------------------- 写榜（只认真人双人房） */

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** 旧榜是按模型聚合的 dict，第一次升 v2 时另存 arena-board.legacy.json，不删原始数据 */
function migrateBoard(raw) {
  if (raw && raw.version === BOARD_VERSION && raw.players) return raw;
  if (raw && Object.keys(raw).length) {
    try {
      if (!fs.existsSync(LEGACY_BOARD_FILE)) fs.writeFileSync(LEGACY_BOARD_FILE, JSON.stringify(raw, null, 2));
    } catch (e) { console.error('[board] legacy backup failed:', e.message); }
  }
  return { version: BOARD_VERSION, players: {}, updatedAt: null };
}

function isRealSide(side) {
  if (!side || !side.ident) return false;
  const uid = side.ident.uid || '';
  if (!REAL_UID_RE.test(uid)) return false;
  if (FAKE_UID_RE.test(uid)) return false;
  return true;
}

/** 只有 join 过的双人房、两侧 uid 都真实且不同 → 进榜 */
function rankedMatch(room) {
  if (!room.paired) return false;
  const a = room.sides.A, b = room.sides.B;
  if (!isRealSide(a) || !isRealSide(b)) return false;
  if (a.ident.uid === b.ident.uid) return false;
  if (a.ident.nick === '对手·系统匹配' || b.ident.nick === '对手·系统匹配') return false;
  return true;
}

function buildRecord(room) {
  const sideRec = function (w) {
    const s = room.sides[w];
    return {
      uid: s.ident.uid, nick: s.ident.nick, avatarKey: s.ident.avatarKey,
      model: s.ident.modelId, effort: s.ident.effort,
      // 每局开始时重选过模型：逐局记一份，另给一份整场去重集合
      gameModels: room.games.map(function (g, gi) {
        const m = gameModels(room, gi)[w];
        return { game: gi, modelId: m.modelId, modelLabel: m.modelLabel, effort: m.effort };
      }),
      modelsUsed: modelsUsedBy(room, w),
      // 按已结算的局顺序摊平三段动作（重放校验就靠它，不存客户端自报的分数）
      actions: room.results.reduce(function (list, r) {
        const seg = s.plays[r.idx] || [];
        for (let i = 0; i < SEGMENTS.length; i++) {
          const p = seg[i];
          list.push({
            raw: p ? p.raw : '', rawSnap: p ? (p.rawSnap || '') : '',
            timeout: p ? !!p.timeout : false, snap_used: p ? !!p.snapUsed : false,
            invalid_sample: p ? !!p.invalidSample : false, hard_cut: p ? !!p.hardCut : false,
            ms: p ? p.ms : 0,
          });
        }
        return list;
      }, []),
    };
  };
  return {
    matchId: room.matchId,
    code: room.code,
    version: BOARD_VERSION,
    families: room.games.map(function (g) { return g.family; }),
    roundSeeds: room.games.map(function (g) { return g.rounds.map(function (r) { return r.seed; }); }),
    sides: { A: sideRec('A'), B: sideRec('B') },
    games: room.results.map(function (r) {
      return { idx: r.idx, winner: r.winner, S: { A: r.scoreA.S, B: r.scoreB.S }, models: gameModels(room, r.idx) };
    }),
    winner: room.winner,
    createdAt: new Date().toISOString(),
  };
}

function appendMatch(rec) {
  fs.mkdirSync(BOARD_DIR, { recursive: true });
  fs.appendFileSync(MATCH_LOG_FILE, JSON.stringify(rec) + '\n');
}

function postBoard(rec) {
  if (!BOARD_ENDPOINT || typeof fetch !== 'function') return;
  const ac = new AbortController();
  const t = setTimeout(function () { ac.abort(); }, 5000);
  fetch(BOARD_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rec),
    signal: ac.signal,
  }).then(function () { clearTimeout(t); }).catch(function (e) {
    clearTimeout(t);
    console.error('[board] upload failed:', e.message);
  });
}

function updateBoard(room) {
  const raw = migrateBoard(readJsonFile(BOARD_FILE));
  const players = raw.players || (raw.players = {});
  const now = new Date().toISOString();
  const upd = function (w) {
    const s = room.sides[w];
    const uid = s.ident.uid;
    const row = players[uid] || (players[uid] = {
      uid: uid, nick: s.ident.nick, avatarKey: s.ident.avatarKey,
      models: [], modelsUsed: {}, w: 0, l: 0, d: 0, streak: 0, matches: 0, lastAt: null,
    });
    row.nick = s.ident.nick || row.nick;
    row.avatarKey = s.ident.avatarKey || row.avatarKey;
    if (!row.modelsUsed) row.modelsUsed = {};
    // 每局可能换模型：按「这一局用的是哪个模型」记它的 w/l/d，排行榜 hover 展开就靠这个
    room.results.forEach(function (r) {
      const used = gameModels(room, r.idx)[w];
      if (!used.modelId) return;
      const cell = row.modelsUsed[used.modelId] || (row.modelsUsed[used.modelId] = {
        label: used.modelLabel || used.modelId, w: 0, l: 0, d: 0, n: 0,
      });
      if (used.modelLabel) cell.label = used.modelLabel;
      cell.n = (cell.n || 0) + 1;
      if (r.winner === w) cell.w++;
      else if (r.winner === 'D') cell.d++;
      else cell.l++;
      if (row.models.indexOf(used.modelId) < 0) row.models.push(used.modelId);
    });
    const m = s.ident.modelId;
    if (m && row.models.indexOf(m) < 0) row.models.push(m);
    if (room.winner === w) { row.w++; row.streak = (row.streak || 0) + 1; }
    else if (room.winner === 'D') { row.d++; row.streak = 0; }
    else { row.l++; row.streak = 0; }
    row.matches = (row.matches || 0) + 1;
    row.lastAt = now;
    row.net = row.w - row.l;
  };
  upd('A'); upd('B');
  raw.version = BOARD_VERSION;
  raw.updatedAt = now;
  const tmp = BOARD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2));
  fs.renameSync(tmp, BOARD_FILE);
}

/** 整场结束调用一次：只有真人对真人才写榜；记录同时落 jsonl 供重放校验 */
function recordMatch(room) {
  if (room.recorded) return;
  room.recorded = true;
  if (!rankedMatch(room)) { room.ranked = false; return; }
  room.ranked = true;
  try { updateBoard(room); } catch (e) { console.error('[board] write failed:', e.message); }
  try {
    const rec = buildRecord(room);
    appendMatch(rec);
    postBoard(rec);
  } catch (e) { console.error('[board] record failed:', e.message); }
}

/* --------------------------------------------------------------- 主入口 */

async function handle(ctx) {
  const { req, res, url } = ctx;
  if (!core) { json(res, 500, { ok: false, error: 'core-missing' }); return true; }
  const p = url.pathname;
  if (!p.startsWith('/api/arena/room/')) return false;
  cleanup();

  let body = {};
  if (req.method === 'POST') {
    const raw = await readBody(req, 64 * 1024);
    try { body = raw ? JSON.parse(raw) : {}; } catch { json(res, 400, { ok: false, error: 'bad-json' }); return true; }
  }

  if (p.endsWith('/create') && req.method === 'POST') {
    const code = newCode(rooms);
    if (!code) { json(res, 503, { ok: false, error: 'rooms-full' }); return true; }
    const room = newRoom(crypto.randomBytes(8).toString('hex'), body.bo3 ? 'bo3' : 'legacy');
    room.code = code;
    room.sides.A = newSide(sanitizeIdentity(body));
    room.sides.B = newSide(sanitizeIdentity(body)); // 单人测试也能跑：另一侧是「系统匹配」
    room.sides.B.ident.nick = room.sides.B.ident.nick === '玩家' ? '对手·系统匹配' : room.sides.B.ident.nick;
    // practice=true：同一个浏览器自己打两边（练习房），把 B 的 token 也发给它；练习房永不进榜
    room.practice = !!body.practice;
    room.status = 'playing';
    room.curGame = 0;
    room.curRound = 0;
    // 难度阶梯：base = 玩家最近 20 局完成率 45–65% 的那一档（前端可传，缺省 d3）
    const baseRaw = Number(body.base);
    room.baseDiff = Number.isFinite(baseRaw) ? Math.max(1, Math.min(core.DIFF_MAX || 11, Math.round(baseRaw))) : 3;
    ensureGame(room, 0);
    rooms.set(code, room);
    json(res, 200, {
      ok: true, code: code, side: 'A', token: room.sides.A.token, mode: room.mode,
      tokenB: room.practice ? room.sides.B.token : null,
      practice: room.practice,
      map: room.games[0].rounds[0].spec.grid, seed: room.games[0].rounds[0].seed,
      size: room.games[0].rounds[0].size, startAt: room.startAt,
      state: stateView(room, 'A'),
    });
    return true;
  }

  if (p.endsWith('/join') && req.method === 'POST') {
    const code = str(body.code, 12).toUpperCase();
    const room = rooms.get(code);
    if (!room) { json(res, 404, { ok: false, error: 'no-room' }); return true; }
    if (!room.sides.B) room.sides.B = newSide(sanitizeIdentity(body));
    else room.sides.B.ident = sanitizeIdentity(body);
    room.paired = true;
    room.touched = Date.now();
    json(res, 200, {
      ok: true, code: code, side: 'B', token: room.sides.B.token, mode: room.mode,
      map: room.games[0].rounds[0].spec.grid, seed: room.games[0].rounds[0].seed,
      size: room.games[0].rounds[0].size, startAt: room.startAt,
      host: sideView(room, 'A'), state: stateView(room, 'B'),
    });
    return true;
  }

  if (p.endsWith('/state') && req.method === 'GET') {
    const code = str(url.searchParams.get('code'), 12).toUpperCase();
    const room = rooms.get(code);
    if (!room) { json(res, 404, { ok: false, error: 'no-room' }); return true; }
    const side = SIDES.has(url.searchParams.get('side')) ? url.searchParams.get('side') : 'A';
    room.touched = Date.now();
    json(res, 200, stateView(room, side));
    return true;
  }

  if (p.endsWith('/brief') && req.method === 'GET') {
    const code = str(url.searchParams.get('code'), 12).toUpperCase();
    const room = rooms.get(code);
    if (!room) { json(res, 404, { ok: false, error: 'no-room' }); return true; }
    const gi = Number(url.searchParams.get('game') || 0) | 0;
    const ri = Number(url.searchParams.get('round') || 0) | 0;
    const game = room.games[gi];
    if (!game) { json(res, 404, { ok: false, error: 'no-game' }); return true; }
    const round = game.rounds[ri];
    if (!round) { json(res, 404, { ok: false, error: 'no-round' }); return true; }
    room.touched = Date.now();
    json(res, 200, {
      ok: true, game: gi, round: ri, family: round.familyName, difficulty: round.difficulty,
      prompt: promptFor(game, round), spec: publicRound(round.spec),
      timeoutMs: roundTimeouts(round.family).hardMs,
      softMs: roundTimeouts(round.family).softMs,
      hardMs: roundTimeouts(round.family).hardMs,
    });
    return true;
  }

  if (p.endsWith('/submit') && req.method === 'POST') {
    const code = str(body.code, 12).toUpperCase();
    const room = rooms.get(code);
    if (!room) { json(res, 404, { ok: false, error: 'no-room' }); return true; }
    const which = SIDES.has(body.side) ? body.side : null;
    if (!which) { json(res, 400, { ok: false, error: 'bad-side' }); return true; }
    const side = room.sides[which];
    if (!side || side.token !== str(body.token, 64)) { json(res, 403, { ok: false, error: 'bad-token' }); return true; }
    const gi = Number(body.game) | 0, ri = Number(body.round) | 0;
    const game = room.games[gi];
    if (!game || !game.rounds[ri]) { json(res, 404, { ok: false, error: 'no-round' }); return true; }
    side.play[ri] = {
      raw: str(body.raw, MAX_RAW),
      rawSnap: body.rawSnap == null ? '' : str(body.rawSnap, MAX_RAW),
      timeout: !!body.timeout,
      ms: Math.max(0, Math.min(120000, Number(body.ms) || 0)),
      usage: sanitizeUsage(body.usage),
      at: Date.now(),
    };
    room.touched = Date.now();
    const got = scorePlay(game.rounds[ri].spec, side.play[ri]);
    const mine = got.sc;
    side.play[ri].S = mine.S;   // 只把分数留在这段上，给对方的 state 看
    side.play[ri].snapUsed = got.snapUsed;
    side.play[ri].invalidSample = !!got.invalidSample;
    side.play[ri].hardCut = !!mine.hard_cut;
    const other = room.sides[which === 'A' ? 'B' : 'A'];
    const bothIn = other && other.play[ri];

    // 一局三段都交齐后结算这一局
    let gameResult = null;
    const allIn = (s) => s && game.rounds.every((_, i) => s.play[i]);
    if (allIn(room.sides.A) && allIn(room.sides.B) && !room.results.find((r) => r.idx === gi)) {
      const sa = scoreSide(game, room.sides.A), sb = scoreSide(game, room.sides.B);
      const win = core.decide(sa, sb);
      const winner = win === 'D' ? 'D' : win;
      room.results.push({ idx: gi, winner: winner, scoreA: sa, scoreB: sb });
      if (winner === 'A') room.wins.A++; else if (winner === 'B') room.wins.B++;
      gameResult = { winner: winner, S: { A: sa.S, B: sb.S } };
      // 本局已结算：先快照本局三段动作（写榜记录要用），再清空缓存
      // 不清空的话下一局第一段一交就 allIn，会拿上一局的旧动作结算
      room.sides.A.plays[gi] = room.sides.A.play.slice();
      room.sides.B.plays[gi] = room.sides.B.play.slice();
      room.sides.A.play = [];
      room.sides.B.play = [];
      // 推进到下一局 / 结束
      if (room.mode === 'legacy' || room.wins.A >= 2 || room.wins.B >= 2 || room.results.length >= 3) {
        room.status = 'done';
        room.winner = room.wins.A > room.wins.B ? 'A' : room.wins.B > room.wins.A ? 'B' : 'D';
        recordMatch(room);
      } else {
        room.curGame = room.results.length;
        room.curRound = 0;
        ensureGame(room, room.curGame);   // 按方才是比分算出下一局档位并生成地图
      }
    }
    json(res, 200, {
      ok: true,
      mine: { S: mine.S, q: mine.q, P: mine.P, V: mine.V, R: mine.R, C: mine.C, reached: mine.reached, used: mine.used, invalid: mine.invalid, budget: mine.budget, opt: mine.opt, snap_used: got.snapUsed, invalid_sample: !!got.invalidSample, hard_cut: !!mine.hard_cut },
      opponentIn: !!bothIn,
      gameResult: gameResult,
      state: stateView(room, which),
    });
    return true;
  }

  if (p.endsWith('/pick') && req.method === 'POST') {
    const code = str(body.code, 12).toUpperCase();
    const room = rooms.get(code);
    if (!room) { json(res, 404, { ok: false, error: 'no-room' }); return true; }
    const which = SIDES.has(body.side) ? body.side : null;
    const side = which && room.sides[which];
    if (!side || side.token !== str(body.token, 64)) { json(res, 403, { ok: false, error: 'bad-token' }); return true; }
    const ident = sanitizeIdentity(Object.assign({}, side.ident, body));
    side.ident = ident;
    // 每局开始时重选一次模型：按局号记下来，结算/榜单/记录都要用到
    const giRaw = Number(body.game);
    const gi = Number.isFinite(giRaw) && giRaw >= 0 ? Math.floor(giRaw) : (room.curGame || 0);
    if (room.picks && room.picks[which]) {
      room.picks[which][gi] = { modelId: ident.modelId, modelLabel: ident.modelLabel, effort: ident.effort, at: Date.now() };
    }
    room.touched = Date.now();
    json(res, 200, { ok: true, me: sideView(room, which), game: gi, models: gameModels(room, gi) });
    return true;
  }

  if (p.endsWith('/leave') && req.method === 'POST') {
    const code = str(body.code, 12).toUpperCase();
    if (rooms.has(code)) rooms.delete(code);
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 404, { ok: false, error: 'unknown-endpoint' });
  return true;
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    let n = 0, chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { req.destroy(); resolve(''); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

module.exports = {
  handle: handle, _core: core, _planFamilies: planFamilies, _buildGame: buildGame,
  _promptFor: promptFor, _publicRound: publicRound, _scoreSide: scoreSide,
  _rankedMatch: rankedMatch, _buildRecord: buildRecord, BOARD_FILE: BOARD_FILE,
  LEGACY_BOARD_FILE: LEGACY_BOARD_FILE, MATCH_LOG_FILE: MATCH_LOG_FILE,
};
