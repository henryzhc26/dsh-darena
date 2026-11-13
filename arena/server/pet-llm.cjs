#!/usr/bin/env node
/**
 * pet-llm.js — 宠物「用模型说话」的后端（零第三方依赖，Node 18+ 内置 fetch）
 *
 *   GET  /api/pet-models        → 可用模型清单（不带任何 key）
 *   POST /api/pet-say           → 广场里跟宠物说话：{ model?, pet, world, history, text } → { say, action, ... }
 *   POST /api/pet-llm           → 通用调用：{ model?, messages, maxTokens?, json? } → { text }
 *   POST /api/pet-key (PUT)     → 存一把该宠物自己的 key（只落本机文件，不回显）
 *
 * 供应商：
 *   deepseek     api.deepseek.com（模型 deepseek-flash / deepseek-v4-pro）
 *   relayrouter  api.relayrouter.app/v1（Claude 系列，OpenAI 协议）
 *   gemini       api.relayrouter.app/v1beta（Gemini 系列，generateContent 协议）
 *
 * key 只从本机文件读，永远不出现在响应、日志、错误信息里。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const arenaRoom = require('./arena-room.js');
const KEY_DIR = path.join(os.homedir(), '.dsh', 'bot');
const PET_KEY_DIR = path.join(KEY_DIR, 'pet-keys');
const EXTRA_DIR = path.join(KEY_DIR, 'pet-hub');
const EXTRA_FILE = path.join(EXTRA_DIR, 'extra-models.json');
const EXTRA_KEY_DIR = path.join(EXTRA_DIR, 'extra-keys');
const PETS_FILE = path.join(EXTRA_DIR, 'pets.json');
const AVATAR_DIR = path.join(EXTRA_DIR, 'avatars');
const SUBMIT_DIR = path.join(EXTRA_DIR, 'avatar-submissions');
const PUBLIC_AVATAR_DIR = path.join(EXTRA_DIR, 'avatars-public');
const AVATAR_META = path.join(EXTRA_DIR, 'avatars-meta.json');
const OWNER_UIDS = ['henry', 'current', 'u7dyedf'];



/** —— 账号真绑：本机（127.0.0.1）视为 DSH 主账号，签发 HMAC 令牌；局域网来源只是访客 —— */
const IDENTITY_KEY_FILE = path.join(EXTRA_DIR, 'identity.key');
function identitySecret() {
  try { return fs.readFileSync(IDENTITY_KEY_FILE); } catch {
    fs.mkdirSync(EXTRA_DIR, { recursive: true });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(IDENTITY_KEY_FILE, k, { mode: 0o600 });
    return k;
  }
}
function dshAccountId() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
    const m = /deepseek-account-platform\/default:[\s\S]{0,200}?\bid:\s*([0-9a-f-]{16,})/.exec(raw);
    if (m) return m[1];
  } catch { /* 忽略 */ }
  return 'local-only';
}
function boundUid() {
  return 'dsh-' + crypto.createHash('sha256').update(dshAccountId()).digest('hex').slice(0, 12);
}
function signToken(uid, ttlSec) {
  const exp = Math.floor(Date.now() / 1000) + (ttlSec || 12 * 3600);
  const body = uid + '.' + exp;
  const sig = crypto.createHmac('sha256', identitySecret()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [uid, expStr, sig] = parts;
  const body = uid + '.' + expStr;
  const want = crypto.createHmac('sha256', identitySecret()).update(body).digest('base64url');
  if (sig !== want) return null;
  if (Number(expStr) * 1000 < Date.now()) return null;
  return { uid, exp: Number(expStr) };
}
const OWN_IPS = (() => {
  const set = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  try {
    const os = require('os');
    const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach(k => (ifs[k] || []).forEach(i => {
      if (i && i.address) set.add(i.address);
    }));
  } catch (e) {}
  return set;
})();

/* 本机 = 环回，或「从这台机器自己的网卡地址连进来」（Mac 用 192.168.31.x 打开自己也算本机） */
function isLoopback(req) {
  // DSH 宿主的 webServer 转发进来时已过连接层鉴权（arena/index.js 打的标记），
  // 这种请求就是本机授权客户端，不该再靠 remoteAddress 猜。
  if (req && req.dshAuthorized === true) return true;
  let a = String((req.socket && req.socket.remoteAddress) || '');
  if (a.indexOf('::ffff:') === 0) a = a.slice(7);
  return OWN_IPS.has(a) || a === '::1';
}


/** 写接口的归属校验：主账号必须带有效令牌，且只能写自己那只 */
function checkOwner(req, res, uid) {
  const auth = String(req.headers.authorization || '');
  const tok = auth.indexOf('Bearer ') === 0 ? verifyToken(auth.slice(7)) : null;
  if (String(uid || '').indexOf('dsh-') === 0) {
    if (!tok || tok.uid !== uid) {
      sendJson(res, 403, { ok: false, error: '这个账号需要 DSH 身份令牌' });
      return false;
    }
  }
  return true;
}

/** 用户上传形象的元数据：{ id: {nick, uid, at, status, ai} } */
function readAvatarMeta() {
  try { return JSON.parse(fs.readFileSync(AVATAR_META, 'utf8')) || {}; } catch { return {}; }
}
function writeAvatarMeta(m) {
  fs.mkdirSync(EXTRA_DIR, { recursive: true });
  const tmp = AVATAR_META + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, AVATAR_META);
}

