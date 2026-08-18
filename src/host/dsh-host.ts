/**
 * Structural contracts for the DSH host services this plugin touches.
 * Source of truth — verify on dsh upgrades:
 *   packages/storage/storage-domain/src/{spec,domain,index}.ts  (ctx.storageDomain)
 *   docs/subsystems/web-server.md                               (ctx.webServer)
 *   packages/core/session/src/index.ts                          (session events)
 * all @ deepseek-harness 0.1.0-rc.6.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ZodType } from 'zod'

/** storage-domain: spec is plain data — zod schemas plus names. */
export interface DomainGlobalSpec<G> {
  readonly schema: ZodType<G>
  readonly initial: G
}
export interface DomainTableSpec<V> {
  readonly valueSchema: ZodType<V>
}
export interface DomainSpec {
  readonly name: string
  readonly version: number
  readonly global?: DomainGlobalSpec<unknown>
  readonly tables: Record<string, DomainTableSpec<unknown>>
}

export interface DomainGlobal<G> {
  get(): G
  set(value: G): Promise<void>
}
export interface KvTable<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: V) => V): Promise<V>
}
export interface Domain {
  readonly name: string
  readonly global: DomainGlobal<unknown>
  table(name: string): KvTable<unknown>
  close(): Promise<void>
}
export interface StorageDomainService {
  open(spec: DomainSpec): Promise<Domain>
}

/** ctx.webServer — register returns a disposer; duplicate (kind,path) throws. */
export interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}
export interface WebServerService {
  register(route: WebServerRoute): () => void
  readonly port?: number
  readonly host?: string
}

/** domain/changed event payload (storage-domain/src/events.ts). */
export interface DomainChanged {
  domain: string
  table: string
  key: string
  operation: 'put' | 'deleted'
  value?: unknown
}

/** One durable session event (subset we read). */
export interface SessionEventLite {
  type: string
  seq: number
  time?: number
  data?: unknown
}

/** ctx.sessionQuery (subset; packages/session-query/session-query/src/index.ts). */
export interface SessionRecordLite {
  header: {
    id: string
    createdAt: number
    cwd?: string
    parentSession?: string
    agentPreset?: string
  }
  live: boolean
  persisted: boolean
}
export interface SessionQueryService {
  listSessions(signal?: AbortSignal): Promise<SessionRecordLite[]>
  readSurface(sessionId: string): Promise<{
    capturedThroughSeq: number | null
    events: SessionEventLite[]
  }>
}

/** Message shapes (packages/llm/llm/src/message.ts) — constructed literally. */
export interface TextBlock { type: 'text'; text: string }
export interface UserMessageLite {
  id: string
  role: 'user'
  content: TextBlock[]
  source: { kind: 'plugin'; plugin: string; form?: 'notice'; summary?: string }
}

/** ctx.llm (subset; GenerateOptions requires an explicit provider/model route). */
export interface LlmStreamChunkLite {
  type: string
  text?: string
  reason?: { kind: string; failure?: { message?: string } }
}
export interface LlmService {
  stream(options: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    sessionId?: string
    signal?: AbortSignal
  }): AsyncIterable<LlmStreamChunkLite>
}

/** ctx.agentDefaultModel (packages/core/agent-default-model). */
export interface AgentDefaultModelService {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

/** ctx.agents (subset; packages/core/agent/src/index.ts). */
export interface AgentLite {
  inject(message: UserMessageLite): void
  followup(message: UserMessageLite): void
}
export interface AgentHandleLite {
  agent: AgentLite
  dispose(): Promise<void>
}
export interface AgentsService {
  create(options: {
    sessionId: string
    meta?: {
      cwd?: string
      parentSession?: string
      agentPreset?: string
    }
  }): Promise<AgentHandleLite>
  get(id: string): AgentLite | undefined
}

/** The host cordis context surface this plugin relies on (structural). */
export interface TalkMapHostServices {
  storageDomain: StorageDomainService
  webServer: WebServerService
  logger?: { info?(message: string): void; warn(message: string): void }
  effect(callback: () => (() => void | Promise<void>), label?: string): void
  on(event: string, listener: (...args: unknown[]) => void): () => void
}

/** The digest layer's injected surface. */
export interface DigestHostServices {
  sessionQuery: SessionQueryService
  llm: LlmService
  agentDefaultModel: AgentDefaultModelService
  logger?: { info?(message: string): void; warn(message: string): void }
  effect(callback: () => (() => void | Promise<void>), label?: string): void
  on(event: string, listener: (...args: unknown[]) => void): () => void
}

/** ctx.workspaceRegistry (subset; packages/workspace/workspace). */
export interface WorkspaceRegistryService {
  resolveByPath(path: string): Promise<{ attachSession(sessionId: string): Promise<void> } | undefined>
}

/** The spawn layer's injected surface. */
export interface SpawnHostServices {
  agents: AgentsService
  sessionQuery: SessionQueryService
  workspaceRegistry: WorkspaceRegistryService
  logger?: { info?(message: string): void; warn(message: string): void }
  effect(callback: () => (() => void | Promise<void>), label?: string): void
}
