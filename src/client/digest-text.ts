/**
 * Digest → injectable text. Two shapes over the same body: the fork panel's
 * background block (buildInjectionText) and the pipe push's timestamped
 * update (buildPushText, mirrored host-side in host/auto-sync.ts).
 */
import type { Digest } from '../shared/model.ts'
import { t } from './i18n.ts'

function digestBody(digest: Digest): string[] {
  const parts: string[] = []
  if (digest.summary !== '') parts.push(`${t('inject.summary')}${digest.summary}`)
  if (digest.keyFindings.length > 0) {
    parts.push(t('inject.findings'))
    for (const finding of digest.keyFindings) parts.push(`- ${finding}`)
  }
  const next = digest.nextStep !== '' ? digest.nextStep : digest.todoNext ?? ''
  if (next !== '') parts.push(`${t('inject.next')}${next}`)
  return parts
}

export function digestIsEmpty(digest: Digest | undefined): boolean {
  // Derived from digestBody so the two can never drift apart — a digest
  // that renders no body IS the definition of empty. (The drift already
  // happened once: a hand-copied field list here forgot keyFindings and
  // findings-only digests went unpushable.)
  return digest === undefined || digestBody(digest).length === 0
}

export function buildInjectionText(title: string, digest: Digest | undefined): string {
  const header = `${t('inject.header')}「${title}」`
  if (digest === undefined || digestIsEmpty(digest)) {
    return `${header}\n${t('spawn.noDigest')}`
  }
  return [header, ...digestBody(digest)].join('\n')
}

/** The pipe push: latest digest of the source, stamped with origin + time. */
export function buildPushText(title: string, digest: Digest): string {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const header = t('push.header', { from: title, time })
  return [header, ...digestBody(digest)].join('\n')
}
