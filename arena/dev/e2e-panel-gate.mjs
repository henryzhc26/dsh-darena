/**
 * e2e：插件面板 iframe 场景（技术专员，2026-11-13）
 *
 * 背景：面板 iframe 里的 /pet-arena/api/* 会被 DSH 连接层判成未授权（401→插件回 403），
 * 页面拿不到账号宠物，旧版还会把 403 当成「没宠物」弹「先领一只宠物」。
 *
 * 本脚本用一个「连接层永远拒绝」的桩服务复现那个环境，然后断言：
 *   1) 不带令牌 → 403（鉴权没被削弱）；
 *   2) 带签名令牌 → /api/identity 200 且是主账号；
 *   3) 页面加载（父页面用 query 带 uid+token）→ 不出现任何 gate，直接进大厅并显示账号宠物；
 *   4) 页面里所有 /pet-arena/api/* 请求都拿到 200（令牌随请求带上，不靠 8925 兜底）。
 *
 * 用法：先起一个带 CDP 的 headless Chrome（--remote-debugging-port=9222），再
 *   node arena/dev/e2e-panel-gate.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARENA = path.dirname(HERE)
const PUBLIC = path.join(ARENA, 'public')
const PORT = Number(process.env.PORT || 8981)
const CDP = process.env.CDP || 'http://127.0.0.1:9222'
const PET_BASE = process.env.PET_BASE || 'http://127.0.0.1:8925'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' }

const mod = await import(path.join(ARENA, 'index.js'))
let apiHandler = null
mod.apply({
  effect(fn) { const r = fn(); return () => { try { r && r() } catch {} } },
  webServer: { protocol: 'http:', register(route) { if (route.path === '/pet-arena/api') apiHandler = route.handler; return () => {} } },
  // 关键：模拟 iframe —— 连接层永远认不出这份请求
  connection: { requestRejection() { return 401 } },
  get() { return null },
})

const hits = []
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost')
  if (u.pathname.startsWith('/pet-arena/api/')) {
    const origEnd = res.end.bind(res)
    res.end = (b) => { hits.push({ status: res.statusCode, path: u.pathname, token: u.searchParams.get('token') ? 'yes' : 'no' }); return origEnd(b) }
    await apiHandler(req, res)
    return
  }
  const rel = u.pathname === '/pet-arena/' || u.pathname === '/pet-arena' ? 'index.html' : u.pathname.replace('/pet-arena/', '')
  const file = path.join(PUBLIC, rel)
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const results = []
const check = (name, ok, extra) => { results.push({ name, ok, extra }); if (!ok) console.log('  detail:', JSON.stringify(extra)) }

// 1/2) 接口鉴权：不带令牌 403，带签名令牌 200
const idRes = await fetch(PET_BASE + '/api/identity').then((r) => r.json())
const bare = await fetch(`http://127.0.0.1:${PORT}/pet-arena/api/identity`).then((r) => r.json())
check('无令牌被连接层拒 → 403', bare.ok === false && bare.reason === 401, bare)
const withTok = await fetch(`http://127.0.0.1:${PORT}/pet-arena/api/identity?token=${encodeURIComponent(idRes.token)}`).then((r) => r.json())
check('带签名令牌 → 200 且是主账号', withTok.ok === true && withTok.bound === true && withTok.uid === idRes.uid, withTok)

// 3/4) 页面：模拟面板 iframe（query 带 uid+token），必须直接进大厅
hits.length = 0 // 上面两条是接口直测，不计入页面请求统计
const list = await (await fetch(CDP + '/json/list')).json().catch(() => null)
if (!list) { console.log('FAIL 需要先起 headless Chrome（--remote-debugging-port=9222）'); process.exit(2) }
const url = `http://127.0.0.1:${PORT}/pet-arena/?uid=${encodeURIComponent(idRes.uid)}&token=${encodeURIComponent(idRes.token)}&base=3`
const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let seq = 0
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; const onMsg = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }; ws.addEventListener('message', onMsg); ws.send(JSON.stringify({ id, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value
await new Promise((r) => setTimeout(r, 3000))
const page = await evalJs(`(() => { const t = document.body.innerText || ''; return {
  gate: !!document.querySelector('.gate'),
  adopt: t.indexOf('先领一只宠物') >= 0,
  retry: t.indexOf('宠物档案暂时读不到') >= 0,
  guest: t.indexOf('这是访客视角') >= 0,
  hasPet: t.indexOf(${JSON.stringify('陈旋鱼')}) >= 0,
} })()`)
check('页面不出现任何 gate', page.gate === false && page.adopt === false && page.retry === false && page.guest === false, page)
check('页面直接显示账号宠物', page.hasPet === true, page)
const apiHits = hits.filter((h) => h.path.startsWith('/pet-arena/api/'))
const allOk = apiHits.length > 0 && apiHits.every((h) => h.status === 200 && h.token === 'yes')
check('所有插件接口 200 且都带令牌', allOk, apiHits)
const petHit = apiHits.find((h) => h.path === '/pet-arena/api/pet-profile')
check('pet-profile 走的是插件接口（不是 8925 兜底）', !!petHit && petHit.status === 200, petHit)

await send('Page.close').catch(() => {})
try { ws.close() } catch {}
server.close()

let fail = 0
for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name) }
console.log(`合计 ok=${results.length - fail} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
