/**
 * dsh-desktop-pet — Host half.
 *
 * Exactly one job: serve the sprite PNGs that live next to this file, at
 * `/desktop-pet/assets/<name>`. No logic, no writes, no network.
 *
 * The route is a `prefix` route, so `req.url` arrives as the full pathname and
 * this handler does the slicing itself. Accepted file names are matched against
 * one flat-name pattern (no slashes survive), and the resolved path is checked
 * to still sit directly in `assets/`, so `../` and absolute paths can never
 * escape even if the pattern ever loosens.
 *
 * Every request goes through `connection.requestRejection` first: that is the
 * Host/Origin fence (DNS rebinding, cross-site reads) and the login-token gate
 * that all other route-owning plugins use. An <img> load from the app page is
 * same-origin and cookie-bearing, so it passes.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'desktop-pet'
export const inject = ['webServer', 'connection']

/** Mount point of the static route (no trailing slash). */
const ROUTE = '/desktop-pet/assets'
/** Directory the route may read from — the plugin's own `assets/`. */
const ROOT = fileURLToPath(new URL('./assets/', import.meta.url))

const CONTENT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.json', 'application/json; charset=utf-8'],
])

/** One flat file name: letters, digits, dot, dash, underscore. No separators. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|webp|jpg|json)$/u

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: (req, res) => serve(ctx, req, res) }),
    `desktop-pet: 静态精灵图路由 ${ROUTE}/<file>`,
  )
}

async function serve(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '只支持 GET / HEAD', { allow: 'GET, HEAD' })
    return
  }

  const pathname = new URL(req.url ?? '/', 'http://dsh.local').pathname
  // A prefix route normally hands us the full pathname; tolerate a server that
  // strips the mount point instead, so the route works either way.
  const rest = pathname.startsWith(`${ROUTE}/`)
    ? pathname.slice(ROUTE.length + 1)
    : pathname.replace(/^\/+/u, '')

  let name
  try {
    name = decodeURIComponent(rest)
  } catch {
    send(res, 400, '路径无效')
    return
  }
  if (!FILE_NAME.test(name)) {
    send(res, 404, '没有这个资源')
    return
  }

  const file = path.join(ROOT, name)
  if (path.dirname(path.resolve(file)) !== path.resolve(ROOT)) {
    send(res, 404, '没有这个资源')
    return
  }

  let info
  try {
    info = await stat(file)
  } catch {
    send(res, 404, '没有这个资源')
    return
  }
  if (!info.isFile()) {
    send(res, 404, '没有这个资源')
    return
  }

  res.statusCode = 200
  res.setHeader('content-type', CONTENT_TYPES.get(path.extname(name).toLowerCase()) ?? 'application/octet-stream')
  res.setHeader('content-length', String(info.size))
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

function send(res, status, message, headers = {}) {
  res.statusCode = status
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(message)
}
