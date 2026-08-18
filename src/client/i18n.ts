/**
 * Two-locale copy dictionary reading <html lang> directly (the pattern
 * dsh-plugin-market uses), so no dependency on the locale service. dsh sets
 * the document language; anything starting with "zh" renders Chinese.
 */
const zh: Record<string, string> = {
  'map.title': '对话地图',
  'map.close': '关闭地图（Esc）',
  'map.toggle': '对话地图',
  'map.empty': '还没有卡片 —— 双击空白处开始一个新对话',
  'map.sessions': '个会话',
}

const en: Record<string, string> = {
  'map.title': 'Talk Map',
  'map.close': 'Close map (Esc)',
  'map.toggle': 'Talk Map',
  'map.empty': 'No cards yet — double-click empty space to start a chat',
  'map.sessions': 'sessions',
}

function isZh(): boolean {
  if (typeof document === 'undefined') return false
  return (document.documentElement.lang ?? '').toLowerCase().startsWith('zh')
}

export function t(key: string): string {
  const dict = isZh() ? zh : en
  return dict[key] ?? en[key] ?? key
}
