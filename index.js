/**
 * dsh-darena — D宠大乐斗（独立插件）Host 端
 *
 * 一个 npm 包只做一个小游戏插件，两条静态/接口前缀都在包内：
 *   /pet-arena/（游戏页 public/）、/pet-arena/api/*（server/pet-llm.cjs）
 *   /desktop-pet/assets/*（前台形象挂件的贴图）
 *   /ds-pet/api/*（挂件读账号形象，键与合集版一致）
 * 不 import AI 办公室，也不依赖任何邻目录。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { apply as petApply, inject as petInject } from './desktop-pet/index.js'
import { apply as arenaApply, inject as arenaInject } from './arena/index.js'

export const name = 'darena'
export const inject = Array.from(new Set([
  ...(petInject || []),
  ...(arenaInject || []),
  'webServer',
  'connection',
]))

const AVATAR_DIR = join(homedir(), '.dsh', 'bot', 'pet-hub', 'avatars')
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

/** 形象：桌宠在 DSH 源、图存在另一个源，所以统一从本机 pet-hub 取。 */
async function serveMyPet(ctx, req, res) {
  try {
    const idRes = await fetch('http://127.0.0.1:8925/api/identity')
    const id = await idRes.json()
    if (!id || !id.ok || !id.bound) throw new Error('not bound')
    const pr = await fetch('http://127.0.0.1:8925/api/pet-profile?uid=' + encodeURIComponent(id.uid))
    const pj = await pr.json()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, uid: id.uid, pet: (pj && pj.pet) || null }))
  } catch (e) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
  }
}

function servePetAvatar(ctx, req, res) {
  let rejection
  try { rejection = ctx.connection?.requestRejection?.(req) } catch { rejection = 401 }
  if (rejection !== undefined && rejection !== null) { res.writeHead(403); res.end('forbidden'); return }
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  const uid = String(u.searchParams.get('uid') || 'current').replace(/[^\w.@-]/g, '_').slice(0, 60) || 'current'
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const buf = readFileSync(join(AVATAR_DIR, uid + '.' + ext))
      res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': 'no-store', 'content-length': buf.length })
      res.end(buf)
      return
    } catch { /* 换下一个扩展名 */ }
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: 'no avatar' }))
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ds-pet/api',
    handler: (req, res) => {
      const path = String(req.url || '/').split('?')[0]
      if (path === '/ds-pet/api/my-pet') return serveMyPet(ctx, req, res)
      return servePetAvatar(ctx, req, res)
    },
  }), 'darena: pet avatar')
  const disposePet = petApply(ctx)
  const disposeArena = arenaApply(ctx)
  return () => {
    try { disposeArena?.() } catch { /* 忽略 */ }
    try { disposePet?.() } catch { /* 忽略 */ }
  }
}
