/** Shared, non-React helpers for repository adapters. */

export type RepositorySource = 'api' | 'fixture'

/**
 * Every repository advertises where its data came from.  The fixture source is
 * deliberately explicit so a screen cannot accidentally present prototype
 * data as a production read.
 */
export type RepositoryMetadata = {
  readonly source: RepositorySource
  readonly unstable: boolean
}

export type RepositoryRequestOptions = {
  signal?: AbortSignal
}

export class RepositoryNotFoundError extends Error {
  readonly resource: string
  readonly id: string

  constructor(resource: string, id: string) {
    super(`${resource}不存在：${id}`)
    this.name = 'RepositoryNotFoundError'
    this.resource = resource
    this.id = id
  }
}

export class FixtureCapabilityError extends Error {
  readonly capability: string

  constructor(capability: string) {
    super(`${capability} 当前仅有 fixture，真实 API 尚未实现`)
    this.name = 'FixtureCapabilityError'
    this.capability = capability
  }
}

/** Keep fixture reads isolated from accidental component mutation. */
export function cloneFixture<T>(value: T): T {
  return structuredClone(value)
}

/** Match fetch's AbortError behavior for synchronous fixture reads. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}