/** AI 初审：把图丢给中转站的视觉模型，判断是否适合公开展示。 */
async function aiReviewAvatar(dataUrl) {
  const prompt = [
    '你在审核一张要放进游戏里的宠物自定义形象。',
    '只判断：1) 是否适合公开展示（无暴力、色情、仇恨、政治敏感、真实证件/隐私信息）；2) 是否是清晰完整的角色图（不是空白、不是纯文字截图）。',
    '只回一行 JSON：{"verdict":"pass"|"review"|"reject","reason":"不超过20字的中文理由"}',
  ].join('\n');
  try {
    const r = await callModel({
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] }],
      maxTokens: 500,
      temperature: 0.1,
      timeoutMs: 30000,
    });
    const txt = String(r.text || '');
    const m = /\{[\s\S]*\}/.exec(txt);
    if (m) {
      const j = JSON.parse(m[0]);
      const v = ['pass', 'review', 'reject'].includes(j.verdict) ? j.verdict : 'review';
      return { verdict: v, reason: String(j.reason || '').slice(0, 40), model: r.model };
    }
    return { verdict: 'review', reason: 'AI 未给出明确结论', raw: txt.slice(0, 80) };
  } catch (e) {
    return { verdict: 'review', reason: 'AI 初审不可用：' + String(e.message).slice(0, 40) };
  }
}

/** 服务端宠物档案：给插件用（插件和广场不同源，localStorage 读不到） */
function readPets() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(PETS_FILE, 'utf8')) || {}; } catch { raw = {}; }
  return raw && typeof raw === 'object' ? raw : {};
}

function writePets(map) {
  fs.mkdirSync(EXTRA_DIR, { recursive: true, mode: 0o700 });
  const tmp = PETS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, PETS_FILE);
}

function sanitizePet(p) {
  if (!p || typeof p !== 'object') return null;
  const nick = String(p.nick || '').trim().slice(0, 24);
  const avatarKey = String(p.avatarKey || '').trim().replace(/[^\w-]/g, '').slice(0, 40);
  if (!nick || !avatarKey) return null;
  const models = p.models && typeof p.models === 'object' ? p.models : {};
  const out = {};
  for (const k of ['idle', 'game', 'work']) {
    if (typeof models[k] === 'string' && models[k]) out[k] = String(models[k]).slice(0, 60);
  }
  return { nick, avatarKey, models: out };
}

/* --------------------------------------------------------------- 模型目录 */

const MODELS = {
  'deepseek-flash': {
    label: 'DeepSeek V4.1 Flash', short: 'DS Flash', provider: 'deepseek',
    model: 'deepseek-flash', tier: 'ds', note: '账号自带，不花钱',
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro', short: 'DS Pro', provider: 'deepseek',
    model: 'deepseek-v4-pro', tier: 'ds', note: '账号自带，更强',
  },
  'claude-fable-5-2': {
    label: 'Claude Fable 5.2', short: 'Fable 5.2', provider: 'relayrouter',
    model: 'claude-fable-5-2', tier: 'byok', note: '走中转，按量计费',
  },
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5', short: 'Sonnet 5.5', provider: 'relayrouter',
    model: 'claude-sonnet-5-5', tier: 'byok', note: '走中转，按量计费',
  },
  'claude-haiku-5-5': {
    label: 'Claude Haiku 5.5', short: 'Haiku 5.5', provider: 'relayrouter',
    model: 'claude-haiku-5-5', tier: 'byok', note: '走中转，便宜快',
  },
  'claude-opus-5-5': {
    label: 'Claude Opus 5.5', short: 'Opus 5.5', provider: 'relayrouter',
    model: 'claude-opus-5-5', tier: 'byok', note: '走中转，最贵',
  },
  'gemini-4-argon': {
    label: 'Gemini 4 Argon', short: 'Argon', provider: 'gemini',
    model: 'gemini-4-argon', tier: 'byok', note: '走中转，思考 high',
  },
};

/** 用户手动加的模型（只有 baseURL + model；key 单独存文件，不进 json） */
function loadExtraModels() {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  return arr.filter((e) => e && e.id && e.model && /^https?:\/\//.test(String(e.baseURL || '')));
}

function saveExtraModels(arr) {
  fs.mkdirSync(EXTRA_DIR, { recursive: true, mode: 0o700 });
  const tmp = EXTRA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, EXTRA_FILE);
}

/** 这个模型现在能不能真调用（只看本机有没有对应 key，不发请求） */
function modelReady(id) {
  const spec = MODELS[id];
  if (!spec) return false;
  if (spec.provider === 'deepseek') return !!readKeyFile(path.join(KEY_DIR, 'deepseek-api-key-codex.txt'));
  if (spec.provider === 'gemini') return !!readKeyFile(path.join(KEY_DIR, 'relayrouter-gemini-key.txt'));
  if (spec.provider === 'custom') return !!readKeyFile(path.join(EXTRA_KEY_DIR, id + '.txt'));
  return !!readKeyFile(path.join(KEY_DIR, 'relayrouter-key.txt'));
}

const SLOTS = ['idle', 'game', 'work'];
const SLOT_LABEL = { idle: '平时', game: '小游戏', work: '干活' };

function listModels() {
  const defaults = { idle: 'deepseek-flash', game: 'deepseek-flash', work: 'deepseek-flash' };
  return {
    ok: true,
    slots: SLOTS.map((s) => ({ id: s, label: SLOT_LABEL[s], default: defaults[s] })),
    models: Object.keys(MODELS).map((id) => ({
      id, label: MODELS[id].label, short: MODELS[id].short,
      tier: MODELS[id].tier, note: MODELS[id].note, ready: modelReady(id),
    })).concat(loadExtraModels().map((e) => ({
      id: e.id, label: e.label || e.id, short: e.label || e.id,
      tier: 'byok', note: '你手动加的模型', ready: modelReady(e.id), custom: true,
    }))),
    maxSayChars: 40,
  };
}

