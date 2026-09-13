import { useTheme } from '@/app/theme'
import { PageFrame, PageHeader, PAGE_PADDING, Panel, PlaceholderNote, UnavailableBadge } from '@/screens/Page'

export function SettingsScreen() {
  const { theme, toggleTheme } = useTheme()

  return (
    <PageFrame>
      <PageHeader title="设置" subtitle="应用级偏好设置；阅读器显示设置留在 ReaderShell。" />
      <div className={`${PAGE_PADDING} flex flex-col gap-4`}>
        <Panel title="外观">
          <div className="flex items-center justify-between gap-4 px-4 py-4">
            <div>
              <h2 className="text-sm font-medium">主题</h2>
              <p className="mt-1 text-xs text-muted-foreground">当前：{theme === 'dark' ? '深色' : '浅色'}</p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              切换主题
            </button>
          </div>
        </Panel>
        <Panel title="连接与提供方">
          <div className="flex items-center justify-between gap-4 px-4 py-4">
            <div>
              <h2 className="text-sm font-medium">BYOK / Agent 提供方</h2>
              <p className="mt-1 text-xs text-muted-foreground">配置与能力检测将在 P3a 接入；浏览与算法阅读不依赖 BYOK。</p>
            </div>
            <UnavailableBadge />
          </div>
        </Panel>
        <PlaceholderNote>设置不会修改素材、Sentence、Lexeme 裁定或学习事实。</PlaceholderNote>
      </div>
    </PageFrame>
  )
}

