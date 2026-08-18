/**
 * Canvas-domain data model shared by both halves. The host side's zod
 * schemas (src/host/store.ts) are the durable source of truth; these plain
 * interfaces mirror them for the browser bundle (which must not pull zod).
 */

export interface Card {
  boardId: string
  sessionId: string
  x: number
  y: number
  colorTag?: string
  createdAt: number
}

export interface Board {
  name: string
  color: string
  order: number
  createdAt: number
  archivedAt?: number
  shelvedAt?: number
}

export interface EdgeInjection {
  kind: 'digest' | 'full' | 'selection'
  injectedText?: string
}

export interface MapEdgeData {
  boardId: string
  fromCardId: string
  toCardId: string
  injection: EdgeInjection
  createdAt: number
}

export interface Digest {
  atSeq: number
  summary: string
  keyFindings: string[]
  nextStep: string
  todoNext?: string
  generatedAt: number
  model?: string
  error?: string
}

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface MapGlobal {
  version: number
  activeBoard: string
  cameraByBoard: Record<string, Camera>
  /** Auto-placement generation; absent = v1 (pre-workspace-grouping). */
  layoutVersion?: number
}

export interface MapStatePayload {
  boards: Record<string, Board>
  cards: Record<string, Card>
  edges: Record<string, MapEdgeData>
  digests: Record<string, Digest>
  global: MapGlobal
}

export const INBOX_BOARD_ID = 'inbox'
