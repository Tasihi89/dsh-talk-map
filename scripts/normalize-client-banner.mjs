#!/usr/bin/env node
/**
 * Post-build normalization of client/client.js, a COMMITTED and PUBLISHED
 * artifact — it must be byte-identical no matter whose machine built it, and
 * hosts sniff the loader id from the file head, so the file must START with
 * the exact one-line `window.__ModuleLoader__.load({ id: "…"` prefix.
 * Rolldown pretty-prints the tsdown banner onto three lines; collapse them
 * back, leaving blank lines so the sourcemap's line numbers stay valid.
 *
 * CSS virtual ids are generated repo-relative by tsdown.config.ts itself, so
 * the only remaining machine-dependence risk is an absolute path leaking in
 * via some other channel — guard against that and fail the build if found.
 *
 * Pattern proven in dsh-plugin-market (MIT).
 */
import fs from 'node:fs'

const file = 'client/client.js'
const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`

let code = fs.readFileSync(file, 'utf8')

// --- 1. one-line loader banner -------------------------------------------
if (!code.startsWith(required)) {
  const lines = code.split('\n')
  const head = [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(name)},`,
    '\tfactory: (require) => {',
  ]
  if (lines[0] !== head[0] || lines[1] !== head[1] || lines[2] !== head[2]) {
    console.error(`normalize-client-banner: unexpected ${file} header:\n` + lines.slice(0, 3).join('\n'))
    process.exit(1)
  }
  lines[0] = required
  lines[1] = ''
  lines[2] = ''
  code = lines.join('\n')
}

// --- 2. no absolute build paths in the artifact ----------------------------
const root = process.cwd().replaceAll('\\', '/')
const leaks = [
  ...code.matchAll(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
  ...code.matchAll(/dsh-css:(?:module|plain):(?:\/|[A-Za-z]:[/\\])[^\n"]*/g),
].map(match => match[0].slice(0, 60))
if (leaks.length > 0) {
  console.error(`normalize-client-banner: absolute build path left in ${file}: ${leaks.slice(0, 3).join(', ')}`)
  process.exit(1)
}

fs.writeFileSync(file, code)
console.log(`normalize-client-banner ok: ${file}`)