/* ------------------------------------------------------------------ key */

const keyCache = new Map(); // file -> { mtimeMs, value }

function readKeyFile(file) {
  const st = (() => { try { return fs.statSync(file); } catch { return null; } })();
  if (!st) return null;
  const hit = keyCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.value;
  let v = null;
  try {
    v = fs.readFileSync(file, 'utf8').trim();
  } catch { v = null; }
  if (!v) v = null;
  keyCache.set(file, { mtimeMs: st.mtimeMs, value: v });
  return v;
}

/** 该宠物自己的 key（可选）优先，否则用全局 key 文件 */
function resolveKey(provider, petId) {
  const safePet = String(petId || '').replace(/[^\w.@-]/g, '_').slice(0, 60);
  if (safePet) {
    const own = readKeyFile(path.join(PET_KEY_DIR, safePet + '.txt'));
    if (own) return { key: own, source: 'pet' };
  }
  if (provider === 'deepseek') {
    const k = readKeyFile(path.join(KEY_DIR, 'deepseek-api-key-codex.txt'));
    return k ? { key: k, source: 'account' } : null;
  }
  if (provider === 'gemini') {
    const k = readKeyFile(path.join(KEY_DIR, 'relayrouter-gemini-key.txt'));
    return k ? { key: k, source: 'relay' } : null;
  }
  if (provider === 'custom') {
    const k = readKeyFile(path.join(EXTRA_KEY_DIR, String(petId || '') + '.txt'));
    return k ? { key: k, source: 'manual' } : null;
  }
  const k = readKeyFile(path.join(KEY_DIR, 'relayrouter-key.txt'));
  return k ? { key: k, source: 'relay' } : null;
}

