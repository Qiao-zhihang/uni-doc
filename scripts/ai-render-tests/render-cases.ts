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

// ===================== 汇总 =====================
console.log(`\n${'='.repeat(60)}`)
console.log(`通过 ${passed} 项,失败 ${failures.length} 项`)
if (failures.length) {
  console.log('\n失败清单:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
