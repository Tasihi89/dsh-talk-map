/**
 * Thin fetch/EventSource layer over the host half's /talk-map/* routes.
 * Same-origin by construction (relative URLs against the serving shell).
 */
import type { Card, MapGlobal, MapStatePayload } from '../shared/model.ts'

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await response.json())
    } catch { /* body not json */ }
    throw new Error(`${path} → ${response.status} ${detail}`)
  }
  return await response.json() as T
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const talkMapApi = {
  getState(): Promise<MapStatePayload> {
    return requestJson<MapStatePayload>('/talk-map/state')
  },
  upsertCards(cards: Record<string, Card>): Promise<void> {
    return postJson('/talk-map/cards/upsert', { cards })
  },
  deleteCards(ids: readonly string[]): Promise<void> {
    return postJson('/talk-map/cards/delete', { ids })
  },
  setGlobal(global: MapGlobal): Promise<void> {
    return postJson('/talk-map/global', { global })
  },
  /**
   * Subscribe to host-side domain changes (multi-tab sync, digest arrivals).
   * @returns disposer closing the EventSource.
   */
  subscribeChanges(onChange: (change: {
    table: string
    key: string
    operation: 'put' | 'deleted'
    value?: unknown
  }) => void): () => void {
    const source = new EventSource('/talk-map/events')
    source.addEventListener('change', (event) => {
      try {
        onChange(JSON.parse((event as MessageEvent).data as string))
      } catch { /* malformed frame — skip */ }
    })
    return () => { source.close() }
  },
}
