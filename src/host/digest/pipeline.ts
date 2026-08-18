/**
 * Digest pipeline: turn/end → per-session debounce → single-flight queue →
 * readSurface → extract → hash-skip → one LLM call → digests table.
 *
 * Deliberately NOT ctx.compaction (destructive, needs a live agent, holds a
 * log lock). Failure degrades gracefully: the todo/write "next step" and any
 * previous digest fields survive, with `error` set for the card badge.
 */
import { createHash } from 'node:crypto'
import type { DigestHostServices } from '../dsh-host.ts'
import type { Digest, TalkMapStore } from '../store.ts'
import { extractFromSurface } from './extract.ts'
import { DIGEST_SYSTEM_PROMPT, digestUserPrompt, parseDigestOutput } from './prompt.ts'

export interface DigestConfig {
  enabled: boolean
  idleMs: number
}

export const DIGEST_DEFAULTS: DigestConfig = { enabled: true, idleMs: 90_000 }

const MIN_MESSAGES = 2

export class DigestPipeline {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly queue: string[] = []
  private readonly queued = new Set<string>()
  private draining = false
  private disposed = false

  constructor(
    private readonly services: DigestHostServices,
    private readonly storeReady: Promise<TalkMapStore>,
    private readonly config: DigestConfig = DIGEST_DEFAULTS,
  ) {}

  /** Wire the turn/end trigger; returns the disposer. */
  start(): () => void {
    const off = this.services.on('session/event', (...args: unknown[]) => {
      if (!this.config.enabled) return
      const session = args[0] as { id?: string }
      const event = args[1] as { type?: string }
      if (event?.type !== 'turn/end' || typeof session?.id !== 'string') return
      this.schedule(session.id)
    })
    return () => {
      this.disposed = true
      off()
      for (const timer of this.timers.values()) clearTimeout(timer)
      this.timers.clear()
    }
  }

  /** Debounced trigger: a busy session settles idleMs before digesting. */
  schedule(sessionId: string): void {
    if (this.disposed) return
    const existing = this.timers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      this.enqueue(sessionId)
    }, this.config.idleMs)
    timer.unref?.()
    this.timers.set(sessionId, timer)
  }

  /** Manual refresh: skips the debounce, forces regeneration (ignores hash). */
  async refresh(sessionId: string): Promise<Digest> {
    return await this.run(sessionId, { force: true })
  }

  /** Queue sessions that have no digest yet (imported/backlog cards). */
  backfill(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) this.enqueue(sessionId)
  }

  private enqueue(sessionId: string): void {
    if (this.queued.has(sessionId)) return
    this.queued.add(sessionId)
    this.queue.push(sessionId)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const sessionId = this.queue.shift()
        if (sessionId === undefined) break
        this.queued.delete(sessionId)
        try {
          await this.run(sessionId, { force: false })
        } catch (error) {
          this.services.logger?.warn(`[dsh-talk-map] digest for ${sessionId} failed: ${String(error)}`)
        }
      }
    } finally {
      this.draining = false
    }
  }

  private async run(sessionId: string, options: { force: boolean }): Promise<Digest> {
    const store = await this.storeReady
    const surface = await this.services.sessionQuery.readSurface(sessionId)
    const extracted = extractFromSurface(surface.events, surface.capturedThroughSeq)
    const previous = store.digests.get(sessionId)

    if (extracted.transcript === '' || extracted.messageCount < MIN_MESSAGES) {
      // Too little to summarize — still surface the todo fallback.
      const digest: Digest = {
        atSeq: extracted.lastSeq,
        summary: previous?.summary ?? '',
        keyFindings: previous?.keyFindings ?? [],
        nextStep: previous?.nextStep ?? '',
        ...(extracted.todoNext !== undefined ? { todoNext: extracted.todoNext } : {}),
        generatedAt: Date.now(),
      }
      await store.digests.put(sessionId, digest)
      return digest
    }

    const inputHash = createHash('sha256').update(extracted.transcript).digest('hex')
    if (!options.force && previous?.inputHash === inputHash && previous.error === undefined) {
      return previous
    }

    const route = this.services.agentDefaultModel.currentSelection()
    try {
      const raw = await this.generate(route, extracted.transcript, sessionId)
      const parsed = parseDigestOutput(raw)
      const digest: Digest = {
        atSeq: extracted.lastSeq,
        summary: parsed.summary,
        keyFindings: parsed.keyFindings,
        nextStep: parsed.nextStep,
        ...(extracted.todoNext !== undefined ? { todoNext: extracted.todoNext } : {}),
        generatedAt: Date.now(),
        model: `${route.provider}/${route.model}`,
        inputHash,
      }
      await store.digests.put(sessionId, digest)
      return digest
    } catch (error) {
      const digest: Digest = {
        atSeq: extracted.lastSeq,
        summary: previous?.summary ?? '',
        keyFindings: previous?.keyFindings ?? [],
        nextStep: previous?.nextStep ?? '',
        ...(extracted.todoNext !== undefined ? { todoNext: extracted.todoNext } : {}),
        generatedAt: Date.now(),
        error: String(error).slice(0, 500),
      }
      await store.digests.put(sessionId, digest)
      return digest
    }
  }

  private async generate(
    route: { provider: string; model: string },
    transcript: string,
    sessionId: string,
  ): Promise<string> {
    const message = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: [{ type: 'text' as const, text: digestUserPrompt(transcript) }],
      source: { kind: 'plugin' as const, plugin: 'dsh-talk-map' },
    }
    let text = ''
    let failure: string | undefined
    // Generous cap: reasoning models spend most of the budget thinking
    // before any text-delta arrives.
    for await (const chunk of this.services.llm.stream({
      provider: route.provider,
      model: route.model,
      messages: [message],
      system: DIGEST_SYSTEM_PROMPT,
      maxTokens: 4096,
      sessionId,
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'finish' && chunk.reason !== undefined && chunk.reason.kind !== 'stop') {
        failure = chunk.reason.failure?.message ?? chunk.reason.kind
      }
    }
    // A max-tokens finish with parseable text is still a usable digest;
    // parseDigestOutput throws on truncated JSON, surfacing the real failure.
    if (failure !== undefined && failure !== 'max-tokens') throw new Error(`llm finish: ${failure}`)
    if (text.trim() === '') throw new Error(`llm produced no text${failure !== undefined ? ` (${failure})` : ''}`)
    return text
  }
}
