'use strict'
/**
 * core2.cjs — 给插件包（package.json "type": "module"）装核心用。
 *
 * public/core2.js 是「浏览器 + node 双用」的 IIFE 脚本，本来就带一条 CJS 出口
 * （`if (typeof module !== 'undefined' && module.exports) module.exports = api`）。
 * 但插件包是 ESM，require('./core2.js') / require('../public/core2.js') 会被当成
 * ES module 求值：`module` 不存在 → 走 `root.ArenaCore2 = api` 那条出口 →
 * require 回来是空对象 → arena-room 的 loadCore 拿不到 genFamily/scoreRound，
 * 线上所有 /pet-arena/api/* 都回 500 core-missing。
 *
 * 这里用一个最小 module 沙箱把同一份 public/core2.js 装进来，返回同一个 api。
 */
const fs = require('node:fs')
const path = require('node:path')

function loadFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const module = { exports: {} }
  const run = new Function('module', 'exports', 'window', 'globalThis', src + '\nreturn module.exports;')
  return run(module, module.exports, undefined, {})
}

let api = null
const candidates = [
  path.join(__dirname, '../public/core2.js'),
  path.join(__dirname, '../../public/core2.js'),
  path.join(__dirname, 'core2.js'),
]
for (const file of candidates) {
  try {
    if (!fs.existsSync(file)) continue
    const got = loadFile(file)
    if (got && typeof got.genFamily === 'function' && typeof got.scoreRound === 'function') { api = got; break }
  } catch (e) { /* 换下一个候选 */ }
}

module.exports = api || {}
