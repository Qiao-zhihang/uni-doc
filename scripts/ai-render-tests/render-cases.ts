/**
 * 渲染层用例(纯函数,无 DOM 依赖)
 *
 * 由 scripts/ai-render-tests/run.mjs 用 esbuild 打包后执行:
 *   node scripts/ai-render-tests/run.mjs
 *
 * 覆盖:
 *   AI 气泡:图片 / KaTeX / Mermaid 占位 / ==高亮== / ^上标^ / ~下标~ / <u> /
 *          原始 HTML(含 XSS 用例) / 脚注 / 嵌套列表 / 任务列表 / 表格 / 引用 /
 *          转义保真(禁止二次解析) / 代码围栏隔离 / 内部标记剥离 / rawHtml 开关
 *   共享链路:行内代码字面量语义 / 序列化不再污染 code span / 打开-保存-重开幂等
 */

import { renderBubbleMarkdown, stripInternalMarkers } from '@/ai/renderBubble'
import { renderMarkdown as renderStreaming } from '@/ai/markdown'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Mark } from '@/core/blocks/types'
import {
  INLINE_ESCAPABLE_CHARS,
  INLINE_SYNTAX_CHARS,
  parseInlineMarkdown,
} from '@/core/parser/inlineMarkdown'
import { marksToHtml, marksToSource, sameAsSource } from '@/components/blocks/marks'
import {
  deserializeMarkdown,
  parseFrontmatter,
  serializeMarkdown,
} from '@/core/serializer/markdown'
import {
  cleanupFacts,
  createMemoryExport,
  evictOverflow,
  extractHeuristicCandidates,
  findDuplicateGroups,
  findDuplicateOf,
  MAX_FACTS,
  mergeFactGroup,
  normalizeFactText,
  normalizeMemory,
  parseMemoryExport,
  rankFacts,
  tokenizeQuery,
} from '@/ai/memoryCore'
import type { MemoryFact } from '@/ai/types'

let passed = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  \u2713 ${name}`)
  } else {
    failures.push(`${name}${detail ? ` \u2014 ${detail}` : ''}`)
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`)
  }
}

function group(title: string) {
  console.log(`\n${title}`)
}

