/**
 * Auto-sync pushes: when a session's digest substantively changes (new
 * inputHash), forward it along every autoSync edge whose source card belongs
 * to that session. Delivery rides Spawner.injectInto — inbox semantics, so
 * the target is never interrupted and the guard-rail footer is appended
 * host-side. A target that is not live is skipped (the edge stays armed;
 * the next digest change tries again).
 */
import type { Digest, TalkMapStore } from './store.ts'
import type { Spawner } from './spawn.ts'

export function pushAutoSyncUpdates(
  store: TalkMapStore,
  spawner: Spawner,
  logger: { info?(message: string): void; warn(message: string): void } | undefined,
  sessionId: string,
  digest: Digest,
): void {
  const sourceCardIds = new Set<string>()
  for (const [cardId, card] of store.cards.entries()) {
    if (card.sessionId === sessionId) sourceCardIds.add(cardId)
  }
  if (sourceCardIds.size === 0) return

  const pushedTo = new Set<string>()
  for (const [, edge] of store.edges.entries()) {
    if (edge.autoSync !== true || !sourceCardIds.has(edge.fromCardId)) continue
    const target = store.cards.get(edge.toCardId)
    if (target === undefined || target.sessionId === sessionId) continue
    if (pushedTo.has(target.sessionId)) continue
    pushedTo.add(target.sessionId)
    const text = formatUpdate(edge.fromTitle, digest)
    try {
      spawner.injectInto(target.sessionId, [{ sessionId, text }])
      logger?.info?.(`[dsh-talk-map] auto-sync: ${sessionId} → ${target.sessionId}`)
    } catch {
      logger?.info?.(`[dsh-talk-map] auto-sync: target ${target.sessionId} not live, skipped`)
    }
  }
}

/** Mirrors the client's push format (digest-text.ts) — keep in sync. */
function formatUpdate(fromTitle: string | undefined, digest: Digest): string {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const parts = [`【来自「${fromTitle ?? '关联对话'}」的更新 · ${time}】`]
  if (digest.summary !== '') parts.push(`摘要：${digest.summary}`)
  if (digest.keyFindings.length > 0) {
    parts.push('关键结论：')
    for (const finding of digest.keyFindings) parts.push(`- ${finding}`)
  }
  const next = digest.nextStep !== '' ? digest.nextStep : digest.todoNext ?? ''
  if (next !== '') parts.push(`下一步：${next}`)
  return parts.join('\n')
}
