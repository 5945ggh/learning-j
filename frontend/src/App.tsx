import { useEffect, useState } from 'react'
import { MaterialWorkspace } from '@/shells/MaterialWorkspace'

type Theme = 'light' | 'dark'

const themeStorageKey = 'learningj-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'

  try {
    const stored = window.localStorage.getItem(themeStorageKey)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Fall back to the system preference when storage is unavailable.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 最小可运行入口（P0 骨架）。
 *
 * reader / review 两个 shell 在 P2 / P5 落地并挂进这里；独立组件一律放在
 * src/components/，不得反向 import src/shells/（ADR-023，由 ESLint 强制）。
 */
function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme

    try {
      window.localStorage.setItem(themeStorageKey, theme)
    } catch {
      // Theme switching still works for the current session without storage.
    }
  }, [theme])

  return (
    <main className="mx-auto min-h-dvh max-w-7xl px-6 py-8 lg:px-10">
      <header className="mb-8 flex items-end justify-between gap-4 border-b border-border pb-5">
        <div><p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">LearningJ / Library</p><h1 className="mt-2 font-serif-jp text-3xl tracking-wide">素材浏览</h1></div>
        <div className="flex items-end gap-4">
          <p className="hidden text-right text-sm text-muted-foreground sm:block">源文优先 · 句子定位保留 · 无需 BYOK</p>
          <button
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {theme === 'dark' ? '浅色模式' : '深色模式'}
          </button>
        </div>
      </header>
      <MaterialWorkspace />
    </main>
  )
}

export default App
