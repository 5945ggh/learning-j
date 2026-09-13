import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  createKnowledgeFixtureAdapter,
  createKnowledgeApiAdapter,
  createMaterialApiAdapter,
  createMaterialFixtureAdapter,
  createReaderFixtureAdapter,
  createReaderApiAdapter,
  createReviewApiAdapter,
  createReviewFixtureAdapter,
  createStudyApiAdapter,
  createStudyFixtureAdapter,
  type KnowledgeRepository,
  type MaterialRepository,
  type ReaderRepository,
  type ReviewRepository,
  type StudyRepository,
} from '@/lib/repositories'
import {
  createFixtureComposition,
  createFixtureResolvingMaterialRepository,
  createFixtureResolvingReaderRepository,
} from '@/lib/fixture-composition'

/**
 * Application data boundary. P1/P2 production reads stay on the real API;
 * P3+ fixtures use a namespaced resolver so their sources never collide with
 * real Material IDs from another dataset.
 */
export type AppRepositories = {
  materials: MaterialRepository
  reader: ReaderRepository
  study: StudyRepository
  knowledge: KnowledgeRepository
  review: ReviewRepository
}

export function createDefaultRepositories(): AppRepositories {
  const fixture = createFixtureComposition()
  return {
    materials: createFixtureResolvingMaterialRepository(fixture.materials),
    // P1/P2 reader surfaces stay API-backed. The resolver only translates the
    // known composed fixture namespace to raw endpoint IDs when the material
    // list has proved that fixture by content hash.
    reader: createFixtureResolvingReaderRepository(),
    study: createStudyFixtureAdapter(fixture.study),
    knowledge: createKnowledgeFixtureAdapter(fixture.knowledge),
    review: createReviewFixtureAdapter(fixture.review),
  }
}

/** Useful for isolated UI tests and offline previews; every source remains explicit. */
export function createFixtureRepositories(): AppRepositories {
  const fixture = createFixtureComposition()
  return {
    materials: createMaterialFixtureAdapter(fixture.materials),
    reader: createReaderFixtureAdapter(fixture.reader),
    study: createStudyFixtureAdapter(fixture.study),
    knowledge: createKnowledgeFixtureAdapter(fixture.knowledge),
    review: createReviewFixtureAdapter(fixture.review),
  }
}

/** API-shaped bundle; P3+ adapters reject explicitly until their endpoints exist. */
export function createApiRepositories(): AppRepositories {
  return {
    materials: createMaterialApiAdapter(),
    reader: createReaderApiAdapter(),
    study: createStudyApiAdapter(),
    knowledge: createKnowledgeApiAdapter(),
    review: createReviewApiAdapter(),
  }
}

const defaultRepositories = createDefaultRepositories()
const RepositoryContext = createContext<AppRepositories>(defaultRepositories)

export function RepositoryProvider({
  children,
  repositories,
}: {
  children: ReactNode
  repositories?: Partial<AppRepositories>
}) {
  const value = useMemo<AppRepositories>(() => ({
    ...defaultRepositories,
    ...repositories,
  }), [repositories])
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>
}

export function useRepositories(): AppRepositories {
  return useContext(RepositoryContext)
}
