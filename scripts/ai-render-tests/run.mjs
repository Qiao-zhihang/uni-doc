/**
 * AI 气泡渲染器用例运行器(零新增依赖)
 *
 * 用项目里已有的 esbuild(随 vite 安装)把纯函数测试用例打包成 ESM,
 * 再在本进程内动态 import 执行 —— 不需要 vitest/jest,也不起子进程。
 *
 * 用法:
 *   node scripts/ai-render-tests/run.mjs               # 跑全部用例
 *   node scripts/ai-render-tests/run.mjs <entry.ts>    # 跑指定入口(调试用)
 */
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const entry = process.argv[2] ? resolve(process.argv[2]) : join(here, 'render-cases.ts')

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  logLevel: 'warning',
  // 项目别名 @ → src
  alias: { '@': join(root, 'src') },
  // marks.ts 会 import 'katex/dist/katex.min.css',Node 不需要样式
  loader: { '.css': 'empty' },
  define: { __APP_VERSION__: '"test"' },
})

const code = result.outputFiles[0].text
const dir = await mkdtemp(join(tmpdir(), 'unidoc-ai-render-'))
const outFile = join(dir, 'render-cases.mjs')
await writeFile(outFile, code, 'utf8')

await import(pathToFileURL(outFile).href)
