/**
 * Application route names and the small amount of context that is allowed to
 * travel with a Study navigation.  Pages and shells own routing; reusable
 * components intentionally do not import this module (ADR-023).
 */

export type StudySource = 'library' | 'material' | 'queue' | 'center'

/** Top-level labels are part of the product contract (§15.14/DESIGN). */
export const NAV_ROUTES = ['home', 'library', 'knowledge', 'queue', 'center'] as const
export type NavRouteName = (typeof NAV_ROUTES)[number]
export const ROUTE_LABEL: Record<NavRouteName | 'settings', string> = {
  home: '主页',
  library: '素材库',
  knowledge: '知识库',
  queue: '解析队列',
  center: '学习中心',
  settings: '设置',
}

export type StudyContext = {
  source: StudySource
  materialId?: string
  sentenceId?: string
  returnPath?: string
}

export function studyPath(sessionId: string, context: StudyContext): string {
  const params = new URLSearchParams({ from: context.source })
  if (context.materialId) params.set('material', context.materialId)
  if (context.sentenceId) params.set('sentence', context.sentenceId)
  if (context.returnPath) params.set('return', context.returnPath)
  return `/study/${encodeURIComponent(sessionId)}?${params.toString()}`
}

export function readerPath(materialId: string, sentenceId?: string): string {
  const base = `/reader/${encodeURIComponent(materialId)}`
  return sentenceId ? `${base}?s=${encodeURIComponent(sentenceId)}` : base
}

export function materialPath(materialId: string): string {
  return `/material/${encodeURIComponent(materialId)}`
}
