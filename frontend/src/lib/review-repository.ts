import {
  cloneFixture,
  FixtureCapabilityError,
  type RepositoryMetadata,
  type RepositoryRequestOptions,
  throwIfAborted,
} from '@/lib/repository-utils'

export type ReviewItemStatus = 'queued' | 'active' | 'paused' | 'retired'

/**
 * Data-model §7.1 ReviewItem.  ReviewState/due/stability are intentionally not
 * included: admission is not first rating, so a queued or newly active item
 * must not be presented as having an FSRS state.
 */
export type ReviewItemRecord = {
  review_item_id: string
  occurrence_id: string
  kp_id: string
  status: ReviewItemStatus
  admitted_at: string | null
  retired_at: string | null
}

export type ReviewFilter = {
  status?: ReviewItemStatus
  kp_id?: string
  occurrence_id?: string
}

/**
 * P5 read boundary.  Review endpoints are not present in the current
 * OpenAPI, so this interface is unstable and fixture-only until P5 publishes
 * its real scheduling/export API.
 */
export interface ReviewRepository extends RepositoryMetadata {
  readonly unstable: true
  listReviewItems(filter?: ReviewFilter, options?: RepositoryRequestOptions): Promise<ReviewItemRecord[]>
  getReviewItem(reviewItemId: string, options?: RepositoryRequestOptions): Promise<ReviewItemRecord | null>
  listQueued(options?: RepositoryRequestOptions): Promise<ReviewItemRecord[]>
  listAdmitted(options?: RepositoryRequestOptions): Promise<ReviewItemRecord[]>
}

export type ReviewFixtureSeed = {
  reviewItems?: readonly ReviewItemRecord[]
}

const defaultReviewFixtureSeed: Required<ReviewFixtureSeed> = {
  reviewItems: [
    {
      review_item_id: 'fixture-review-queued',
      occurrence_id: 'fixture-occ-kimi',
      kp_id: 'fixture-kp-kimi',
      status: 'queued',
      admitted_at: null,
      retired_at: null,
    },
    {
      review_item_id: 'fixture-review-active',
      occurrence_id: 'fixture-occ-tsugi',
      kp_id: 'fixture-kp-tsugi',
      status: 'active',
      admitted_at: '2026-09-09T21:35:00+08:00',
      retired_at: null,
    },
    {
      review_item_id: 'fixture-review-paused',
      occurrence_id: 'fixture-occ-ganbaru',
      kp_id: 'fixture-kp-ganbaru',
      status: 'paused',
      admitted_at: '2026-09-08T20:24:00+08:00',
      retired_at: null,
    },
    {
      review_item_id: 'fixture-review-retired',
      occurrence_id: 'fixture-occ-tsugi',
      kp_id: 'fixture-kp-tsugi',
      status: 'retired',
      admitted_at: '2026-09-07T20:24:00+08:00',
      retired_at: '2026-09-08T20:24:00+08:00',
    },
  ],
}

export const fixtureReviewItems = defaultReviewFixtureSeed.reviewItems

export class ReviewFixtureAdapter implements ReviewRepository {
  readonly source = 'fixture' as const
  readonly unstable = true as const
  private readonly seed: Required<ReviewFixtureSeed>

  constructor(seed: ReviewFixtureSeed = {}) {
    this.seed = { reviewItems: Array.from(seed.reviewItems ?? defaultReviewFixtureSeed.reviewItems) }
  }

  async listReviewItems(
    filter: ReviewFilter = {},
    options: RepositoryRequestOptions = {},
  ): Promise<ReviewItemRecord[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.reviewItems.filter((item) =>
      (filter.status === undefined || item.status === filter.status) &&
      (filter.kp_id === undefined || item.kp_id === filter.kp_id) &&
      (filter.occurrence_id === undefined || item.occurrence_id === filter.occurrence_id),
    ))
  }

  async getReviewItem(reviewItemId: string, options: RepositoryRequestOptions = {}): Promise<ReviewItemRecord | null> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const item = this.seed.reviewItems.find((reviewItem) => reviewItem.review_item_id === reviewItemId)
    return item ? cloneFixture(item) : null
  }

  async listQueued(options: RepositoryRequestOptions = {}): Promise<ReviewItemRecord[]> {
    return this.listReviewItems({ status: 'queued' }, options)
  }

  async listAdmitted(options: RepositoryRequestOptions = {}): Promise<ReviewItemRecord[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.reviewItems.filter((item) => item.admitted_at !== null && item.status !== 'retired'))
  }
}

/** Explicit placeholder for P5 scheduling/export endpoints not in the current OpenAPI. */
export class ReviewApiAdapter implements ReviewRepository {
  readonly source = 'api' as const
  readonly unstable = true as const

  private unavailable(): Promise<never> {
    return Promise.reject(new FixtureCapabilityError('ReviewItem API'))
  }

  listReviewItems(filter?: ReviewFilter, options?: RepositoryRequestOptions): Promise<ReviewItemRecord[]> { void filter; void options; return this.unavailable() }
  getReviewItem(reviewItemId: string, options?: RepositoryRequestOptions): Promise<ReviewItemRecord | null> { void reviewItemId; void options; return this.unavailable() }
  listQueued(options?: RepositoryRequestOptions): Promise<ReviewItemRecord[]> { void options; return this.unavailable() }
  listAdmitted(options?: RepositoryRequestOptions): Promise<ReviewItemRecord[]> { void options; return this.unavailable() }
}

export function createReviewFixtureAdapter(seed?: ReviewFixtureSeed): ReviewRepository {
  return new ReviewFixtureAdapter(seed)
}

export function createReviewApiAdapter(): ReviewRepository {
  return new ReviewApiAdapter()
}

/** P5 has no API surface yet; this factory intentionally remains fixture-only. */
export function createReviewRepository(seed?: ReviewFixtureSeed): ReviewRepository {
  return new ReviewFixtureAdapter(seed)
}