/** 断言 html 同时包含/不包含若干片段 */
function expect(name: string, html: string, must: string[], mustNot: string[] = []) {
  const missing = must.filter((s) => !html.includes(s))
  const leaked = mustNot.filter((s) => html.includes(s))
  if (!missing.length && !leaked.length) {
    check(name, true)
    return
  }
  const detail = [
    missing.length ? `缺少 ${JSON.stringify(missing)}` : '',
    leaked.length ? `不应出现 ${JSON.stringify(leaked)}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  check(name, false, `${detail} | 实际: ${html.slice(0, 240)}`)
}

const render = (md: string, opts?: { idPrefix?: string; rawHtml?: boolean }) =>
  renderBubbleMarkdown(md, opts)

// ===================== 1. 图片 =====================
group('1. 图片')
{
  const abs = render('![猫](https://example.com/a.png)')
  expect('http 图片原样输出', abs, [
    '<img',
    'class="md-image"',
    'src="https://example.com/a.png"',
    'alt="猫"',
  ])

  const data = render('![d](data:image/png;base64,AAA)')
  expect('data: 图片原样输出', data, ['src="data:image/png;base64,AAA"'], ['data-md-lazy'])

  const rel = render('![图](assets/pic.png)')
  expect(
    'vault 相对路径转为惰性占位(避免请求坏 URL)',
    rel,
    ['data-md-lazy="1"', 'data-md-src="assets/pic.png"'],
    [' src="assets/pic.png"'],
  )

  // 图片 src 白名单:模型输出不可信,只放行 http(s)/data:image/相对路径
  const httpPlain = render('![a](http://example.com/b.png)')
  expect('http:// 图片放行', httpPlain, ['src="http://example.com/b.png"'])

  const blocked: Array<[string, string]> = [
    ['asset:// 本地文件直读(assetProtocol scope=**)', 'asset://localhost/C:/Users/x/secret.png'],
    ['file:// 本地文件', 'file:///C:/Windows/win.ini'],
    ['blob: 伪 URL', 'blob:http://localhost/abc'],
    ['协议相对 //host(会造成外部请求)', '//evil.com/track.png'],
    ['绝对路径 /etc/passwd', '/etc/passwd'],
    ['javascript: 伪协议', 'javascript:alert(1)'],
    ['data:text/html 非图片 data URL', 'data:text/html,<script>alert(1)</script>'],
  ]
  for (const [name, src] of blocked) {
    const html = render(`![x](${src})`)
    // 安全不变量:不得出现带 src 的 <img>,也不得进入惰性解析通道。
    // 两种安全结局:替换为 data-md-blocked 占位,或整段退化为字面文本
    check(
      `拦截 ${name}`,
      !/<img[^>]*\ssrc=/i.test(html) && !html.includes('data-md-lazy'),
      html.slice(0, 200),
    )
  }

  // 原始 HTML 里的 <img src> 走 filterAttrs 白名单(asset: 不是安全协议 → 属性被剥离)
  const rawImg = render('<img src="asset://localhost/C:/Users/x/secret.png">')
  expect('原始 HTML 的 asset: src 被属性白名单剥离', rawImg, [], ['asset:', 'src='])

  // 独立成行的图片会被 deserializeMarkdown 解析成 image block
  const blockImg = render('![单独一行](assets/standalone.png)')
  expect('独立成行图片(image block)', blockImg, ['<img', 'data-md-src="assets/standalone.png"'])
}

// ===================== 2. KaTeX =====================
group('2. KaTeX 公式')
{
  const inline = render('质能方程 $E=mc^2$ 很简洁')
  expect('行内公式 $…$', inline, ['class="katex"', 'katex-html'], ['$E=mc^2$'])

  const display = render('$$\\int_0^1 x\\,dx$$')
  expect('块级公式 $$…$$', display, ['katex-display', 'class="katex"'])

  const plain = render('价格是 5$ 到 10$ 之间')
  expect('美元符号不误判为公式', plain, ['价格是 5$ 到 10$ 之间'], ['class="katex"'])

  const broken = render('$\\frac{1}{$')
  check('非法公式不抛异常(降级)', typeof broken === 'string' && broken.length > 0)
}

// ===================== 3. Mermaid 占位 =====================
group('3. Mermaid(仅占位,实际渲染在组件后置通道)')
{
  const md = ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n')
  const html = render(md)
  expect('mermaid 围栏输出 language-mermaid 代码块供后置通道捕获', html, [
    '<pre class="md-pre">',
    'class="language-mermaid"',
    'A--&gt;B',
  ])
  const other = render(['```ts', 'const a = 1', '```'].join('\n'))
  expect('普通代码块带 language class 且内容转义', other, ['class="language-ts"', 'const a = 1'])
}

// ===================== 4. 行内扩展标记 =====================
group('4. ==高亮== / ^上标^ / ~下标~ / <u>')
{
  expect('==高亮==', render('这是 ==重点== 内容'), ['<mark class="md-highlight">重点</mark>'])
  expect('^上标^', render('x^2^'), ['<sup>2</sup>'])
  expect('~下标~', render('H~2~O'), ['<sub>2</sub>'])
  expect('<u>下划线</u>', render('<u>下划线</u>'), ['<u>下划线</u>'])
  expect('基础标记仍然正常', render('**粗** *斜* ~~删~~ `码`'), [
    '<strong>粗</strong>',
    '<em>斜</em>',
    '<del>删</del>',
    '<code class="inline-code">码</code>',
  ])
}

// ===================== 5. 原始 HTML =====================
group('5. 原始 HTML(白名单)')
{
  expect('白名单标签保留', render('<b>粗</b> 与 <span>span</span>'), [
    '<b>粗</b>',
    '<span>span</span>',
  ])
  expect('白名单属性保留', render('<span style="color:red">红</span>'), ['style="color:red"'])
  expect('居中标签保留', render('<center>中</center>'), ['<center>中</center>'])
}

// ===================== 6. XSS 用例 =====================
group('6. XSS 防护(不可信模型输出)')
{
  const cases: Array<[string, string, string[]]> = [
    ['onerror 事件被剥离', '<img src=x onerror=alert(1)>', ['onerror', 'alert(1)']],
    ['javascript: 链接被拒', '<a href="javascript:alert(1)">点我</a>', ['javascript:']],
    ['<script> 不成为标签', '<script>alert(1)</script>', ['<script', '</script>']],
    ['<iframe> 不成为标签', '<iframe src="https://evil.com"></iframe>', ['<iframe']],
    ['<style> 不成为标签', '<style>body{display:none}</style>', ['<style']],
    ['<svg onload> 不成为标签', '<svg onload=alert(1)></svg>', ['<svg']],
    ['<object> 不成为标签', '<object data="x"></object>', ['<object']],
    ['style 里的 position:fixed 被丢', '<div style="position:fixed">x</div>', ['position:fixed']],
    ['style 里的 url() 被丢', '<div style="background:url(javascript:alert(1))">x</div>', ['url(']],
    ['行内 <u onclick> 事件被剥离', '<u onclick="alert(1)">下划线</u>', ['onclick']],
    [
      'data:text/html 链接被拒',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      ['data:text/html'],
    ],
  ]
  for (const [name, md, forbidden] of cases) {
    const html = render(md)
    expect(name, html, [], forbidden)
  }
  // 图片 mark 的 href 注入:解析器拒绝不安全 URL,整体退化为字面文本(位于 <p> 文本节点内,
  // 引号无法逃逸成属性) —— 关键是不能产生 <img> 标签
  const imgInject = render('![x](" onerror="alert(1))')
  expect('图片 href 注入不产生 <img> 标签', imgInject, ['![x]('], ['<img'])
}

// ===================== 7. 脚注 =====================
group('7. 脚注')
{
  const md = ['正文引用[^b]，再看[^a]。', '', '[^a]: 第一条定义', '[^b]: 第二条定义'].join('\n')
  const html = render(md, { idPrefix: 'm1' })
  expect(
    '脚注引用→锚点(按首次引用顺序编号,且不使用 href)',
    html,
    ['id="fnref-m1-1" class="md-fn-ref">1</a>', 'id="fnref-m1-2" class="md-fn-ref">2</a>'],
    ['href="#fn', 'fnref-m1-2" class="md-fn-ref">1<'],
  )
  expect('脚注区按引用顺序输出定义 + 返回链接', html, [
    '<section class="md-footnotes">',
    'id="fn-m1-1"',
    'id="fn-m1-2"',
    '第一条定义',
    '第二条定义',
    'id="fnback-m1-1"',
  ])
  check(
    '脚注编号顺序 = 首次引用顺序(b 引用在前 → b 得 1)',
    html.indexOf('第二条定义') < html.indexOf('第一条定义'),
  )

  const undef = render('引用[^nope] 但没定义')
  expect('未定义的引用保持字面量', undef, ['[^nope]'], ['md-fn-ref'])

  const unreferenced = render('没有引用\n\n[^unused]: 未使用的定义')
  expect('未被引用的定义不输出', unreferenced, [], ['未使用的定义', 'md-footnotes'])

  const multiline = render(['引用[^m]', '', '[^m]: 第一行', '  第二行续写'].join('\n'))
  expect('脚注定义支持缩进续行', multiline, ['第一行', '第二行续写'])

  const inFence = render(['```', '[^x]: 这是代码不是定义', '```', '', '正文[^x]'].join('\n'))
  expect(
    '围栏代码块内的脚注定义/引用不被改写',
    inFence,
    ['[^x]: 这是代码不是定义', '正文[^x]'],
    ['md-fn-ref'],
  )

  const dup = render(['引用[^d]', '', '[^d]: 第一个', '[^d]: 第二个'].join('\n'))
  check('重复定义取第一个', dup.includes('第一个'))

  // 编号隔离:不同消息前缀不冲突
  const a = render('引用[^z]\n\n[^z]: 定义', { idPrefix: 'm1' })
  const b = render('引用[^z]\n\n[^z]: 定义', { idPrefix: 'm2' })
  check('idPrefix 隔离多消息锚点', a.includes('fnref-m1-1') && b.includes('fnref-m2-1'))
}

// ===================== 8. 块级结构 =====================
group('8. 块级结构(复用 deserializeMarkdown)')
{
  expect('标题', render('## 二级标题'), ['<h2 class="md-h md-h2">二级标题</h2>'])
  expect('无序列表', render('- 甲\n- 乙'), ['<ul class="md-ul">', '<li class="md-li">甲</li>'])
  expect('有序列表', render('1. 一\n2. 二'), ['<ol class="md-ol">', '<li class="md-li">一</li>'])
  expect('任务列表(只读 checkbox)', render('- [x] 完成\n- [ ] 未完成'), [
    '<input type="checkbox" disabled checked',
    'md-task',
  ])

  const nested = render('- 父项\n  - 子项A\n  - 子项B')
  expect('嵌套列表', nested, ['父项', '子项A', '子项B'])
  check(
    '嵌套列表结构为 li 内嵌 ul',
    /<li class="md-li">父项\s*<ul class="md-ul">/.test(nested),
    nested.slice(0, 200),
  )

  expect('引用', render('> 引用内容'), ['<blockquote class="md-quote">', '引用内容'])
  expect('分割线', render('---'), ['<hr class="md-hr" />'])
  expect('链接', render('[站点](https://example.com)'), [
    '<a href="https://example.com"',
    '>站点</a>',
  ])
  expect('行内代码', render('`code`'), ['<code class="inline-code">code</code>'])
  expect('软换行→<br>', render('第一行\n第二行'), ['第一行<br>第二行'])

  const table = render(['| 名称 | 数量 |', '| :--- | ---: |', '| 甲 | 1 |'].join('\n'))
  expect('表格(含对齐)', table, [
    '<table class="md-table">',
    '<th class="md-th"',
    '<td class="md-td" style="text-align:right">1</td>',
  ])

  const nestedList = render('- 一\n  - 二\n    - 三')
  check(
    '三层嵌套不丢内容',
    ['一', '二', '三'].every((s) => nestedList.includes(s)),
  )
}

// ===================== 9. 转义保真(禁止二次解析) =====================
group('9. 转义保真')
{
  const escaped = render('\\*\\*不是粗体\\*\\*')
  expect('转义后的星号保持字面量(不得被二次解析成粗体)', escaped, ['**不是粗体**'], ['<strong>'])

  const codeFence = render(['```', '**粗体语法** 与 [^1] 与 ![图](a.png)', '```'].join('\n'))
  expect(
    '代码块内语法一律不解析',
    codeFence,
    ['**粗体语法**', '[^1]', '![图](a.png)'],
    ['<strong>', 'md-fn-ref', '<img'],
  )

  const inlineCode = render('`**not bold**`')
  expect('行内代码内不解析(星号保留为字面量)', inlineCode, ['**not bold**'], ['<strong>'])

  const inlineCodeEscape = render('`a\\*b` 与 `c_d_e` 与 `C:\\Users`')
  expect(
    '行内代码内不解析语法;历史转义按规则还原(标点还原、路径保留)',
    inlineCodeEscape,
    ['<code class="inline-code">a*b</code>', '<code class="inline-code">c_d_e</code>', 'C:\\Users'],
    ['<em>', '<strong>'],
  )
}

// ===================== 10. 内部标记与降级 =====================
group('10. 内部标记 / 健壮性')
{
  const internal = render('回答正文__AI_INTERNAL__: 图片1: a/b.png__AI_INTERNAL_END__结束')
  expect(
    '__AI_INTERNAL__ 标记被剥离',
    internal,
    ['回答正文', '结束'],
    ['__AI_INTERNAL__', 'a/b.png'],
  )

  check(
    'stripInternalMarkers 独立可用',
    stripInternalMarkers('a__AI_INTERNAL__:x__AI_INTERNAL_END__b') === 'ab',
  )

  check('空输入返回空串', render('') === '' && render('   ') === '')

  const longPara = render('A'.repeat(25000))
  check(
    '超长段落(>20000)不抛异常且内容完整',
    longPara.includes('A'.repeat(1000)) && longPara.includes('<p class="md-p">'),
    `长度 ${longPara.length}`,
  )

  const weird = render('<<<>>> &&& "quotes" \'single\'')
  expect('特殊字符整体转义', weird, ['&amp;'], ['<p class="md-p"><<<'])

  const crlf = render('第一行\r\n\r\n第二行')
  check('CRLF 归一化', crlf.includes('第一行') && crlf.includes('第二行'))
}

// ===================== 11. rawHtml 开关 =====================
group('11. rawHtml 开关')
{
  const off = render('<b>粗</b> 与 <u>下划线</u>', { rawHtml: false })
  expect('rawHtml=false 时剥离 HTML 标签', off, ['粗', '下划线'], ['<b>', '<u>'])

  const offFn = render(['引用[^k]', '', '[^k]: 定义文本'].join('\n'), { rawHtml: false })
  expect('rawHtml=false 时仍保留脚注锚点(否则脚注不可点)', offFn, ['md-fn-ref', '定义文本'])

  const on = render('<b>粗</b>')
  expect('rawHtml 默认开启', on, ['<b>粗</b>'])
}

// ===================== 12. 综合文档 =====================
group('12. 综合文档(端到端)')
{
  const doc = [
    '# 分析报告',
    '',
    '结论：==关键指标== 上升 x^2^ 个百分点，参见[^src]。',
    '',
    '## 数据',
    '',
    '| 项目 | 值 |',
    '| --- | ---: |',
    '| 收入 | $E=mc^2$ |',
    '',
    '- [x] 采集',
    '- [ ] 复核',
    '  - 明细子项',
    '',
    '> 引用一段说明',
    '',
    '```mermaid',
    'graph LR',
    'A-->B',
    '```',
    '',
    '![趋势图](assets/trend.png)',
    '',
    '[^src]: 数据来源说明',
  ].join('\n')
  const html = render(doc, { idPrefix: 'doc' })
  const musts = [
    '<h1 class="md-h md-h1">分析报告</h1>',
    '<mark class="md-highlight">关键指标</mark>',
    '<sup>2</sup>',
    'class="katex"',
    '<table class="md-table">',
    '<input type="checkbox" disabled checked',
    '<blockquote class="md-quote">',
    'class="language-mermaid"',
    'data-md-src="assets/trend.png"',
    'md-fn-ref',
    'md-footnotes',
    '数据来源说明',
  ]
  const missing = musts.filter((s) => !html.includes(s))
  check(
    '综合文档包含全部特性',
    missing.length === 0,
    missing.length ? `缺少 ${missing.join(', ')}` : '',
  )
  check('综合文档无未解析的原始语法残留', !html.includes('```') && !html.includes('[^src]:'))
}

