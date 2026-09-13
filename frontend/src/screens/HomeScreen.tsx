import { Link } from 'react-router-dom'
import { PageFrame, PageHeader, PAGE_PADDING, PlaceholderNote } from '@/screens/Page'

/**
 * Homepage stays intentionally honest until product decision §15.23 closes.
 * It provides orientation and entry points without turning queue or return
 * position into an invented dashboard.
 */
export function HomeScreen() {
  return (
    <PageFrame>
      <PageHeader
        eyebrow="LearningJ"
        title="主页"
        subtitle="这里保留入口与当前产品边界；主页默认聚合内容待定义。"
      />
      <div className={`${PAGE_PADDING} flex flex-col gap-4`}>
        <PlaceholderNote>
          <strong className="font-medium text-foreground">主页内容待定义。</strong>{' '}
          主页暂不推断阅读进度、未完成会话或掌握度。请从已定义的入口继续工作。
        </PlaceholderNote>

        <div className="grid gap-3 min-[760px]:grid-cols-3">
          <Link to="/library" className="group rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-xs text-muted-foreground">素材库</span>
            <span className="mt-2 block text-base font-medium group-hover:underline">浏览原文与视听素材</span>
            <span className="mt-1 block text-xs text-muted-foreground">P1/P2 真实 API</span>
          </Link>
          <Link to="/queue" className="group rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-xs text-muted-foreground">解析队列</span>
            <span className="mt-2 block text-base font-medium group-hover:underline">继续学习会话</span>
            <span className="mt-1 block text-xs text-muted-foreground">P3+ fixture 状态</span>
          </Link>
          <Link to="/center" className="group rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-xs text-muted-foreground">学习中心</span>
            <span className="mt-2 block text-base font-medium group-hover:underline">查看学习计划与记录</span>
            <span className="mt-1 block text-xs text-muted-foreground">排程面待后端接入</span>
          </Link>
        </div>
      </div>
    </PageFrame>
  )
}