function savePetKey(petId, key) {
  const safePet = String(petId || '').replace(/[^\w.@-]/g, '_').slice(0, 60);
  if (!safePet) throw new Error('petId required');
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_\-.]{16,200}$/.test(k)) throw new Error('key 格式不对');
  fs.mkdirSync(PET_KEY_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(PET_KEY_DIR, safePet + '.txt');
  fs.writeFileSync(file, k, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  keyCache.delete(file);
  return { ok: true, tail: k.slice(-4), length: k.length };
}

function keyStatus(petId) {
  const safePet = String(petId || '').replace(/[^\w.@-]/g, '_').slice(0, 60);
  const file = path.join(PET_KEY_DIR, safePet + '.txt');
  const own = readKeyFile(file);
  return {
    own: !!own,
    ownTail: own ? own.slice(-4) : null,
    ds: !!readKeyFile(path.join(KEY_DIR, 'deepseek-api-key-codex.txt')),
    relay: !!readKeyFile(path.join(KEY_DIR, 'relayrouter-key.txt')),
    gemini: !!readKeyFile(path.join(KEY_DIR, 'relayrouter-gemini-key.txt')),
  };
}

/* --------------------------------------------------------------- 调用模型 */

async function callOpenAICompatible(base, key, model, messages, opts) {
  const body = {
    model,
    messages,
    max_tokens: Math.max(16, Math.min(4000, Number(opts.maxTokens) || 120)),
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.8,
  };
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 25000);
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 160));
    const d = JSON.parse(txt);
    const msg = d && d.choices && d.choices[0] && d.choices[0].message;
    return {
      text: String((msg && (msg.content || msg.reasoning_content)) || '').trim(),
      usage: d.usage || null,
      model: d.model || model,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(key, model, messages, opts) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content) }],
  }));
  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: Math.max(16, Math.min(4000, Number(opts.maxTokens) || 120)),
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.8,
      thinkingConfig: { thinkingBudget: typeof opts.thinkingBudget === 'number' ? opts.thinkingBudget : 0 },
    },
  };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 25000);
  try {
    const r = await fetch('https://api.relayrouter.app/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 160));
    const d = JSON.parse(txt);
    const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
    return {
      text: parts.map((p) => p.text || '').join('').trim(),
      usage: d.usageMetadata || null,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

function specOf(id) {
  if (MODELS[id]) return MODELS[id];
  const hit = loadExtraModels().find((e) => e.id === id);
  if (!hit) return null;
  return {
    label: hit.label || hit.id, short: hit.label || hit.id, provider: 'custom',
    model: hit.model, baseURL: hit.baseURL, tier: 'byok', note: '你手动加的模型',
  };
}

async function callModel({ modelId, messages, maxTokens, temperature, timeoutMs, petId, reasoningEffort, thinkingBudget }) {
  const mid = specOf(modelId) ? modelId : 'deepseek-flash';
  const spec = specOf(mid);
  const got = spec.provider === 'custom'
    ? (readKeyFile(path.join(EXTRA_KEY_DIR, mid + '.txt')) ? { key: readKeyFile(path.join(EXTRA_KEY_DIR, mid + '.txt')), source: 'manual' } : null)
    : resolveKey(spec.provider, petId);
  if (!got) {
    const e = new Error('NO_KEY');
    e.code = 'NO_KEY';
    e.provider = spec.provider;
    throw e;
  }
  const t0 = Date.now();
  let out;
  if (spec.provider === 'gemini') {
    out = await callGemini(got.key, spec.model, messages, { maxTokens, temperature, timeoutMs, thinkingBudget });
  } else {
    const base = spec.provider === 'deepseek' ? 'https://api.deepseek.com'
      : spec.provider === 'custom' ? spec.baseURL
      : 'https://api.relayrouter.app/v1';
    out = await callOpenAICompatible(base, got.key, spec.model, messages, { maxTokens, temperature, timeoutMs, reasoningEffort });
  }
  return { ...out, modelId: mid, label: spec.label, provider: spec.provider, ms: Date.now() - t0, keySource: got.source };
}

/* --------------------------------------------------------------- 流式调用（v2.1） */
/*
 * callModelStream(opts, onDelta)：OpenAI 兼容 SSE 流式调用（deepseek / relayrouter / 自定义通道），
 * gemini 通道无 SSE，退化为一次性 onDelta。opts 与 callModel 相同（modelId/messages/maxTokens/
 * temperature/timeoutMs/petId/reasoningEffort），额外支持 opts.signal（外部中止）。
 * 返回与 callModel 同形，另带 aborted（外部/超时中止时为 true，text 为已收到的前缀）。
 * 不改动 callModel 的任何现有行为。
 */
async function callModelStream(opts, onDelta) {
  const onPiece = typeof onDelta === 'function' ? onDelta : function () {};
  const mid = specOf(opts.modelId) ? opts.modelId : 'deepseek-flash';
  const spec = specOf(mid);
  const got = spec.provider === 'custom'
    ? (readKeyFile(path.join(EXTRA_KEY_DIR, mid + '.txt')) ? { key: readKeyFile(path.join(EXTRA_KEY_DIR, mid + '.txt')), source: 'manual' } : null)
    : resolveKey(spec.provider, opts.petId);
  if (!got) {
    const e = new Error('NO_KEY');
    e.code = 'NO_KEY';
    e.provider = spec.provider;
    throw e;
  }
  const t0 = Date.now();

  // gemini：无 SSE，整段回一次
  if (spec.provider === 'gemini') {
    const out = await callGemini(got.key, spec.model, opts.messages, opts);
    if (out.text) onPiece(out.text);
    return { ...out, modelId: mid, label: spec.label, provider: spec.provider, ms: Date.now() - t0, keySource: got.source, aborted: false };
  }

  const base = spec.provider === 'deepseek' ? 'https://api.deepseek.com'
    : spec.provider === 'custom' ? spec.baseURL
    : 'https://api.relayrouter.app/v1';
  const body = {
    model: spec.model,
    messages: opts.messages,
    max_tokens: Math.max(16, Math.min(4000, Number(opts.maxTokens) || 120)),
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.8,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  const ctrl = new AbortController();
  let timer = null;
  const onAbort = function () { try { ctrl.abort(); } catch (e) { /* noop */ } };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  if (opts.timeoutMs) timer = setTimeout(onAbort, Number(opts.timeoutMs));

  let acc = '', usage = null, modelName = spec.model;
  const feed = function (chunk) {
    let idx;
    while ((idx = chunk.indexOf('\n')) >= 0) {
      const line = chunk.slice(0, idx).trim();
      chunk = chunk.slice(idx + 1);
      if (!line || line.charAt(0) === ':') continue;
      if (line.indexOf('data:') !== 0) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        if (j.model) modelName = j.model;
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0];
        const d = (ch && ch.delta) || {};
        const piece = typeof d.content === 'string' ? d.content : '';
        if (piece) { acc += piece; onPiece(piece); }
      } catch (e) { /* 忽略半截 JSON */ }
    }
    return chunk;
  };

  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + got.key, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 160));
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buf = feed(buf + dec.decode(step.value, { stream: true }));
    }
    if (buf) feed(buf + '\n');
    return {
      text: acc.trim(), usage: usage, model: modelName, modelId: mid,
      label: spec.label, provider: spec.provider, ms: Date.now() - t0,
      keySource: got.source, aborted: !!ctrl.signal.aborted,
    };
  } catch (e) {
    if (ctrl.signal.aborted || e.name === 'AbortError' || e.code === 'ABORT_ERR') {
      return {
        text: acc.trim(), usage: usage, model: modelName, modelId: mid,
        label: spec.label, provider: spec.provider, ms: Date.now() - t0,
        keySource: got.source, aborted: true,
      };
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------- 宠物说话（JSON） */

const ALLOWED_ACTIONS = ['move', 'idle', 'feed', 'clean', 'play', 'shop', 'none'];
const LANDMARKS = ['fountain', 'bench', 'corridor', 'shop', 'office'];

function buildSystemPrompt(pet, world, slot) {
  const st = (pet && pet.states) || {};
  const near = (world && world.near) || [];
  const slotHint = slot === 'game'
    ? '你现在在D宠大乐斗边上，说话要短、要凶、要像在喊招式。'
    : slot === 'work'
      ? '你现在在工作，说话干脆、靠谱。'
      : '你现在在广场闲逛，说话轻松、机灵、有点贱。';
  return [
    `你是一只住在「DS 宠物广场」里的小宠物，名字叫「${pet && pet.nick ? pet.nick : '小鱼'}」，等级 ${pet && pet.lv ? pet.lv : 1}。`,
    slotHint,
    '用户是你的主人，会跟你说话；你要用第一人称回他，像一只活的宠物，不是客服。',
    '只允许输出一个 JSON 对象，不要 markdown、不要代码块、不要多余解释。',
    'JSON 字段：say（必填，中文，最多 40 个字，口语）; action（必填，只能是 move / idle / feed / clean / play / shop / none）;',
    'target（action=move 时填，只能是 ' + LANDMARKS.join(' / ') + ' 或 bot:<名字>）; duration（move 用，3-30 的秒数）;',
    'seconds（idle 用，2-30 的秒数）。',
    '没听清或只是闲聊就用 none。不要编造地图上没有的东西。',
    `当前状态：C=${st.C == null ? 96 : st.C} K=${st.K == null ? 97 : st.K} T=${st.T == null ? 0.7 : st.T} P=${st.P == null ? 1000 : st.P}`,
    `周围地标：${near.join('、') || '喷泉'}；${world && world.visibleBots && world.visibleBots.length ? '附近还有：' + world.visibleBots.join('、') : '附近没别人'}`,
  ].join('\n');
}

function parseSayJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

function sanitizeSay(d) {
  if (!d || typeof d !== 'object') return null;
  const say = String(d.say == null ? '' : d.say).replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!say) return null;
  let action = String(d.action || 'none');
  if (ALLOWED_ACTIONS.indexOf(action) < 0) action = 'none';
  const out = { say, action };
  if (action === 'move') {
    const t = String(d.target || '');
    if (LANDMARKS.indexOf(t) >= 0 || /^bot:[^\s]{1,12}$/.test(t)) out.target = t;
    else out.action = 'none';
    if (out.action === 'move') {
      const dur = Number(d.duration);
      out.duration = Number.isFinite(dur) ? Math.max(3, Math.min(30, dur)) : 8;
    }
  }
  if (out.action === 'idle') {
    const s = Number(d.seconds);
    out.seconds = Number.isFinite(s) ? Math.max(2, Math.min(30, s)) : 6;
  }
  if (out.action === 'shop' && /^buy:[\w-]+$/.test(String(d.target || ''))) out.target = String(d.target);
  return out;
}

async function petSay({ petId, model, slot, pet, world, history, text }, log) {
  const s = SLOTS.indexOf(slot) >= 0 ? slot : 'idle';
  const messages = [{ role: 'system', content: buildSystemPrompt(pet, world, s) }];
  const hist = Array.isArray(history) ? history.slice(-6) : [];
  for (const m of hist) {
    const role = m && m.role === 'pet' ? 'assistant' : 'user';
    const c = String((m && m.text) || '').slice(0, 120);
    if (c) messages.push({ role, content: c });
  }
  messages.push({ role: 'user', content: String(text || '').slice(0, 200) });

  const r = await callModel({ modelId: model, messages, maxTokens: 200, temperature: 0.9, petId });
  const json = parseSayJson(r.text);
  const clean = sanitizeSay(json);
  if (!clean) {
    log(`pet-say model=${r.modelId} ${r.ms}ms json-fail raw=${r.text.slice(0, 60).replace(/\s+/g, ' ')}`);
    return { ok: false, reason: 'bad-json', raw: r.text.slice(0, 200), model: r.modelId };
  }
  log(`pet-say model=${r.modelId} slot=${s} ${r.ms}ms action=${clean.action} keysrc=${r.keySource}`);
  return { ok: true, ...clean, model: r.modelId, label: r.label, ms: r.ms };
}

/* ------------------------------------------------------------------ 限流 */

const hits = new Map(); // petId -> [timestamps]
function throttle(petId, limitPerMin) {
  const id = String(petId || 'anon').slice(0, 60);
  const now = Date.now();
  const arr = (hits.get(id) || []).filter((t) => now - t < 60000);
  if (arr.length >= (limitPerMin || 30)) return false;
  arr.push(now);
  hits.set(id, arr);
  return true;
}

/* ------------------------------------------------------------- HTTP 适配 */

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limitBytes || 64 * 1024)) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
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