// ===================== 13. 行内代码保护 =====================
group('13. 行内代码保护(AI 渲染层,不依赖共享解析器修复)')
{
  const md = '`**not bold**` 与 `a_b_c` 与 `x|y` 与 `$E=mc^2$` 与 `<b>t</b>`'
  const html = render(md)
  expect(
    '代码内容整体按字面量渲染',
    html,
    [
      '<code class="inline-code">**not bold**</code>',
      '<code class="inline-code">a_b_c</code>',
      '<code class="inline-code">x|y</code>',
      '<code class="inline-code">$E=mc^2$</code>',
      '<code class="inline-code">&lt;b&gt;t&lt;/b&gt;</code>',
    ],
    ['<strong>', '<em>', 'class="katex"', '<sub>', '<sup>'],
  )

  const esc = render('`a\\*b`')
  expect(
    '代码内 `\\*` 这类历史转义被还原为字面量(与编辑器一致)',
    esc,
    ['<code class="inline-code">a*b</code>'],
    ['<em>'],
  )

  // 各种块级上下文
  expect('标题里的行内代码', render('## 用 `**x**` 说明'), [
    '<h2 class="md-h md-h2">用 <code class="inline-code">**x**</code> 说明</h2>',
  ])
  expect('列表里的行内代码', render('- 项目 `a_b`'), ['<code class="inline-code">a_b</code>'])
  expect('引用里的行内代码', render('> 引用 `**y**`'), ['<code class="inline-code">**y**</code>'])
  expect('链接文字里的行内代码', render('[`a_b`](https://example.com)'), [
    '<code class="inline-code">a_b</code>',
    'href="https://example.com"',
  ])
  expect('强调内部的代码片段', render('*斜体 `**x**` 结束*'), [
    '<code class="inline-code">**x**</code>',
    '<em>',
  ])
  expect('脚注定义里的行内代码', render(['引用[^c]', '', '[^c]: 定义 `a_b`'].join('\n')), [
    '<code class="inline-code">a_b</code>',
    'md-footnotes',
  ])

  // 表格:代码里的 | 不应切开单元格
  const table = render(['| 列 | 值 |', '| --- | --- |', '| `a|b` | 1 |'].join('\n'))
  expect('表格单元格里的代码含 | 不切分单元格', table, [
    '<code class="inline-code">a|b</code>',
    '<td class="md-td">1</td>',
  ])
  check(
    '表格列数正确(2 列,不是 3 列)',
    (table.match(/<th class="md-th"/g) ?? []).length === 2,
    table,
  )

  // 不应越界处理
  const fence = render(['```', '用 `code` 举例', '```'].join('\n'))
  expect(
    '围栏代码块内不做行内代码替换',
    fence,
    ['用 `code` 举例'],
    ['<code class="inline-code">code</code>'],
  )

  // 缩进代码块:必须整体落到 <pre> 里,且内容原样(不被行内代码替换)
  const indented = render(['普通段落', '', '    indented `code` here'].join('\n'))
  expect(
    '缩进代码块内不做行内代码替换',
    indented,
    ['<pre class="md-pre"><code class="language-plaintext">indented `code` here</code></pre>'],
    ['<code class="inline-code">'],
  )

  // 占位符碰撞:正文里出现同形 token(哨兵被剔除后剩 "UDC0")不能被当成占位符
  const collide = render('正文 \uE000UDC0\uE000 与 `真代码`')
  check(
    '哨兵字符不可被正文伪造(只剩一个真 code 元素)',
    (collide.match(/<code class="inline-code">/g) ?? []).length === 1 &&
      collide.includes('正文 UDC0 与'),
    collide,
  )

  // 未闭合反引号保持字面量
  const unclosed = render('这里有 `未闭合 的反引号')
  check('未闭合反引号不吞内容', unclosed.includes('未闭合'), unclosed)
}

