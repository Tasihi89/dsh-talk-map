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
  'card.refresh': '重新生成摘要',
  'edge.injected': '注入',
  'spawn.heading': '连线分叉：开一个带上下文的新对话',
  'spawn.from': '来源',
  'spawn.hint': '以下内容将注入新对话作为背景，可以编辑：',
  'spawn.noDigest': '（这段对话还没有摘要——可以先点卡片右上角的 ⟳ 生成，或直接在这里手写要带过去的背景。）',
  'spawn.confirm': '开新对话',
  'spawn.busy': '创建中……',
  'spawn.cancel': '取消',
  'inject.header': '【上下文注入 · 来自】',
  'inject.summary': '摘要：',
  'inject.findings': '关键结论：',
  'inject.next': '下一步：',
  'frame.ungrouped': '未分组',
  'draft.heading': '新对话',
  'draft.workspace': '工作区',
  'draft.model': '模型',
  'draft.preset': '模式',
  'draft.default': '默认',
  'draft.placeholder': '想聊什么？发送后会话在后台开跑，卡片留在地图上（⌘/Ctrl+Enter 发送）',
  'draft.send': '发送',
  'draft.sending': '发送中……',
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
  'card.refresh': 'Regenerate digest',
  'edge.injected': 'injected',
  'spawn.heading': 'Fork with context',
  'spawn.from': 'From',
  'spawn.hint': 'This text will be injected into the new session as background — edit freely:',
  'spawn.noDigest': '(No digest yet — hit ⟳ on the card first, or write the context to carry over by hand.)',
  'spawn.confirm': 'Start session',
  'spawn.busy': 'Creating…',
  'spawn.cancel': 'Cancel',
  'inject.header': '[Context injected from] ',
  'inject.summary': 'Summary: ',
  'inject.findings': 'Key findings:',
  'inject.next': 'Next step: ',
  'frame.ungrouped': 'Ungrouped',
  'draft.heading': 'New conversation',
  'draft.workspace': 'Workspace',
  'draft.model': 'Model',
  'draft.preset': 'Preset',
  'draft.default': 'Default',
  'draft.placeholder': 'What is this about? On send the session runs in the background; the card stays on the map (⌘/Ctrl+Enter to send)',
  'draft.send': 'Send',
  'draft.sending': 'Sending…',
}

function isZh(): boolean {
  if (typeof document === 'undefined') return false
  return (document.documentElement.lang ?? '').toLowerCase().startsWith('zh')
}

export function t(key: string): string {
  const dict = isZh() ? zh : en
  return dict[key] ?? en[key] ?? key
}
