/**
 * Transcript extraction: fold a session's surface (its current model-visible
 * face, compaction already applied) into plain text for the digest call, and
 * lift the zero-cost "next step" from the last todo/write snapshot.
 */
import type { SessionEventLite, UserMessageLite } from '../dsh-host.ts'

const MAX_MESSAGES = 40
const MAX_CHARS = 24_000

interface TranscriptLine {
  role: 'user' | 'assistant'
  text: string
}

interface TodoItemLite {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface ExtractResult {
  /** Empty when the session has no usable text yet. */
  transcript: string
  /** First unfinished todo item, most recent snapshot (last-wins). */
  todoNext?: string
  /** Last event seq folded in (staleness anchor). */
  lastSeq: number
  messageCount: number
}

function textOfBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function extractFromSurface(events: SessionEventLite[], capturedThroughSeq: number | null): ExtractResult {
  const lines: TranscriptLine[] = []
  let todoNext: string | undefined
  let lastSeq = capturedThroughSeq ?? 0

  for (const event of events) {
    if (event.seq > lastSeq) lastSeq = event.seq
    if (event.type === 'user/message') {
      const message = event.data as Partial<UserMessageLite> | undefined
      // Skip tool results (role user, source tool) and non-text payloads.
      const kind = (message?.source as { kind?: string } | undefined)?.kind
      if (kind === 'tool') continue
      const text = textOfBlocks(message?.content)
      if (text !== '') lines.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const data = event.data as { message?: { content?: unknown } } | undefined
      const text = textOfBlocks(data?.message?.content)
      if (text !== '') lines.push({ role: 'assistant', text })
    } else if (event.type === 'todo/write') {
      const data = event.data as { todos?: TodoItemLite[] } | undefined
      const open = data?.todos?.find(item => item.status !== 'completed')
      todoNext = open?.content // last snapshot wins; undefined clears
    }
  }

  const recent = lines.slice(-MAX_MESSAGES)
  let transcript = recent
    .map(line => `${line.role === 'user' ? 'USER' : 'ASSISTANT'}: ${line.text}`)
    .join('\n\n')
  if (transcript.length > MAX_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_CHARS)
  }

  return {
    transcript,
    ...(todoNext !== undefined && todoNext !== '' ? { todoNext } : {}),
    lastSeq,
    messageCount: recent.length,
  }
}