// ===================== 14. code span 修复(解析器 + 序列化器 + 存量兼容) =====================
group('14. code span 修复(共享解析器/序列化器)')
{
  const renderEditor = (md: string) =>
    deserializeMarkdown(md)
      .map((b) => {
        const c = b.content as { text?: string; marks?: Mark[] }
        return marksToHtml(c.text ?? '', c.marks ?? [])
      })
      .join('|')

  // ---- 解析:内容按字面量,只产生 code 一个 mark ----
  const p1 = parseInlineMarkdown('`**not bold**`')
  check(
    'code span 只产生一个 code mark(无同区间嵌套)',
    p1.marks.length === 1 && p1.marks[0]?.type === 'code',
    JSON.stringify(p1.marks),
  )
  check('code span 文本保留字面语法', p1.text === '**not bold**', JSON.stringify(p1.text))

  // 兼容旧行为:旧解析器会吃掉 code 内的转义,这里保持一致(否则升级后渲染会变)
  const p2 = parseInlineMarkdown('`a\\*b`')
  check('code 内的历史转义被还原(与升级前渲染一致)', p2.text === 'a*b', JSON.stringify(p2.text))

  // ---- 不误伤:反斜杠 + 字母/数字/空白从未被旧序列化器转义,必须原样保留 ----
  const pPath = parseInlineMarkdown('`C:\\Users\\qiao`')
  check('Windows 路径不被改动', pPath.text === 'C:\\Users\\qiao', JSON.stringify(pPath.text))
  const pRe = parseInlineMarkdown('`\\d+\\s*`')
  check('正则 \\d / \\s 不被改动', pRe.text === '\\d+\\s*', JSON.stringify(pRe.text))

  // ---- 渲染:代码里不再出现粗体 ----
  const html = renderBubbleMarkdown('代码 `**x**` 与 `a_b` 与 `arr[0]`')
  expect(
    '代码内容按字面量渲染,不产生粗体',
    html,
    [
      '<code class="inline-code">**x**</code>',
      '<code class="inline-code">a_b</code>',
      '<code class="inline-code">arr[0]</code>',
    ],
    ['<strong>', '<em>'],
  )

  // ---- 序列化:不再往 code span 里写转义 ----
  const src = '段落 `a_b` 与 `arr[0]` 与 `if (x) < y` 与 `**kw` 结尾'
  const saved = serializeMarkdown(deserializeMarkdown(src))
  expect(
    '保存后 code span 内不再出现多余转义',
    saved,
    ['`a_b`', '`arr[0]`', '`if (x) < y`', '`**kw`'],
    ['`a\\_b`', '`arr\\[0\\]`'],
  )

  // ---- 幂等 + 渲染等价 ----
  const twice = serializeMarkdown(deserializeMarkdown(saved))
  check(
    '保存→重开→再保存 幂等',
    saved === twice,
    `\n    一次: ${JSON.stringify(saved)}\n    二次: ${JSON.stringify(twice)}`,
  )
  check('打开→保存→重开 AI 渲染一致', renderBubbleMarkdown(src) === renderBubbleMarkdown(saved))
  check(
    '打开→保存→重开 编辑器渲染(marksToHtml)一致',
    renderEditor(src) === renderEditor(saved),
    `${renderEditor(src)} ≠ ${renderEditor(saved)}`,
  )

  // ---- 存量文件兼容:旧版本写出的 `\_`、`\[`、`\-` ----
  const legacy = '段落 `a\\_b` 与 `arr\\[0\\]` 结尾'
  const repaired = serializeMarkdown(deserializeMarkdown(legacy))
  expect('存量转义污染被修复并收敛', repaired, ['`a_b`', '`arr[0]`'], ['\\_', '\\['])
  check(
    '存量文件渲染 == 修复后渲染',
    renderBubbleMarkdown(legacy) === renderBubbleMarkdown(repaired),
  )

  const legacyHead = '`\\-v` 开启详细模式'
  const repairedHead = serializeMarkdown(deserializeMarkdown(legacyHead))
  expect('块首代码的历史转义被修复', repairedHead, ['`-v`'], ['`\\-v`'])

  // ---- 表格:escapeTableCell 加的 `\|` 仍能往返 ----
  const tbl = ['| 列 | 说明 |', '| --- | --- |', '| `a\\|b` | 管道符 |'].join('\n')
  const tblSaved = serializeMarkdown(deserializeMarkdown(tbl))
  check(
    '表格内 code 的转义管道往返稳定',
    tblSaved === serializeMarkdown(deserializeMarkdown(tblSaved)),
    JSON.stringify(tblSaved),
  )
  check(
    '表格内 code 渲染为原始管道符',
    renderBubbleMarkdown(tbl).includes('>a|b<'),
    renderBubbleMarkdown(tbl),
  )

  // ---- 编辑态契约:未编辑的块不得被重新解析 ----
  const pe = parseInlineMarkdown('`a_b`')
  const source = marksToSource(pe.text, pe.marks)
  check('marksToSource 还原为源码', source === '`a_b`', JSON.stringify(source))
  check('sameAsSource:未编辑判定为等价', sameAsSource(source, pe.text, pe.marks) === true)
  check('sameAsSource:有改动判定为不等价', sameAsSource('`a_c`', pe.text, pe.marks) === false)

  // ---- 不误伤:code 之外的转义与语法仍然正常 ----
  const outside = parseInlineMarkdown('\\*不是斜体\\* 与 **粗** 与 `码`')
  check(
    'code 之外的转义/语法不受影响',
    outside.text === '*不是斜体* 与 粗 与 码' &&
      outside.marks.some((m) => m.type === 'bold') &&
      outside.marks.some((m) => m.type === 'code') &&
      !outside.marks.some((m) => m.type === 'italic'),
    JSON.stringify(outside),
  )

  // ---- 综合文档往返(混合内容,模拟真实文档) ----
  const doc = [
    '# 标题 `a_b` 与 \\*字面星号\\*',
    '',
    '段落含 `arr[0]`、`if (x) < y`、`**字面**` 与 `C:\\Users\\me`。',
    '',
    '- 列表项 `snake_case`',
    '- 另一项 `a\\|b`',
    '',
    '| 列 | 值 |',
    '| --- | --- |',
    '| `p\\|q` | 1 |',
    '',
    '> 引用里的 `**y**` 与 \\# 非标题',
  ].join('\n')
  const d1 = serializeMarkdown(deserializeMarkdown(doc))
  const d2 = serializeMarkdown(deserializeMarkdown(d1))
  check(
    '综合文档往返幂等',
    d1 === d2,
    `\n    一次: ${JSON.stringify(d1)}\n    二次: ${JSON.stringify(d2)}`,
  )
  check('综合文档渲染稳定', renderBubbleMarkdown(doc) === renderBubbleMarkdown(d1))
  check(
    '综合文档中代码未被转义污染',
    d1.includes('`a_b`') && d1.includes('`arr[0]`') && !d1.includes('\\_'),
    JSON.stringify(d1),
  )
  check('综合文档中转义星号仍为字面量', renderEditor(d1).includes('*字面星号*'), renderEditor(d1))
}

