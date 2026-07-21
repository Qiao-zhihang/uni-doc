/**
 * Wikilink 自动补全 composable
 * 在 contenteditable 中检测 [[ 触发文件选择浮窗
 * 支持键盘上下导航、Enter 确认、Esc/光标移出 关闭
 */

import { ref, computed, type Ref } from 'vue'
import { useDocumentStore } from '@/stores/document'
import type { VaultNode } from '@/core/vault/vault'

export interface AutocompleteItem {
  name: string
  path: string
}

export interface WikilinkAutocompleteOptions {
  /** contenteditable 元素的 ref */
  el: Ref<HTMLElement | null>
}

export function useWikilinkAutocomplete({ el }: WikilinkAutocompleteOptions) {
  const doc = useDocumentStore()

  // 浮窗状态
  const visible = ref(false)
  const query = ref('')
  const selectedIndex = ref(0)
  // 浮窗位置
  const popupX = ref(0)
  const popupY = ref(0)
  // [[ 在 innerText 中的起始偏移
  let triggerStart = -1

  /** 从 vault tree 扁平化所有 .md 文件(Map 按 path 去重缓存) */
  const allFiles = computed<AutocompleteItem[]>(() => {
    const cache = new Map<string, AutocompleteItem>()
    function walk(nodes: VaultNode[]) {
      for (const node of nodes) {
        if (node.isDir && node.children) {
          walk(node.children)
        } else if (/\.md$/i.test(node.name)) {
          cache.set(node.path, {
            name: node.name.replace(/\.md$/i, ''),
            path: node.path
          })
        }
      }
    }
    walk(doc.vaultTree)
    return Array.from(cache.values())
  })

  /** 过滤后的文件列表 */
  const filteredItems = computed<AutocompleteItem[]>(() => {
    const q = query.value.toLowerCase().trim()
    if (!q) return allFiles.value.slice(0, 50)
    return allFiles.value
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 50)
  })

  /** 获取光标在视口中的坐标 */
  function getCaretCoordinates(): { x: number; y: number } {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return { x: 0, y: 0 }
    const range = sel.getRangeAt(0).cloneRange()
    const rect = range.getClientRects()[0]
    if (rect) {
      return { x: rect.left, y: rect.bottom + 4 }
    }
    // fallback
    return { x: 0, y: 0 }
  }

  /**
   * 检测 contenteditable 文本中光标前是否有未闭合的 [[
   * 如果有,开启自动补全浮窗并返回 true
   */
  function checkTrigger(): boolean {
    const element = el.value
    if (!element) return false
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      close()
      return false
    }
    const range = sel.getRangeAt(0)
    if (!range.collapsed) {
      close()
      return false
    }
    // 获取光标前的文本(从行首或上一个空白到光标)
    const preRange = document.createRange()
    preRange.selectNodeContents(element)
    preRange.setEnd(range.startContainer, range.startOffset)
    const textBefore = preRange.toString()

    // 查找最后一个未闭合的 [[
    const lastOpen = textBefore.lastIndexOf('[[')
    if (lastOpen === -1) {
      close()
      return false
    }
    // 检查 [[ 后是否有 ]](已闭合)
    const afterTrigger = textBefore.slice(lastOpen + 2)
    if (afterTrigger.includes(']]')) {
      close()
      return false
    }
    // 检查 [[ 后是否跨行(不支持跨行补全)
    if (afterTrigger.includes('\n')) {
      close()
      return false
    }

    // 触发自动补全
    triggerStart = lastOpen
    query.value = afterTrigger
    selectedIndex.value = 0

    if (!visible.value) {
      visible.value = true
    }
    // 延迟获取坐标,确保 DOM 已更新
    requestAnimationFrame(() => {
      const coords = getCaretCoordinates()
      popupX.value = coords.x
      popupY.value = coords.y
    })
    return true
  }

  /**
   * 用 TreeWalker 找到 innerText 偏移对应的文本节点和字符偏移
   * 用于将 innerText 偏移转换为 DOM Range 位置
   */
  function findTextNodeAtOffset(element: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let currentOffset = 0
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text
      const textLen = (textNode.textContent || '').length
      if (currentOffset + textLen >= targetOffset) {
        return { node: textNode, offset: targetOffset - currentOffset }
      }
      currentOffset += textLen
    }
    return null
  }

  /** 确认选择:将 [[query 替换为 [[选中的文件名]] */
  function confirm(): boolean {
    if (!visible.value || selectedIndex.value < 0) return false
    const item = filteredItems.value[selectedIndex.value]
    if (!item) return false

    const element = el.value
    if (!element) return false

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return false
    const range = sel.getRangeAt(0)

    // 计算光标前的文本总长度
    const fullRange = document.createRange()
    fullRange.selectNodeContents(element)
    fullRange.setEnd(range.startContainer, range.startOffset)
    const textBefore = fullRange.toString()

    // 边界检查:triggerStart 有效且 [[ 在光标前
    if (triggerStart < 0 || triggerStart + 2 > textBefore.length) {
      close()
      return false
    }

    // 用 TreeWalker 找到 [[ 起始位置对应的文本节点和字符偏移
    // 支持 non-text cursor(如光标在 <br> 后或元素节点边界)
    const startPos = findTextNodeAtOffset(element, triggerStart)
    if (!startPos) {
      close()
      return false
    }

    // 创建从 [[ 到光标的 Range,删除内容并插入 [[文件名]]
    const replaceRange = document.createRange()
    replaceRange.setStart(startPos.node, startPos.offset)
    replaceRange.setEnd(range.startContainer, range.startOffset)
    replaceRange.deleteContents()

    const insertText = `[[${item.name}]]`
    const textNode = document.createTextNode(insertText)
    replaceRange.insertNode(textNode)

    // 将光标移到插入的文本之后
    const newRange = document.createRange()
    newRange.setStartAfter(textNode)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)

    close()
    return true
  }

  /** 关闭浮窗 */
  function close() {
    visible.value = false
    query.value = ''
    selectedIndex.value = 0
    triggerStart = -1
  }

  /** 键盘导航 */
  function onKeyDown(e: KeyboardEvent): boolean {
    if (!visible.value) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex.value = Math.min(selectedIndex.value + 1, filteredItems.value.length - 1)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      confirm()
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return true
    }
    return false
  }

  return {
    visible,
    items: filteredItems,
    selectedIndex,
    popupX,
    popupY,
    checkTrigger,
    onKeyDown,
    close,
    confirm
  }
}
