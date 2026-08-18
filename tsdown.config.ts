/**
 * Dual-half build for an out-of-tree DSH plugin:
 *
 * 1. Host half  — src/index.ts      → lib/index.js      (ESM, node)
 * 2. Client half — src/client/index.ts → client/client.js (CJS closure-factory
 *    artifact that calls window.__ModuleLoader__.load({ id, factory }) and
 *    resolves externals through the injected require — the loader module table).
 *
 * The client shape mirrors the in-tree preset (deepseek-harness
 * packages/client/tsdown.client.ts @ 0.1.0-rc.5/rc.6) and the proven
 * out-of-tree adaptation in dsh-plugin-market (MIT). CSS handling:
 *  - `x.module.css` compiles via lightningcss to a hashed class map, css text
 *    self-injects a <style data-plugin> tag at factory execution;
 *  - plain `x.css` (e.g. @xyflow/react/dist/style.css) injects globally the
 *    same way and exports {} — tsdown's own css pipeline never sees either.
 */
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const id = (JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }).name

/**
 * Externals resolved from the loader module table at runtime. Our components
 * render inside the host's React tree (slot registration, not DOM takeover),
 * so react AND react-dom must be the host's instances — all four ids are in
 * the platform module table (deepseek-harness packages/client/web/src/platform.ts).
 */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

/**
 * Virtual-id wrapper keeping css away from tsdown's own css pipeline (which
 * requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not. The embedded path is kept
 * REPO-RELATIVE so the committed artifact is byte-identical across machines.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const projectRoot = process.cwd()
const requireFromRoot = createRequire(resolvePath(projectRoot, 'package.json'))

function cssVirtualId(kind: 'module' | 'plain', absPath: string): string {
  const normalized = absPath.replaceAll('\\', '/')
  // Dependency css: keep only the bare specifier (strips the machine- and
  // pnpm-version-dependent store path), re-resolvable via require at load().
  const marker = normalized.lastIndexOf('/node_modules/')
  const rel = marker !== -1
    ? normalized.slice(marker + '/node_modules/'.length)
    : relative(projectRoot, absPath).replaceAll('\\', '/')
  return `${CSS_VIRTUAL_PREFIX}${kind}:${rel}${CSS_VIRTUAL_SUFFIX}`
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    outputOptions: {
      // package.json main/exports point at lib/index.js (not .mjs)
      entryFileNames: 'index.js',
    },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'client',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // tsdown auto-externalizes package dependencies; anything NOT in the
    // loader module table must inline instead — a require() the table cannot
    // answer is a guaranteed runtime throw.
    noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    plugins: [{
      name: 'dsh-css-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        const kind = source.endsWith('.module.css') ? 'module' : 'plain'
        const abs = source.startsWith('.')
          ? resolvePath(importer !== undefined ? dirname(importer) : projectRoot, source)
          : isAbsolute(source)
            ? source
            // bare specifier (e.g. @xyflow/react/dist/style.css): node resolution
            : (importer !== undefined && isAbsolute(importer)
                ? createRequire(importer)
                : requireFromRoot).resolve(source)
        return cssVirtualId(kind, abs)
      },
      async load(this: { addWatchFile(file: string): void }, virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const body = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        const kind = body.slice(0, body.indexOf(':')) as 'module' | 'plain'
        const ref = body.slice(body.indexOf(':') + 1)
        const asLocal = resolvePath(projectRoot, ref)
        const fileId = existsSync(asLocal) ? asLocal : requireFromRoot.resolve(ref)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          ...(kind === 'module' ? { cssModules: { pattern: '[hash]_[local]' } } : {}),
          minify: true,
          // Without targets, lightningcss collapses hand-written prefixed
          // pairs to the -webkit- form only. Targets (major << 16) keep both.
          targets: { chrome: 90 << 16, firefox: 100 << 16, safari: 13 << 16, edge: 90 << 16 },
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        // One <style data-plugin> per css file; idempotent under re-evaluation.
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