// ===================== 15. 往返稳定性(转义/折叠对称性) =====================
group('15. 往返稳定性(每次保存都不该增长)')
{
  /** 连续 n 轮「序列化 → 反序列化」 */
  const cycles = (md: string, n = 4): string[] => {
    const out = [md]
    let cur = md
    for (let i = 0; i < n; i++) {
      cur = serializeMarkdown(deserializeMarkdown(cur))
      out.push(cur)
    }
    return out
  }
  /** 第 2 轮起是否恒等(允许第 1 轮做一次性归一化) */
  const stable = (md: string) => {
    const s = cycles(md)
    return s[1] === s[2] && s[2] === s[3] && s[3] === s[4]
  }

  // ---- M2:序列化器能写出的转义,解析器必须都能还原(集合对称) ----
  const escapable = [...new Set((INLINE_ESCAPABLE_CHARS + INLINE_SYNTAX_CHARS).split(''))]
  const positions: Array<[string, (c: string) => string]> = [
    ['行中', (c) => `a${c}b`],
    ['块首', (c) => `${c}b`],
  ]
  for (const [label, make] of positions) {
    const bad = escapable.filter((c) => !stable(make(c)))
    check(
      `逐字符往返稳定(${label}位置)`,
      bad.length === 0,
      `不稳定字符: ${JSON.stringify(bad.join(''))}`,
    )
  }

  // ---- M1:表格单元格里的反斜杠不该被"双重转义" ----
  const t1 = '| a | b |\n| --- | --- |\n| Tauri v2 (Rust) | x |'
  check(
    '表格:单元格含括号往返稳定',
    stable(t1),
    cycles(t1)
      .map((s) => s.length)
      .join(' → '),
  )
  // 文件里出现单层 `\(` 是按设计的转义;要保证的是"渲染出来干净、且不逐轮累积"
  check(
    '表格:括号内容渲染无多余反斜杠',
    renderBubbleMarkdown(cycles(t1)[4]).includes('Tauri v2 (Rust)') &&
      !renderBubbleMarkdown(cycles(t1)[4]).includes('\\('),
    renderBubbleMarkdown(cycles(t1)[4]),
  )

  const t2 = '| a | b |\n| --- | --- |\n| $\\frac{1}{2}$ | x |'
  check(
    '表格:公式源码 4 轮不被破坏',
    stable(t2) && cycles(t2)[4].includes('$\\frac{1}{2}$'),
    JSON.stringify(cycles(t2)[4]),
  )

  const t3 = '| a | b |\n| --- | --- |\n| `a\\b` | x |'
  check(
    '表格:代码内单个反斜杠不被翻倍',
    stable(t3) && cycles(t3)[4].includes('`a\\b`'),
    JSON.stringify(cycles(t3)[4]),
  )

  const t4 = '| a | b |\n| --- | --- |\n| `a\\|b` | x |'
  check(
    '表格:代码内的管道符转义往返稳定',
    stable(t4) && cycles(t4)[4].includes('`a\\|b`'),
    JSON.stringify(cycles(t4)[4]),
  )

  const t5 = '| a | b |\n| --- | --- |\n| a\\|b | x |'
  check(
    '表格:纯文本管道符往返稳定',
    stable(t5) && cycles(t5)[4].includes('a\\|b'),
    JSON.stringify(cycles(t5)[4]),
  )

  // ---- M3:HTML 块段落不该累加行尾空格 ----
  const htmlBlock = '<p align="center">\n  Made with love 2026\n</p>'
  check(
    'HTML 块段落 4 轮稳定',
    stable(htmlBlock),
    cycles(htmlBlock)
      .map((s) => s.length)
      .join(' → '),
  )
  check(
    'HTML 块段落无多余行尾空格',
    !/ {4,}\n/.test(cycles(htmlBlock)[4]),
    JSON.stringify(cycles(htmlBlock)[4]),
  )

  // ---- 真实文档:允许一次性归一化,但此后必须恒等 ----
  let readmeBody = ''
  try {
    readmeBody = parseFrontmatter(readFileSync('README.md', 'utf8')).body
  } catch {
    readmeBody = ''
  }
  if (readmeBody) {
    const s = cycles(readmeBody)
    check(
      '真实文档:第 2 轮起恒等(无累积增长)',
      s[1] === s[2] && s[2] === s[3] && s[3] === s[4],
      s.map((x) => x.length).join(' → '),
    )
    check('真实文档:4 轮内不再变长', s[4].length <= s[1].length, s.map((x) => x.length).join(' → '))
  } else {
    console.log('  (跳过真实文档检查:未读到 README.md,请在仓库根目录运行)')
  }
}