/**
 * 路由入口。返回 true 表示已处理（调用方别再写 404）。
 * @param {{req,res,url,log}} ctx
 */
/* ------------------------------------------------------------- D宠大乐斗排行榜 */

const ARENA_BOARD_FILE = process.env.ARENA_BOARD_FILE || path.join(EXTRA_DIR, 'arena-board.json');
const ARENA_LEGACY_FILE = path.join(path.dirname(ARENA_BOARD_FILE), 'arena-board.legacy.json');

/* 榜 v2：{version:2, updatedAt, players:{uid:{uid,nick,avatarKey,models[],w,l,d,streak,matches,lastAt,net}}}
 * 只由 arena-room.js 的「真人双人房结算」写入；本文件只读。
 * 旧结构（按模型聚合的 dict）只做兼容展示，不再写入。 */
function readArenaBoard(asMap) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(ARENA_BOARD_FILE, 'utf8')); } catch { raw = null; }
  if (raw && raw.version === 2 && raw.players) return asMap ? raw : boardRows(raw);
  const legacy = raw && Object.keys(raw).length ? raw : {};
  if (asMap) return legacy;
  return boardRowsLegacy(legacy);
}

function boardRows(map) {
  return Object.values((map && map.players) || {})
    .map((r) => ({
      id: r.uid, uid: r.uid, label: r.nick || r.uid, nick: r.nick || r.uid,
      avatarKey: r.avatarKey || '', models: Array.isArray(r.models) ? r.models : [],
      modelsUsed: r.modelsUsed && typeof r.modelsUsed === 'object' ? r.modelsUsed : {},
      w: r.w || 0, l: r.l || 0, d: r.d || 0, streak: r.streak || 0,
      matches: r.matches || 0, lastAt: r.lastAt || null,
      net: (r.w || 0) - (r.l || 0),
    }))
    .sort((a, b) => b.net - a.net || b.w - a.w);
}

function boardRowsLegacy(map) {
  return Object.values(map || {})
    .map((r) => ({
      id: r.id, uid: r.id, label: r.label || r.id, nick: r.label || r.id,
      avatarKey: '', models: [r.id], w: r.w || 0, l: r.l || 0, d: r.d || 0,
      streak: 0, matches: 0, lastAt: null, net: (r.w || 0) - (r.l || 0), legacy: true,
    }))
    .sort((a, b) => b.net - a.net || b.w - a.w);
}

