/**
 * dsh-pet-arena — Host 插件
 *
 * 一个面板 + 一套本地接口：
 *   GET  /pet-arena/                  游戏页（public/index.html）
 *   GET  /pet-arena/assets/*          宠物贴图
 *   *    /pet-arena/api/*             模型目录、真调用、排行榜（server/pet-llm.js）
 *
 * 所有路由都过连接层鉴权（ctx.connection.requestRejection），本机以外的请求拿不到数据。
 */
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const petLlm = require_('./server/pet-llm.cjs')

export const name = 'pet-arena'
export const inject = ['webServer', 'connection']

const ROOT = '/pet-arena'
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROOT + '/api',
      handler: (req, res) => apiHandler(ctx, req, res),
    }),
    'pet-arena: api',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROOT,
      handler: (req, res) => staticHandler(ctx, req, res),
    }),
    'pet-arena: static',
  )
}

/* -------------------------------------------------------------- 鉴权 */

function denied(ctx, req, res, url) {
  let rejection
  try { rejection = ctx.connection?.requestRejection?.(req) } catch { rejection = 401 }
  if (rejection === undefined || rejection === null) return false
  // 面板里的 iframe 拿不到 DSH 的浏览器会话 cookie（跨进程/被连接层判 401、403），
  // 所以再认宠物服务自己签的令牌：父页面从 /api/identity 拿到 uid.token，
  // 通过 iframe query 或 x-arena-token 头带过来。令牌 12 小时有效、只签本机主账号。
  const token = arenaTokenOf(req, url)
  if (token && petLlm.verifyArenaToken(token)) return false
  writeJson(res, 403, {
    ok: false,
    error: '未授权的请求',
    reason: typeof rejection === 'number' ? rejection : 'rejected',
  })
  return true
}

/** 令牌来源：query ?token= → x-arena-token 头 → Authorization: Bearer */
function arenaTokenOf(req, url) {
  try {
    const q = url && url.searchParams.get('token')
    if (q) return q
  } catch { /* noop */ }
  const h = req.headers && req.headers['x-arena-token']
  if (typeof h === 'string' && h) return h
  const auth = String((req.headers && req.headers.authorization) || '')
  return auth.indexOf('Bearer ') === 0 ? auth.slice(7) : ''
}

function writeJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(body.length))
  res.end(body)
}

/* ---------------------------------------------------------------- API */

async function apiHandler(ctx, req, res) {
  const requestUrl = new URL(req.url, 'http://localhost')
  if (denied(ctx, req, res, requestUrl)) return
  // 已经过 DSH 连接层鉴权（ctx.connection.requestRejection）的请求等于「本机授权客户端」：
  // webServer 转进来的 socket 往往是内部连接，remoteAddress 不是 127.0.0.1，单看它
  // 会把插件面板里的请求判成访客。这里给 pet-llm 一个明确标记，身份按主账号算。
  req.dshAuthorized = true
  const url = requestUrl
  // /pet-arena/api/xxx → /api/xxx，直接复用宠物模型与排行榜那套实现
  url.pathname = url.pathname.slice(ROOT.length)

  // 宿主自己的模型通道（用户 DSH 里能选的模型），拿不到就让前端退回直连
  if (url.pathname === '/api/host-models' && req.method === 'GET') {
    return writeJson(res, 200, await hostModels(ctx))
  }
  if (url.pathname === '/api/host-call' && req.method === 'POST') {
    return hostCall(ctx, req, res)
  }
  try {
    const handled = await petLlm.handle({ req, res, url, log: () => {} })
    if (!handled) writeJson(res, 404, { ok: false, error: 'no such api', path: url.pathname })
  } catch (e) {
    writeJson(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 160) })
  }
}

/* -------------------------------------------------------- 宿主模型通道 */

function llmOf(ctx) {
  try { return ctx?.get?.('llm') ?? ctx?.llm ?? null } catch { return null }
}

async function hostModels(ctx) {
  const llm = llmOf(ctx)
  if (!llm || typeof llm.listProviders !== 'function') return { ok: true, available: false, providers: [] }
  const list = (llm.listProviders() || []).filter((p) => p && p.id)
  const providers = []
  for (const p of list) {
    let models = []
    try { models = (await llm.listModels(p.id)) || [] } catch { models = [] }
    if (!Array.isArray(models) || models.length === 0) continue
    providers.push({
      id: p.id,
      label: p.label || p.name || p.id,
      models: models.map((m) => ({ id: m.id, label: m.label || m.name || m.id })),
    })
  }
  return { ok: true, available: providers.length > 0, providers }
}

async function hostCall(ctx, req, res) {
  const llm = llmOf(ctx)
  if (!llm || typeof llm.prepareCall !== 'function') {
    writeJson(res, 409, { ok: false, error: 'host-llm-unavailable' })
    return
  }
  let body
  try { body = JSON.parse(await readAll(req)) } catch { writeJson(res, 400, { ok: false, error: 'bad json' }); return }
  const provider = String(body.provider || '')
  const model = String(body.model || '')
  if (!provider || !model) { writeJson(res, 400, { ok: false, error: 'provider/model required' }); return }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : []
  const maxTokens = Number(body.maxTokens) || 1200
  const effort = ['low', 'medium', 'high'].includes(body.effort) ? body.effort : undefined
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Number(body.timeoutMs) || 120000)
  const t0 = Date.now()
  try {
    const config = { provider, model, maxTokens, ...(effort ? { reasoningEffort: effort } : {}) }
    const prepared = await llm.prepareCall(config, ctrl.signal)
    let text = ''
    let usage = null
    for await (const chunk of prepared.stream({ ...config, messages, temperature: 0.2, signal: ctrl.signal })) {
      if (chunk?.type === 'text-delta') text += chunk.text || ''
      else if (chunk?.type === 'usage') usage = chunk.usage || null
    }
    writeJson(res, 200, { ok: true, text: text.trim(), ms: Date.now() - t0, usage, via: 'host' })
  } catch (e) {
    writeJson(res, 502, { ok: false, error: String((e && e.message) || e).slice(0, 160), via: 'host' })
  } finally {
    clearTimeout(timer)
  }
}

function readAll(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    let size = 0
    req.on('data', (b) => {
      size += b.length
      if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); return }
      parts.push(b)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

/* ------------------------------------------------------------- 静态资源 */

async function staticHandler(ctx, req, res) {
  if (denied(ctx, req, res)) return
  const url = new URL(req.url, 'http://localhost')
  let rel = url.pathname.slice(ROOT.length)
  if (!rel || rel === '/') rel = '/index.html'

  let decoded
  try { decoded = decodeURIComponent(rel) } catch { writeJson(res, 400, { ok: false, error: 'bad path' }); return }

  const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = join(PUBLIC_DIR, safe)
  if (!full.startsWith(PUBLIC_DIR.replace(/[/\\]$/, '') + sep)) {
    writeJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }

  let info
  try { info = await stat(full) } catch { writeJson(res, 404, { ok: false, error: 'not found' }); return }
  if (!info.isFile()) { writeJson(res, 404, { ok: false, error: 'not found' }); return }

  const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream'
  const isHtml = type.startsWith('text/html')
  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('cache-control', isHtml ? 'no-store' : 'public, max-age=300')
  res.setHeader('content-length', String(info.size))
  createReadStream(full).pipe(res)
}
