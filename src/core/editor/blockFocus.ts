/**
 * 块级焦点 / 光标定位
 *
 * 从 BlockEditor 中抽出,供 BlockEditor 与 Toolbar 共用 ——
 * 工具栏执行"转换为…/插入…"后需要把焦点交还给目标块,
 * 而 Toolbar 并不持有画布引用,故此处的行查找基于已挂载的 DOM。
 *
 * 为什么可以直接按 data-block-id 全局查找:
 * BlockEditor 在 EditorView 里用 v-if / v-else 渲染,同一时刻只有一个实例挂载,
 * 因此 document 中最多存在一行匹配某个 block id。
 */

/** 与 BlockEditor 模板中 .block-row 上的属性名保持一致 */
const BLOCK_ID_ATTR = 'data-block-id'
const EDITABLE_SELECTOR = '[contenteditable="true"]'

function findBlockRow(blockId: string): HTMLElement | null {
  // 注意括号位置:属性选择器是 [attr="value"]
  return document.querySelector(`[${BLOCK_ID_ATTR}="${CSS.escape(blockId)}"]`)
}

/** 查找行内可编辑元素(优先 [contenteditable=true]) */
function findEditable(row: HTMLElement): HTMLElement | null {
  const direct = row.querySelector(EDITABLE_SELECTOR) as HTMLElement | null
  if (direct) return direct
  // 兼容未显式声明 contenteditable="true" 的可编辑宿主
  const loose = row.querySelector('[contenteditable]') as HTMLElement | null
  if (loose && loose.getAttribute('contenteditable') !== 'false') return loose
  return null
}

/** 收集元素内的文本节点(文档顺序) */
function textNodesOf(root: HTMLElement): Node[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Node[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node)
  return nodes
}

/**
 * 把插入点放到元素内的指定位置。
 *
 * 注意 `editable.lastChild` / `firstChild` 可能是**元素**(如加粗渲染出的 <strong>),
 * 此时 `range.setStart(element, n)` 的 n 是**子节点索引**而非字符偏移,
 * 会抛异常或把光标放到错误位置。因此这里一律定位到文本节点上。
 */
function placeCaret(editable: HTMLElement, at: 'start' | 'end' | number) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  const texts = textNodesOf(editable)

  if (!texts.length) {
    // 空块:range 只能落在元素本身
    range.setStart(editable, 0)
    range.setEnd(editable, 0)
    sel.removeAllRanges()
    sel.addRange(range)
    return
  }

  if (at === 'start') {
    range.setStart(texts[0], 0)
    range.setEnd(texts[0], 0)
  } else if (at === 'end') {
    const last = texts[texts.length - 1]
    const len = last.textContent?.length ?? 0
    range.setStart(last, len)
    range.setEnd(last, len)
  } else {
    // 数字偏移:按字符累加定位到具体文本节点
    let remaining = at
    let placed = false
    for (const node of texts) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        range.setStart(node, remaining)
        range.setEnd(node, remaining)
        placed = true
        break
      }
      remaining -= len
    }
    if (!placed) {
      // 偏移超出实际长度 → 退到末尾
      const last = texts[texts.length - 1]
      const len = last.textContent?.length ?? 0
      range.setStart(last, len)
      range.setEnd(last, len)
    }
  }

  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * 把焦点移到指定块。
 *
 * 非文本块(divider / page_break / image)内部没有 contenteditable,
 * 早期实现遇到这种情况直接 return,导致焦点静默掉到 document.body、
 * 后续键盘全部失效(表现为"删除块之后键盘没反应")。
 * 现在回退为聚焦行容器本身(.block-row 带 tabindex="-1")。
 *
 * @returns 是否成功定位到该块
 */
export function focusBlockAt(blockId: string, at: 'start' | 'end' | number = 'start'): boolean {
  const row = findBlockRow(blockId)
  if (!row) return false

  const editable = findEditable(row)
  if (editable) {
    editable.focus()
    placeCaret(editable, at)
    return true
  }

  // 非文本块:聚焦行容器,保持键盘事件落在编辑器内
  row.focus({ preventScroll: false })
  return true
}

/**
 * 焦点转移到指定块之后的兜底:
 * 从 preferredId 开始按给定顺序找到第一个能聚焦的块。
 *
 * 用于"删除某块后该把焦点放哪"这类场景 —— 目标可能正好是非文本块或者已不存在。
 *
 * @param candidates 候选 block id,按优先级排列
 */
export function focusFirstAvailable(
  candidates: string[],
  at: 'start' | 'end' | number = 'end',
): boolean {
  for (const id of candidates) {
    if (id && focusBlockAt(id, at)) return true
  }
  return false
}