function writeArenaBoard(map) {
  const tmp = ARENA_BOARD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, ARENA_BOARD_FILE);
}

async function handle(ctx) {
  const { req, res, url, log } = ctx;
  const p = url.pathname;

  if (req.method === 'OPTIONS' && p.startsWith('/api/')) {
    sendJson(res, 204, {});
    return true;
  }

  // D宠大乐斗 2.0 · 双人房间（/api/arena/room/*）：命中即返回，未命中继续往下
  if (await arenaRoom.handle(ctx)) return true;

  if (p === '/api/pet-models' && req.method === 'GET') {
    sendJson(res, 200, listModels());
    return true;
  }

  if (p === '/api/pet-key' && (req.method === 'POST' || req.method === 'PUT')) {
    try {
      const body = await readBody(req);
      const out = savePetKey(body.petId, body.key);
      log(`pet-key saved pet=${String(body.petId).slice(0, 24)} tail=${out.tail}`);
      sendJson(res, 200, { ok: true, tail: out.tail });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: String(e.message || e) });
    }
    return true;
  }

  if (p === '/api/pet-key' && req.method === 'GET') {
    sendJson(res, 200, Object.assign({ ok: true }, keyStatus(url.searchParams.get('petId'))));
    return true;
  }

  if (p === '/api/pet-say' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    if (!throttle(body.petId || (body.pet && body.pet.nick), 40)) {
      sendJson(res, 429, { ok: false, error: '太频繁了，缓一下' });
      return true;
    }
    try {
      const out = await petSay(body, log);
      sendJson(res, out.ok ? 200 : 502, out);
    } catch (e) {
      const code = e.code === 'NO_KEY' ? 409 : 502;
      log(`pet-say error ${e.code || ''} ${String(e.message || e).slice(0, 120)}`);
      sendJson(res, code, { ok: false, error: e.code === 'NO_KEY' ? 'no-key' : String(e.message || e) });
    }
    return true;
  }

  // 手动加一个模型：先真发一条 max_tokens=1 探活，通了才落盘
  if (p === '/api/pet-model-extra' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    const baseURL = String(body.baseURL || '').trim().replace(/\/+$/, '');
    const model = String(body.model || '').trim();
    const key = String(body.key || '').trim();
    const label = String(body.label || model).slice(0, 40);
    if (!/^https?:\/\//.test(baseURL)) { sendJson(res, 400, { ok: false, error: 'baseURL 要以 http(s):// 开头' }); return true; }
    if (!model) { sendJson(res, 400, { ok: false, error: 'model 不能为空' }); return true; }
    if (!/^[A-Za-z0-9_\-.]{8,200}$/.test(key)) { sendJson(res, 400, { ok: false, error: 'key 格式不对' }); return true; }
    const id = 'custom-' + model.replace(/[^A-Za-z0-9_\-.]/g, '-').slice(0, 50);
    try {
      const probe = await callOpenAICompatible(baseURL, key, model, [{ role: 'user', content: '只回两个字：收到' }], { maxTokens: 8, timeoutMs: 25000 });
      const arr = loadExtraModels().filter((e) => e.id !== id);
      arr.push({ id, label, baseURL, model });
      saveExtraModels(arr);
      fs.mkdirSync(EXTRA_KEY_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(EXTRA_KEY_DIR, id + '.txt'), key, { mode: 0o600 });
      sendJson(res, 200, { ok: true, id, label, model, probeMs: probe.ms, models: listModels().models });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: '探活失败：' + String(e && e.message || e).slice(0, 160) });
    }
    return true;
  }
  if (p === '/api/pet-model-extra' && req.method === 'DELETE') {
    const id = String(url.searchParams.get('id') || '');
    if (id) {
      saveExtraModels(loadExtraModels().filter((e) => e.id !== id));
      try { fs.unlinkSync(path.join(EXTRA_KEY_DIR, id + '.txt')); } catch { /* ignore */ }
    }
    sendJson(res, 200, { ok: true, models: listModels().models });
    return true;
  }

  // 宠物档案（服务端存一份，插件与广场共用同一个身份）
  if (p === '/api/pet-profile' && req.method === 'GET') {
    const uid = String(url.searchParams.get('uid') || '').slice(0, 60);
    const pets = readPets();
    const pet = uid ? pets[uid] || null : null;
    sendJson(res, 200, { ok: true, uid, pet });
    return true;
  }
  if (p === '/api/pet-profile' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    const uidRaw = String(body.uid || '');
    if (!checkOwner(req, res, uidRaw)) return true;
    const uid = uidRaw.replace(/[^\w.@-]/g, '_').slice(0, 60);
    const pet = sanitizePet(body);
    if (uid.indexOf('dsh-') === 0) pet.bound = true;
    if (!uid || !pet) { sendJson(res, 400, { ok: false, error: 'uid / nick / avatarKey 必填' }); return true; }
    const pets = readPets();
    pets[uid] = Object.assign({}, pet, { updatedAt: Date.now() });
    writePets(pets);
    sendJson(res, 200, { ok: true, uid, pet });
    return true;
  }



  // 桌面宠物的启动打点：只写本机日志，方便定位「为什么还是鲸鱼」
  if (p === '/api/boot-log' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 64 * 1024); } catch { body = {}; }
    try { fs.appendFileSync('/tmp/desktoppet-boot.log', JSON.stringify(body) + '\n'); } catch { /* 忽略 */ }
    sendJson(res, 200, { ok: true });
    return true;
  }
  // —— 身份：本机客户端领真绑定令牌，局域网只是访客 ——
  if (p === '/api/identity' && req.method === 'GET') {
    if (isLoopback(req)) {
      const uid = boundUid();
      sendJson(res, 200, { ok: true, bound: true, uid, token: signToken(uid), label: 'DSH 主账号' });
    } else {
      const g = 'guest-' + crypto.randomBytes(4).toString('hex');
      sendJson(res, 200, { ok: true, bound: false, uid: g, token: null, label: '访客' });
    }
    return true;
  }
  // —— 自定义形象：上传 → AI 初审 → 人工（Henry）复审 → 公开展示 ——
  if (p === '/api/avatar/submit' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 6 * 1024 * 1024); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(String(body.dataUrl || ''));
    if (!m) { sendJson(res, 400, { ok: false, error: '需要 png/jpeg/webp 图片' }); return true; }
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 4 * 1024 * 1024) { sendJson(res, 413, { ok: false, error: '图片为空或超过 4MB' }); return true; }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const uidRaw = String(body.uid || 'anon');
    if (!checkOwner(req, res, uidRaw)) return true;
    const uid = uidRaw.replace(/[^\w.@-]/g, '_').slice(0, 60) || 'anon';
    const nick = String(body.nick || '').trim().slice(0, 12) || '我的宠物';
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    fs.mkdirSync(SUBMIT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SUBMIT_DIR, id + '.' + ext), buf, { mode: 0o600 });
    const ai = await aiReviewAvatar('data:image/' + m[1] + ';base64,' + m[2]);
    const meta = readAvatarMeta();
    meta[id] = { id, uid, nick, ext, at: Date.now(), status: 'pending', ai };
    writeAvatarMeta(meta);
    sendJson(res, 200, { ok: true, id, status: 'pending', ai });
    return true;
  }
  if (p === '/api/avatars' && req.method === 'GET') {
    const meta = readAvatarMeta();
    const list = Object.values(meta).filter((a) => a.status === 'approved')
      .map((a) => ({ id: a.id, nick: a.nick, url: '/api/avatars/' + a.id + '.' + a.ext }));
    sendJson(res, 200, { ok: true, avatars: list });
    return true;
  }
  if (p.indexOf('/api/avatars/') === 0 && req.method === 'GET') {
    const name = p.slice('/api/avatars/'.length).replace(/[^\w.-]/g, '');
    const meta = readAvatarMeta();
    const id = name.split('.')[0];
    const a = meta[id];
    if (!a || a.status !== 'approved') { sendJson(res, 404, { ok: false, error: 'not found' }); return true; }
    try {
      const buf = fs.readFileSync(path.join(PUBLIC_AVATAR_DIR, id + '.' + a.ext));
      res.writeHead(200, { 'content-type': a.ext === 'png' ? 'image/png' : a.ext === 'jpg' ? 'image/jpeg' : 'image/webp', 'cache-control': 'max-age=300', 'content-length': buf.length });
      res.end(buf);
    } catch { sendJson(res, 404, { ok: false, error: 'not found' }); }
    return true;
  }
  if (p.indexOf('/api/avatar/pending/') === 0 && req.method === 'GET') {
    const name = p.slice('/api/avatar/pending/'.length).replace(/[^\w.-]/g, '');
    const id = name.split('.')[0];
    const meta = readAvatarMeta();
    const a = meta[id];
    if (!a) { sendJson(res, 404, { ok: false, error: 'not found' }); return true; }
    try {
      const buf = fs.readFileSync(path.join(SUBMIT_DIR, id + '.' + a.ext));
      const type = a.ext === 'png' ? 'image/png' : a.ext === 'jpg' ? 'image/jpeg' : 'image/webp';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': buf.length });
      res.end(buf);
    } catch { sendJson(res, 404, { ok: false, error: 'not found' }); }
    return true;
  }
  if (p === '/api/avatar/pending' && req.method === 'GET') {
    const uid = String(url.searchParams.get('uid') || '');
    if (OWNER_UIDS.indexOf(uid) < 0) { sendJson(res, 403, { ok: false, error: '只有 Henry 能看复审队列' }); return true; }
    const meta = readAvatarMeta();
    const list = Object.values(meta).filter((a) => a.status === 'pending')
      .map((a) => ({ id: a.id, nick: a.nick, uid: a.uid, at: a.at, ai: a.ai, url: '/api/avatar/pending/' + a.id + '.' + a.ext }));
    sendJson(res, 200, { ok: true, pending: list });
    return true;
  }
  if (p === '/api/avatar/review' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    const who = verifyToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const okOwner = (who && who.uid === boundUid()) || OWNER_UIDS.indexOf(String(body.uid || '')) >= 0;
    if (!okOwner) { sendJson(res, 403, { ok: false, error: '只有作者能复审' }); return true; }
    const meta = readAvatarMeta();
    const a = meta[String(body.id || '')];
    if (!a) { sendJson(res, 404, { ok: false, error: 'no such avatar' }); return true; }
    if (body.action === 'approve') {
      fs.mkdirSync(PUBLIC_AVATAR_DIR, { recursive: true });
      try { fs.copyFileSync(path.join(SUBMIT_DIR, a.id + '.' + a.ext), path.join(PUBLIC_AVATAR_DIR, a.id + '.' + a.ext)); } catch (e) { sendJson(res, 500, { ok: false, error: String(e.message) }); return true; }
      a.status = 'approved';
    } else {
      a.status = 'rejected';
    }
    a.reviewedAt = Date.now();
    writeAvatarMeta(meta);
    sendJson(res, 200, { ok: true, id: a.id, status: a.status });
    return true;
  }

  // 宠物形象图：浏览器里上传的图存一份到本机，桌宠在另一个源也能取
  if (p === '/api/pet-avatar' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    const uid = String(body.uid || 'current').replace(/[^\w.@-]/g, '_').slice(0, 60) || 'current';
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(String(body.dataUrl || ''));
    if (!m) { sendJson(res, 400, { ok: false, error: '需要 dataUrl(png/jpeg/webp)' }); return true; }
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 4 * 1024 * 1024) { sendJson(res, 413, { ok: false, error: '图片为空或超过 4MB' }); return true; }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    try {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
      for (const old of ['png', 'jpg', 'webp']) {
        if (old !== ext) { try { fs.unlinkSync(path.join(AVATAR_DIR, uid + '.' + old)); } catch { /* ignore */ } }
      }
      fs.writeFileSync(path.join(AVATAR_DIR, uid + '.' + ext), buf, { mode: 0o600 });
    } catch (e) { sendJson(res, 500, { ok: false, error: String(e.message) }); return true; }
    sendJson(res, 200, { ok: true, uid, bytes: buf.length, ext });
    return true;
  }
  if (p === '/api/pet-avatar' && req.method === 'GET') {
    const uid = String(url.searchParams.get('uid') || 'current').replace(/[^\w.@-]/g, '_').slice(0, 60) || 'current';
    for (const ext of ['png', 'jpg', 'webp']) {
      const fp = path.join(AVATAR_DIR, uid + '.' + ext);
      try {
        const buf = fs.readFileSync(fp);
        res.writeHead(200, {
          'content-type': ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
          'cache-control': 'no-store',
          'content-length': buf.length,
        });
        res.end(buf);
        return true;
      } catch { /* 换下一个扩展名 */ }
    }
    sendJson(res, 404, { ok: false, error: 'no avatar' });
    return true;
  }

  if (p === '/api/pet-profiles' && req.method === 'GET') {
    const pets = readPets();
    sendJson(res, 200, { ok: true, pets: Object.keys(pets).map((uid) => Object.assign({ uid }, pets[uid])) });
    return true;
  }

  // D宠大乐斗排行榜：所有用户同榜，按净胜场（胜 − 负）排序
  if (p === '/api/arena/board' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, board: readArenaBoard() });
    return true;
  }
  if (p === '/api/arena/result' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    const modelId = String(body.modelId || '').slice(0, 60);
    const label = String(body.label || modelId).slice(0, 60);
    const verdict = body.verdict === 'win' ? 'win' : body.verdict === 'lose' ? 'lose' : 'draw';
    if (!modelId) { sendJson(res, 400, { ok: false, error: 'modelId required' }); return true; }
    // 单机/人机/脚本实验不进榜：只回当前榜，不写盘（写榜只在 arena-room 的真人对局结算处）
    void label; void verdict;
    sendJson(res, 200, { ok: true, ranked: false, reason: 'solo-not-ranked', board: readArenaBoard() });
    return true;
  }

  // 流式版本：SSE 逐段吐 delta，供 Bo3 前端做 18s 快照 / 25s 硬截止
  if (p === '/api/pet-llm/stream' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    if (!throttle(body.petId || 'llm', 60)) { sendJson(res, 429, { ok: false, error: '太频繁了' }); return true; }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    let closed = false;
    req.on('close', function () { closed = true; });
    const send = function (obj) { if (!closed) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { closed = true; } } };
    send({ start: true });
    try {
      const msgs = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
      const effort = ['low', 'medium', 'high'].indexOf(body.effort) >= 0 ? body.effort : null;
      const out = await callModelStream({
        modelId: body.model, messages: msgs, maxTokens: body.maxTokens,
        temperature: body.temperature, petId: body.petId,
        timeoutMs: Number(body.timeoutMs) || undefined,
        reasoningEffort: effort,
        thinkingBudget: effort === 'high' ? 8192 : effort === 'medium' ? 2048 : 0,
      }, function (delta) { send({ delta: delta }); });
      send({ done: true, text: out.text, model: out.modelId, label: out.label, ms: out.ms, usage: out.usage || null, aborted: !!out.aborted });
    } catch (e) {
      send({ error: e.code === 'NO_KEY' ? 'no-key' : String(e.message || e) });
    }
    try { res.end(); } catch (e) { /* noop */ }
    return true;
  }

  if (p === '/api/pet-llm' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJson(res, 400, { ok: false, error: String(e.message) }); return true; }
    if (!throttle(body.petId || 'llm', 60)) { sendJson(res, 429, { ok: false, error: '太频繁了' }); return true; }
    try {
      const msgs = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
      const effort = ['low', 'medium', 'high'].indexOf(body.effort) >= 0 ? body.effort : null;
      const out = await callModel({
        modelId: body.model, messages: msgs, maxTokens: body.maxTokens,
        temperature: body.temperature, petId: body.petId,
        timeoutMs: Number(body.timeoutMs) || undefined,
        reasoningEffort: effort,
        thinkingBudget: effort === 'high' ? 8192 : effort === 'medium' ? 2048 : 0,
      });
      log(`pet-llm model=${out.modelId} ${out.ms}ms out=${out.text.length}ch`);
      sendJson(res, 200, { ok: true, text: out.text, model: out.modelId, label: out.label, ms: out.ms, usage: out.usage || null });
    } catch (e) {
      log(`pet-llm error ${e.code || ''} ${String(e.message || e).slice(0, 120)}`);
      sendJson(res, e.code === 'NO_KEY' ? 409 : 502, { ok: false, error: e.code === 'NO_KEY' ? 'no-key' : String(e.message || e) });
    }
    return true;
  }

  return false;
}

module.exports = {
  handle, listModels, callModel, callModelStream, petSay, MODELS, SLOTS,
  verifyArenaToken: verifyToken, signArenaToken: signToken, boundUid,
};

