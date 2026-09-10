import { useEffect, useState } from 'react'
import { MaterialList } from '@/components/MaterialList'
import { SentenceList } from '@/components/SentenceList'
import { SentenceContext } from '@/components/SentenceContext'
import { fetchMaterials, fetchSentences, type Material, type Sentence } from '@/lib/materials'

export function MaterialWorkspace() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selected, setSelected] = useState<Material | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [loading, setLoading] = useState(true)
  const [sentenceLoading, setSentenceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentenceError, setSentenceError] = useState<string | null>(null)
  const [selectedSentence, setSelectedSentence] = useState<Sentence | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchMaterials(controller.signal)
      .then((items) => {
        setMaterials(items)
        setSelected((current) => current ?? items[0] ?? null)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setError(cause instanceof Error ? cause.message : '素材加载失败')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selected) {
      setSelectedSentence(null)
      setSentences([])
      return
    }
    setSelectedSentence(null)
    const controller = new AbortController()
    setSentenceLoading(true)
    setSentenceError(null)
    fetchSentences(selected.id, controller.signal)
      .then(setSentences)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setSentenceError(cause instanceof Error ? cause.message : '句子加载失败')
      })
      .finally(() => setSentenceLoading(false))
    return () => controller.abort()
  }, [selected])

  function selectSentence(sentence: Sentence) {
    setSelectedSentence(sentence)
  }

  if (loading) return <p className="p-6 text-sm text-muted-foreground">正在加载素材…</p>
  if (error) return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}<p className="mt-1 text-muted-foreground">素材浏览不依赖 BYOK；请确认本地后端已启动后重试。</p></div>

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(220px,0.32fr)_minmax(0,1fr)]">
      <aside className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Library</h2>
        <MaterialList materials={materials} selectedId={selected?.id ?? null} onSelect={setSelected} />
      </aside>
      <section className="min-w-0 space-y-6">
        {sentenceLoading ? <p className="p-4 text-sm text-muted-foreground">正在加载句子…</p> : sentenceError ? <p role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">{sentenceError}</p> : <SentenceList material={selected} sentences={sentences} selectedId={selectedSentence?.id} onSelect={selectSentence} />}
        {selectedSentence ? <SentenceContext sentence={selectedSentence} /> : null}
      </section>
    </div>
  )
}