// ===================== 16. 测试文档集(测试/*.md) =====================
group('16. 测试文档集(测试/*.md)')
{
  let files: string[] = []
  try {
    files = readdirSync('测试')
      .filter((f) => f.endsWith('.md') && statSync(join('测试', f)).isFile())
      .sort()
  } catch {
    files = []
  }
  if (!files.length) {
    console.log('  (跳过:未找到 测试/ 目录,请在仓库根目录运行)')
  }
  for (const f of files) {
    const raw = readFileSync(join('测试', f), 'utf8')
    const { body } = parseFrontmatter(raw)

    // 渲染不得抛异常(用例里故意包含非法公式/非法 Mermaid/危险 HTML)
    let html = ''
    let err = ''
    try {
      html = renderBubbleMarkdown(raw, { idPrefix: `fixture-${f}` })
    } catch (e) {
      err = String(e)
    }
    check(`${f}: 渲染不抛异常且有输出`, !err && html.length > 0, err || `输出 ${html.length} 字符`)
    // 哨兵只看"真正的可执行形态":标签起始 / 事件属性 / javascript: 协议属性。
    // 先剔除 <code>…</code>:代码块里出现的 `<script>`、`onerror=` 是转义后的纯文本,无害。
    const withoutCode = html.replace(/<code[\s\S]*?<\/code>/g, '')
    const suspicious =
      /<\s*(script|iframe|object|embed)\b/i.test(withoutCode) ||
      /\son\w+\s*=/i.test(withoutCode) ||
      /\s(href|src)\s*=\s*["']\s*javascript:/i.test(withoutCode)
    check(`${f}: 渲染结果不含可执行内容`, !suspicious, withoutCode.slice(0, 200))

    // 往返稳定:必须**收敛且不再变大**。
    // 不用"第 2 轮就恒等":用例文件在手工验收时会被编辑器保存,历史转义(如 `\(`)需要
    // 1~2 轮才被还原到规范形态 —— 这是有意的兼容行为,只要不逐轮膨胀即可。
    const cyc = [body]
    let cur = body
    for (let i = 0; i < 4; i++) {
      cur = serializeMarkdown(deserializeMarkdown(cur))
      cyc.push(cur)
    }
    check(
      `${f}: 4 轮往返收敛且不增长`,
      cyc[3] === cyc[4] && cyc[4].length <= cyc[1].length,
      cyc.map((s) => s.length).join(' → '),
    )
  }
}

// ===================== 17. 表格识别(GFM 兼容) =====================
group('17. 表格识别(GFM 兼容)')
{
  /** 取第一个 table block 的 content(找不到返回 undefined) */
  const tableContent = (md: string): any => {
    const table = deserializeMarkdown(md).find((b) => b.type === 'table')
    return table?.content
  }
  const cells = (row: any[]): string => row.map((c) => c.text).join('|')
  const normalize = (md: string): [string, string] => {
    const first = serializeMarkdown(deserializeMarkdown(md))
    const second = serializeMarkdown(deserializeMarkdown(first))
    return [first, second]
  }

  // 本次回归的原始样本:分隔行首列只有一个 `-`(截图那份学习计划文档)
  const screenshot = [
    '| # | 目标 | 落位 | 日耗时 |',
    '| - | -------- | ------------------------------------ | -------- |',
    '| 1 | 英语大量阅读 | 课堂隐藏阅读 + 晚自习② | 60min+ |',
    '| 2 | 词汇汇总 | 体育课(周一移至晚间) | 15min |',
  ].join('\n')

  const shot = tableContent(screenshot)
  check(
    '单横线分隔行识别为表格',
    !!shot && cells(shot.headers) === '#|目标|落位|日耗时',
    JSON.stringify(shot?.headers),
  )
  check(
    '单横线表格数据行完整',
    !!shot &&
      shot.rows.length === 2 &&
      cells(shot.rows[1]) === '2|词汇汇总|体育课(周一移至晚间)|15min',
    JSON.stringify(shot?.rows),
  )

  // 其他 GFM 合法写法(此前全部退化成带 | 的段落)
  check('双横线分隔行', !!tableContent('| a | b |\n| -- | -- |\n| 1 | 2 |'))
  check('无首尾竖线', !!tableContent('a | b\n--- | ---\n1 | 2'))
  check('首尾竖线不一致', !!tableContent('| a | b |\n| --- | --- |\n1 | 2'))
  check('单列表格', !!tableContent('| only |\n| --- |\n| 1 |'))

  const aligned = tableContent('| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |')
  check(
    '对齐方式(:- / :-: / -:)',
    !!aligned && aligned.aligns.join(',') === 'left,center,right',
    JSON.stringify(aligned?.aligns),
  )

  // GFM:表格可以打断段落
  const interrupted = deserializeMarkdown('计划如下:\n| a | b |\n| --- | --- |\n| 1 | 2 |')
  check(
    '表格可打断段落',
    interrupted.some((b) => b.type === 'paragraph') && interrupted.some((b) => b.type === 'table'),
    interrupted.map((b) => b.type).join(','),
  )

  // 容器内表格
  const inList = deserializeMarkdown('- 说明\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |')
  const listBlock = inList.find((b) => b.type === 'list') as any
  check(
    '列表项内表格',
    !!listBlock && !!listBlock.content.items[0].children?.some((c: any) => c.type === 'table'),
    JSON.stringify(inList.map((b) => b.type)),
  )
  const inQuote = deserializeMarkdown('> | a | b |\n> | --- | --- |\n> | 1 | 2 |')
  const quoteBlock = inQuote.find((b) => b.type === 'quote') as any
  check(
    '引用内表格',
    !!quoteBlock && !!quoteBlock.content.blocks?.some((c: any) => c.type === 'table'),
    JSON.stringify(inQuote.map((b) => b.type)),
  )

  // 单元格转义:行内 `\|` 还原为字面管道
  const escaped = tableContent('| a | b |\n| --- | --- |\n| x \\| y | 2 |')
  check(
    '单元格内 \\| 还原为字面管道',
    !!escaped && escaped.rows[0][0].text === 'x | y',
    JSON.stringify(escaped?.rows?.[0]),
  )

  // GFM 行列数规则:多出的列截断、缺少的列补空
  check(
    '数据行多出的列被截断',
    tableContent('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |')?.rows[0].length === 2,
  )
  const padded = tableContent('| a | b |\n| --- | --- |\n| 1 |')
  check(
    '数据行缺少的列补空',
    !!padded && padded.rows[0].length === 2 && padded.rows[0][1].text === '',
    JSON.stringify(padded?.rows),
  )

  // 渲染层(编辑器与 AI 气泡共用 deserializeMarkdown)
  expect('AI 气泡渲染单横线表格', render(screenshot), [
    '<table class="md-table">',
    '<th class="md-th">#</th>',
    '60min+',
  ])

  // 落盘归一化:非标准写法首次保存变为标准 GFM,之后往返稳定
  const [shot1, shot2] = normalize(screenshot)
  check(
    '单横线表格保存后归一化为标准 GFM',
    /^\| # \| 目标 \| 落位 \| 日耗时 \|$/m.test(shot1) &&
      /\| :--- \| :--- \| :--- \| :--- \|/.test(shot1),
    JSON.stringify(shot1),
  )
  check('归一化后往返稳定', shot1 === shot2, JSON.stringify(shot2))

  // 旧启发式兜底仍然生效(GFM 认为列数不一致不是表格,历史文件继续按表格显示)
  const mismatchMd = '| a | b |\n| --- |\n| 1 | 2 |'
  const mismatch = tableContent(mismatchMd)
  check('列数不一致的历史写法仍按表格兜底', !!mismatch && mismatch.headers.length === 2)
  const [, mismatch2] = normalize(mismatchMd)
  const mismatch3 = serializeMarkdown(deserializeMarkdown(mismatch2))
  check('兜底表格往返收敛', mismatch2 === mismatch3, JSON.stringify(mismatch3))

  // 手工验收文件里的 9 张非标准写法表格必须全部解析成 table(含列表/引用内的嵌套表)
  const countTables = (blocks: any[]): number =>
    blocks.reduce((sum, b) => {
      if (b.type === 'table') return sum + 1
      const nested =
        b.type === 'list'
          ? (b.content.items ?? []).flatMap((item: any) => item.children ?? [])
          : b.type === 'quote'
            ? (b.content.blocks ?? [])
            : []
      return sum + countTables(nested)
    }, 0)
  const fixtureTables = countTables(
    deserializeMarkdown(parseFrontmatter(readFileSync('测试/06-表格导入兼容性.md', 'utf8')).body),
  )
  check('手工用例 06 的 9 张非标准表格全部识别', fixtureTables === 9, String(fixtureTables))

  // 流式渲染器(AI 回复进行中)也要认单横线/单列表格
  const streamed = renderStreaming('| # | 目标 |\n| - | --- |\n| 1 | 英语 |')
  check(
    '流式渲染器:单横线表格',
    streamed.includes('<table class="md-table">') && streamed.includes('英语'),
    streamed.slice(0, 200),
  )
  const streamedSingle = renderStreaming('| only |\n| --- |\n| 1 |')
  check(
    '流式渲染器:单列表格',
    streamedSingle.includes('<table class="md-table">'),
    streamedSingle.slice(0, 200),
  )
  // 分隔行不含 | 的裸 `---` 必须仍按分割线处理,不能被误判成单列表格
  check(
    '流式渲染器:裸 --- 仍是分割线',
    renderStreaming('a | b\n---').includes('<hr class="md-hr">'),
    renderStreaming('a | b\n---').slice(0, 200),
  )
}

// ===================== 18. AI 记忆纯函数 =====================
group('18. AI 记忆纯函数')
{
  const NOW = 1_760_000_000_000
  const DAY = 86_400_000
  let factSeq = 0

  const makeFact = (partial: Partial<MemoryFact> = {}): MemoryFact => {
    factSeq++
    return {
      id: `f${factSeq}`,
      category: 'knowledge',
      content: `记忆条目 ${factSeq}`,
      tags: [],
      source: 'agent',
      createdAt: NOW,
      lastAccessedAt: NOW,
      accessCount: 0,
      confidence: 1,
      importance: 0.5,
      updatedAt: NOW,
      pinned: false,
      enabled: true,
      origin: 'agent',
      ...partial,
    }
  }
  const throws = (fn: () => unknown): boolean => {
    try {
      fn()
      return false
    } catch {
      return true
    }
  }

  // ---- 分词 ----
  const tokensCn = tokenizeQuery('我喜欢用Vue写代码')
  check('中文 tokenize 生成 bigram', tokensCn.includes('喜欢') && tokensCn.includes('代码'))
  check('中英混合 tokenize 保留英文词', tokensCn.includes('vue'))
  check('空查询返回空分词', tokenizeQuery('   ').length === 0)
  check('重复关键词去重', tokenizeQuery('vue vue').length === 1)

  // ---- 检索排序 ----
  const vueFact = makeFact({
    id: 'vue-fact',
    content: '我用 Vue 写前端代码',
    tags: ['Vue'],
    importance: 0.4,
  })
  const reactFact = makeFact({
    id: 'react-fact',
    content: '我用 React 写前端代码',
    tags: ['React'],
    importance: 0.4,
  })
  const cityFact = makeFact({ id: 'city-fact', content: '我住在北京', importance: 0.9 })
  const ranked = rankFacts([reactFact, cityFact, vueFact], '推荐一下 Vue 的写法', NOW)
  check('关键词命中优先于高重要度无关项', ranked[0]?.id === 'vue-fact')
  check('空查询按重要度排序', rankFacts([vueFact, cityFact], '', NOW)[0]?.id === 'city-fact')
  check(
    'maxResults 限制条数',
    rankFacts([vueFact, reactFact, cityFact], '', NOW, { maxResults: 2 }).length === 2,
  )

  const projectFact = makeFact({
    id: 'project-fact',
    content: '我的项目叫 Alpha，是一个文档编辑器',
    tags: ['项目'],
  })
  const weatherFact = makeFact({ id: 'weather-fact', content: '今天天气不错' })
  const rankedCn = rankFacts([weatherFact, projectFact], '项目 Alpha 的最新进展如何', NOW)
  check('中文查询通过 bigram 召回相关记忆', rankedCn[0]?.id === 'project-fact')

  const pinnedFact = makeFact({
    id: 'pinned-fact',
    content: '与查询无关的置顶记忆',
    importance: 0,
    pinned: true,
  })
  check(
    '置顶记忆在无关查询中仍排前',
    rankFacts([weatherFact, pinnedFact], '完全无关 abc', NOW)[0]?.id === 'pinned-fact',
  )

  const disabledFact = makeFact({
    id: 'disabled-fact',
    content: 'Vue 被停用的记忆',
    enabled: false,
  })
  check(
    '停用记忆不参与检索',
    !rankFacts([disabledFact, vueFact], 'Vue', NOW).some((fact) => fact.id === 'disabled-fact'),
  )

  // ---- 迁移与校验 ----
  const migrated = normalizeMemory(
    {
      version: 1,
      profile: { name: '乔一峰' },
      facts: [
        {
          id: 'legacy-1',
          category: 'personal',
          content: '我叫乔一峰',
          tags: ['姓名'],
          source: 'auto-extract',
          createdAt: NOW - 1000,
        },
      ],
      updatedAt: NOW,
    },
    { now: NOW, idFactory: () => 'gen-1' },
  )
  const migratedFact = migrated.memory.facts[0]
  check('v1 迁移到 v2 并补齐设置默认值', migrated.migrated && migrated.memory.version === 2)
  check(
    '迁移补齐设置默认值',
    migrated.memory.settings.enabled === true &&
      migrated.memory.settings.autoExtract === true &&
      migrated.memory.settings.maxInjectFacts === 5 &&
      migrated.memory.settings.maxFactChars === 500 &&
      migrated.memory.settings.autoCleanup === true,
  )
  check(
    '迁移补齐事实新字段',
    migratedFact.updatedAt === NOW - 1000 && migratedFact.enabled === true,
  )
  check('迁移保留来源语义', migratedFact.origin === 'auto-extract')
  check('画像在迁移中保留', migrated.memory.profile.name === '乔一峰')

  const v2Data = normalizeMemory({ version: 2, facts: [] }, { now: NOW })
  check('v2 数据不标记迁移', v2Data.migrated === false && v2Data.memory.version === 2)

  const droppedFact = normalizeMemory(
    { version: 1, facts: [{ content: '' }, { content: '有效记忆' }] },
    { now: NOW },
  )
  check('丢弃空内容事实', droppedFact.memory.facts.length === 1 && droppedFact.dropped === 1)

  let idSeq = 0
  const duplicateIds = normalizeMemory(
    {
      version: 1,
      facts: [
        { id: 'dup', content: '第一条' },
        { id: 'dup', content: '第二条' },
      ],
    },
    { now: NOW, idFactory: () => `gen-${++idSeq}` },
  )
  check(
    '重复 id 被重新生成',
    duplicateIds.memory.facts[0].id === 'dup' && duplicateIds.memory.facts[1].id === 'gen-1',
  )

  const extraField = normalizeMemory(
    { version: 1, facts: [{ id: 'e1', content: '带扩展字段', extraField: 'keep-me' }] },
    { now: NOW },
  )
  check(
    '迁移保留未知字段',
    (extraField.memory.facts[0] as unknown as Record<string, unknown>).extraField === 'keep-me',
  )

  const clamped = normalizeMemory(
    {
      version: 2,
      facts: [],
      settings: { enabled: 'no', maxInjectFacts: 99, maxFactChars: 5 },
    },
    { now: NOW },
  )
  check(
    '设置越界值被收敛',
    clamped.memory.settings.enabled === true &&
      clamped.memory.settings.maxInjectFacts === 10 &&
      clamped.memory.settings.maxFactChars === 100,
  )
  check(
    '非法记忆数据抛错',
    throws(() => normalizeMemory(null)),
  )

  // ---- 清理 ----
  const oldLow = makeFact({
    id: 'old-low',
    createdAt: NOW - 400 * DAY,
    lastAccessedAt: NOW - 400 * DAY,
    importance: 0.1,
  })
  const oldPinned = makeFact({
    id: 'old-pinned',
    createdAt: NOW - 400 * DAY,
    lastAccessedAt: NOW - 400 * DAY,
    importance: 0.1,
    pinned: true,
  })
  const stale = makeFact({
    id: 'stale',
    createdAt: NOW - 10 * DAY,
    lastAccessedAt: NOW - 200 * DAY,
    importance: 0.1,
  })
  const fresh = makeFact({
    id: 'fresh',
    createdAt: NOW - 2 * DAY,
    lastAccessedAt: NOW - 2 * DAY,
    importance: 0.6,
  })
  const cleanupResult = cleanupFacts([oldLow, oldPinned, stale, fresh], NOW, MAX_FACTS)
  check(
    '清理删除长期未用的低价值记忆',
    cleanupResult.removed.some((fact) => fact.id === 'old-low'),
  )
  check(
    '清理不删除置顶记忆',
    cleanupResult.kept.some((fact) => fact.id === 'old-pinned'),
  )
  check(
    '清理删除长期未访问的低重要度记忆',
    cleanupResult.removed.some((fact) => fact.id === 'stale'),
  )
  check(
    '清理保留近期记忆',
    cleanupResult.kept.some((fact) => fact.id === 'fresh'),
  )

  const many = Array.from({ length: MAX_FACTS + 5 }, (_, index) =>
    makeFact({ id: `many-${index}`, content: `容量测试 ${index}` }),
  )
  many[0] = { ...many[0], pinned: true, importance: 0.001 }
  const trimmed = cleanupFacts(many, NOW, MAX_FACTS)
  check('超出容量时淘汰非置顶项', trimmed.kept.length === MAX_FACTS && trimmed.removed.length === 5)
  check(
    '容量淘汰保护置顶项',
    trimmed.kept.some((fact) => fact.id === 'many-0'),
  )

  const evicted = evictOverflow(
    [
      makeFact({ id: 'low', importance: 0.1 }),
      makeFact({ id: 'mid', importance: 0.5 }),
      makeFact({ id: 'high', importance: 0.9 }),
    ],
    2,
    NOW,
  )
  check(
    '容量淘汰移除最低价值项',
    evicted.removed.length === 1 && evicted.removed[0].id === 'low' && evicted.kept.length === 2,
  )
  const evictedPinned = evictOverflow(
    [
      makeFact({ id: 'pinned-low', importance: 0.01, pinned: true }),
      makeFact({ id: 'mid2', importance: 0.5 }),
      makeFact({ id: 'high2', importance: 0.9 }),
    ],
    2,
    NOW,
  )
  check(
    '容量淘汰不删除置顶项',
    evictedPinned.kept.some((fact) => fact.id === 'pinned-low'),
  )

  // ---- 去重与合并 ----
  const dupA = makeFact({
    id: 'dup-a',
    content: '我喜欢用 Vue 写代码',
    tags: ['vue'],
    importance: 0.4,
    accessCount: 2,
    createdAt: NOW - 2000,
    updatedAt: NOW - 2000,
    lastAccessedAt: NOW - 1000,
  })
  const dupB = makeFact({
    id: 'dup-b',
    content: '我喜欢用Vue写代码，常用 Vue3',
    tags: ['前端'],
    importance: 0.8,
    accessCount: 3,
    createdAt: NOW - 3000,
    updatedAt: NOW - 100,
    lastAccessedAt: NOW - 500,
    pinned: true,
    source: 'manual',
    origin: 'manual',
  })
  const otherFact = makeFact({ id: 'other-fact', content: '我住在北京' })
  check(
    '相同/包含文本被判为重复',
    findDuplicateOf([dupA, otherFact], '我喜欢用Vue写代码!')?.id === 'dup-a',
  )
  check('不相关内容不判重复', findDuplicateOf([otherFact], '你喜欢什么') === null)
  check('文本规范化去除空格标点', normalizeFactText('喜欢 Vue!') === normalizeFactText('喜欢vue'))
  const dupGroups = findDuplicateGroups([dupA, dupB, otherFact])
  check('重复分组检测', dupGroups.length === 1 && dupGroups[0].duplicateIds.length === 1)
  const merged = mergeFactGroup([dupA, dupB])
  check('合并保留信息最全内容', merged.content === dupB.content)
  check('合并标签取并集', merged.tags.includes('vue') && merged.tags.includes('前端'))
  check('合并重要度取最大', merged.importance === 0.8)
  check('合并访问次数求和', merged.accessCount === 5)
  check('合并置顶与来源优先级', merged.pinned === true && merged.origin === 'manual')
  check('合并创建时间取最早', merged.createdAt === NOW - 3000)

  // ---- 导入导出 ----
  const baseMemory = normalizeMemory(
    {
      version: 1,
      profile: { name: '测试' },
      facts: [
        {
          id: 'x',
          category: 'preference',
          content: '喜欢Vue',
          tags: ['vue'],
          createdAt: NOW - 10,
          source: 'agent',
        },
      ],
    },
    { now: NOW, idFactory: () => 'gen-x' },
  ).memory
  const envelope = createMemoryExport(baseMemory, NOW)
  const parsedEnvelope = parseMemoryExport(JSON.parse(JSON.stringify(envelope)), { now: NOW })
  check('导出信封格式正确', envelope.format === 'unidoc-ai-memory' && envelope.formatVersion === 1)
  check(
    '导出/导入往返保持内容',
    parsedEnvelope.wasEnvelope &&
      parsedEnvelope.memory.facts.length === 1 &&
      parsedEnvelope.memory.facts[0].content === '喜欢Vue',
  )
  check(
    '兼容直接导出的记忆 JSON',
    parseMemoryExport(baseMemory, { now: NOW }).wasEnvelope === false,
  )
  check(
    '拒绝未来格式版本',
    throws(() =>
      parseMemoryExport({ format: 'unidoc-ai-memory', formatVersion: 99, memory: baseMemory }),
    ),
  )
  check(
    '拒绝其他格式',
    throws(() => parseMemoryExport({ format: 'other', formatVersion: 1, memory: baseMemory })),
  )
  check(
    '拒绝非法导入数据',
    throws(() => parseMemoryExport(null)),
  )

  // ---- 启发式抽取 ----
  const extName = extractHeuristicCandidates(['我叫小明，是一名设计师'])
  check('画像提取姓名', extName.profile?.name === '小明')
  check('「我是学生」不再误抽为姓名', extractHeuristicCandidates(['我是学生']).profile === null)
  const extPref = extractHeuristicCandidates(['我喜欢用 Vue 写代码'])
  check(
    '偏好候选提取',
    extPref.candidates.some(
      (candidate) => candidate.category === 'preference' && candidate.content.includes('Vue'),
    ),
  )
  const extProject = extractHeuristicCandidates(['我的项目是 Alpha'])
  check(
    '项目候选提取',
    extProject.candidates.some(
      (candidate) => candidate.category === 'project' && candidate.content.includes('Alpha'),
    ),
  )
  check('无用户消息时不产生候选', extractHeuristicCandidates([]).candidates.length === 0)
  check(
    '候选事实长度受限',
    extractHeuristicCandidates(['我喜欢用'.concat('很长'.repeat(300))]).candidates.every(
      (candidate) => candidate.content.length <= 500,
    ),
  )
}

// ===================== 汇总 =====================
console.log(`\n${'='.repeat(60)}`)
console.log(`通过 ${passed} 项,失败 ${failures.length} 项`)
if (failures.length) {
  console.log('\n失败清单:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
