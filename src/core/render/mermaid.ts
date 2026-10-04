/**
 * Mermaid 渲染 helper(编辑器 CodeBlock 与 AI 气泡共用)
 *
 * - 静态 import:与 CodeBlock 落在同一 chunk,不额外增大体积
 * - 每次渲染前 initialize:允许不同调用方使用不同主题/安全级别
 *   (编辑器用 antiscript:标签仍按 HTML 渲染以兼容既有图表,但会过 DOMPurify;
 *    AI 气泡用 strict:回复内容来自不可信模型输出)
 * - 默认安全级别为 strict:调用方忘传 securityLevel 时也不该退到最宽松的档位
 * - 串行队列:mermaid.initialize 是**全局状态**,而 render 是异步的。
 *   若两个调用方并发渲染(如"编辑器图表 + AI 气泡图表"同时出现),
 *   initialize 可能被对方的配置覆盖 —— 轻则主题错乱,重则让不可信的
 *   AI 图表按调用方的宽松配置渲染。这里用一条 Promise 队列把
 *   「initialize + render」成对串行化,彻底消除该竞态。
 */
import mermaid from 'mermaid'

export type MermaidTheme = 'default' | 'dark' | 'neutral' | 'forest' | 'base'
export type MermaidSecurityLevel = 'strict' | 'loose' | 'antiscript' | 'sandbox'

export interface MermaidRenderOptions {
  theme?: MermaidTheme
  securityLevel?: MermaidSecurityLevel
  fontFamily?: string
}

/** 全局串行队列:上一次渲染结束(无论成败)后才开始下一次 */
let queue: Promise<unknown> = Promise.resolve()

/** 渲染 Mermaid 源码为 SVG 字符串;失败时抛出,由调用方降级处理 */
export function renderMermaidSvg(
  code: string,
  id: string,
  options: MermaidRenderOptions = {},
): Promise<string> {
  const task = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      theme: options.theme ?? 'default',
      // 兜底用 strict 而非 'loose':loose 是唯一跳过全部净化的档位
      securityLevel: options.securityLevel ?? 'strict',
      fontFamily: options.fontFamily ?? 'inherit',
    })
    const { svg } = await mermaid.render(id, code)
    return svg
  })
  // 单次失败不能卡死后续渲染
  queue = task.catch(() => undefined)
  return task
}
