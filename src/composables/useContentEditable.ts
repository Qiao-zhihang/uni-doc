/**
 * contenteditable 通用交互增强 composable
 * 提供:IME 组合输入保护、富文本粘贴清洗、Tab 键行为
 * 用法:
 *   const { isComposing, onCompositionStart, onCompositionEnd, onPasteClean, onTabKey } = useContentEditable(el)
 *   在 contenteditable 元素上绑定:
 *     @compositionstart="onCompositionStart"
 *     @compositionend="onCompositionEnd"
 *     @paste="onPasteClean"
 *     @keydown="handleKeydown"  (其中调用 onTabKey(e) 处理 Tab)
 */
import { ref } from 'vue'

export function useContentEditable(_el: { value: HTMLElement | null }) {
  /** 是否处于 IME 组合输入中(中文/日文输入法) */
  const isComposing = ref(false)

  function onCompositionStart() {
    isComposing.value = true
  }

  function onCompositionEnd() {
    isComposing.value = false
  }

  /**
   * 清洗富文本粘贴:只保留纯文本,防止恶意 HTML/脚本注入
   * 图片粘贴由各组件单独处理(ParagraphBlock 已有)
   */
  function onPasteClean(e: ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    // 如果有图片,跳过(让组件自己的粘贴处理器处理)
    for (const item of items) {
      if (item.type.startsWith('image/')) return
    }
    // 只处理纯文本粘贴
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text) return
    // 用 execCommand 插入到光标位置
    document.execCommand('insertText', false, text)
  }

  /**
   * 处理 Tab 键:
   * - 代码块:插入 2 空格
   * - 列表:暂时不处理(需要接入列表层级逻辑)
   * - 其他块:插入 2 空格,而不是让焦点跳到下一个元素
   */
  function onTabKey(e: KeyboardEvent, mode: 'indent' | 'spaces' = 'spaces') {
    if (e.key !== 'Tab') return
    e.preventDefault()
    if (mode === 'indent') {
      // 列表的缩进/反缩进暂时保留,由各组件自己实现
      return
    }
    // 默认:插入 2 空格
    document.execCommand('insertText', false, '  ')
  }

  return {
    isComposing,
    onCompositionStart,
    onCompositionEnd,
    onPasteClean,
    onTabKey,
  }
}
