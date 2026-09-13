import {
  fetchLexemeCounts,
  fetchMaterials,
  fetchSentences,
  fetchSidecar,
  type Material,
  type MaterialLexemeCounts,
  type Sentence,
  type Sidecar,
} from '@/lib/materials'
import {
  fixtureEpubMaterial,
  fixtureEpubSentences,
  fixtureLexemeCounts,
  fixtureSidecar,
  fixtureSubtitleMaterial,
  fixtureSubtitleSentences,
  fixtureTextMaterial,
  fixtureTextSentences,
} from '@/lib/material-fixtures'
import {
  cloneFixture,
  type RepositoryMetadata,
  type RepositoryRequestOptions,
  type RepositorySource,
  throwIfAborted,
} from '@/lib/repository-utils'

/**
 * Stable P1 material read contract.  There is intentionally no create/import
 * method here: importing a material has a multipart request and its own
 * lifecycle, while this package only needs the browse/read surface.
 */
export interface MaterialRepository extends RepositoryMetadata {
  listMaterials(options?: RepositoryRequestOptions): Promise<Material[]>
  getMaterial(materialId: string, options?: RepositoryRequestOptions): Promise<Material | null>
  listSentences(materialId: string, options?: RepositoryRequestOptions): Promise<Sentence[]>
  getSidecar(materialId: string, options?: RepositoryRequestOptions): Promise<Sidecar>
  getLexemeCounts(materialId: string, options?: RepositoryRequestOptions): Promise<MaterialLexemeCounts>
}

/** Existing API clients are the only source for real P1 material reads. */
export class MaterialApiAdapter implements MaterialRepository {
  readonly source = 'api' as const
  readonly unstable = false

  listMaterials(options: RepositoryRequestOptions = {}): Promise<Material[]> {
    return fetchMaterials(options.signal)
  }

  async getMaterial(materialId: string, options: RepositoryRequestOptions = {}): Promise<Material | null> {
    const materials = await this.listMaterials(options)
    return materials.find((material) => material.id === materialId) ?? null
  }

  listSentences(materialId: string, options: RepositoryRequestOptions = {}): Promise<Sentence[]> {
    return fetchSentences(materialId, options.signal)
  }

  getSidecar(materialId: string, options: RepositoryRequestOptions = {}): Promise<Sidecar> {
    return fetchSidecar(materialId, options.signal)
  }

  getLexemeCounts(
    materialId: string,
    options: RepositoryRequestOptions = {},
  ): Promise<MaterialLexemeCounts> {
    return fetchLexemeCounts(materialId, options.signal)
  }
}

export type MaterialFixtureSeed = {
  materials?: readonly Material[]
  sentences?: readonly Sentence[]
  sidecars?: readonly Sidecar[]
  lexemeCounts?: readonly MaterialLexemeCounts[]
}

const defaultMaterialFixtureSeed: Required<MaterialFixtureSeed> = {
  materials: [fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial],
  sentences: [...fixtureTextSentences, ...fixtureSubtitleSentences, ...fixtureEpubSentences],
  sidecars: [
    fixtureSidecar,
    {
      material_id: fixtureSubtitleMaterial.id,
      sidecar_generation_id: fixtureSubtitleMaterial.current_sidecar_id ?? 'fixture-subtitle-sidecar',
      content_hash: fixtureSubtitleMaterial.content_hash,
      segmenter_version: fixtureSidecar.segmenter_version,
      tokenizer_version: fixtureSidecar.tokenizer_version,
      analyzer_dict_version: fixtureSidecar.analyzer_dict_version,
      payload: { sentences: [] },
    },
  ],
  lexemeCounts: [
    fixtureLexemeCounts,
    {
      material_id: fixtureSubtitleMaterial.id,
      sidecar_generation_id: fixtureSubtitleMaterial.current_sidecar_id ?? 'fixture-subtitle-sidecar',
      counts: [],
    },
  ],
}

/**
 * P1 browse fixture.  The values are copies of formal frontend fixtures (the
 * generated backend fixture is their contract source); no demo tokenizer or
 * localStorage/reducer state is involved.
 */
export class MaterialFixtureAdapter implements MaterialRepository {
  readonly source = 'fixture' as const
  readonly unstable = false
  private readonly seed: Required<MaterialFixtureSeed>

  constructor(seed: MaterialFixtureSeed = {}) {
    this.seed = {
      materials: Array.from(seed.materials ?? defaultMaterialFixtureSeed.materials),
      sentences: Array.from(seed.sentences ?? defaultMaterialFixtureSeed.sentences),
      sidecars: Array.from(seed.sidecars ?? defaultMaterialFixtureSeed.sidecars),
      lexemeCounts: Array.from(seed.lexemeCounts ?? defaultMaterialFixtureSeed.lexemeCounts),
    }
  }

  async listMaterials(options: RepositoryRequestOptions = {}): Promise<Material[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture([...this.seed.materials])
  }

  async getMaterial(materialId: string, options: RepositoryRequestOptions = {}): Promise<Material | null> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const material = this.seed.materials.find((item) => item.id === materialId)
    return material ? cloneFixture(material) : null
  }

  async listSentences(materialId: string, options: RepositoryRequestOptions = {}): Promise<Sentence[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.sentences.filter((sentence) => sentence.material_id === materialId))
  }

  async getSidecar(materialId: string, options: RepositoryRequestOptions = {}): Promise<Sidecar> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const sidecar = this.seed.sidecars.find((item) => item.material_id === materialId)
    if (!sidecar) throw new Error(`sidecar不存在：${materialId}`)
    return cloneFixture(sidecar)
  }

  async getLexemeCounts(
    materialId: string,
    options: RepositoryRequestOptions = {},
  ): Promise<MaterialLexemeCounts> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const counts = this.seed.lexemeCounts.find((item) => item.material_id === materialId)
    if (!counts) throw new Error(`词频不存在：${materialId}`)
    return cloneFixture(counts)
  }
}

export function createMaterialApiAdapter(): MaterialRepository {
  return new MaterialApiAdapter()
}

export function createMaterialFixtureAdapter(seed?: MaterialFixtureSeed): MaterialRepository {
  return new MaterialFixtureAdapter(seed)
}

/** Select the production API by default; fixture selection is explicit. */
export function createMaterialRepository(
  source: RepositorySource = 'api',
  seed?: MaterialFixtureSeed,
): MaterialRepository {
  return source === 'api' ? new MaterialApiAdapter() : new MaterialFixtureAdapter(seed)
}
