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
  'map.loading': '正在加载地图……',
  'map.loadError': '地图数据加载失败：',
  'card.running': '正在运行',
  'card.ghostTitle': '会话已不存在',
  'card.remove': '移除卡片',
  'card.next': '下一步',
  'card.stale': '摘要已过期',
  'time.now': '刚刚',
  'time.m': ' 分钟前',
  'time.h': ' 小时前',
  'time.d': ' 天前',
}

const en: Record<string, string> = {
  'map.title': 'Talk Map',
  'map.close': 'Close map (Esc)',
  'map.toggle': 'Talk Map',
  'map.empty': 'No cards yet — double-click empty space to start a chat',
  'map.sessions': 'sessions',
  'map.loading': 'Loading map…',
  'map.loadError': 'Failed to load map data:',
  'card.running': 'running',
  'card.ghostTitle': 'Session no longer exists',
  'card.remove': 'Remove card',
  'card.next': 'Next',
  'card.stale': 'digest stale',
  'time.now': 'now',
  'time.m': 'm ago',
  'time.h': 'h ago',
  'time.d': 'd ago',
}

function isZh(): boolean {
  if (typeof document === 'undefined') return false
  return (document.documentElement.lang ?? '').toLowerCase().startsWith('zh')
}

export function t(key: string): string {
  const dict = isZh() ? zh : en
  return dict[key] ?? en[key] ?? key
}
