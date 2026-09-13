import type { ReactNode } from 'react'
import {
  BookMarked,
  GraduationCap,
  House,
  Library,
  ListChecks,
  Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  path: string
  icon: LucideIcon
  match: (pathname: string) => boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: '主页', path: '/', icon: House, match: (pathname) => pathname === '/' },
  {
    label: '素材库',
    path: '/library',
    icon: Library,
    match: (pathname) => pathname === '/library' || pathname.startsWith('/material/'),
  },
  {
    label: '知识库',
    path: '/knowledge',
    icon: BookMarked,
    match: (pathname) => pathname === '/knowledge',
  },
  {
    label: '解析队列',
    path: '/queue',
    icon: ListChecks,
    match: (pathname) => pathname === '/queue',
  },
  {
    label: '学习中心',
    path: '/center',
    icon: GraduationCap,
    match: (pathname) => pathname === '/center',
  },
]

function NavigationLink({ item, pathname, mobile = false }: { item: NavItem; pathname: string; mobile?: boolean }) {
  const Icon = item.icon
  const current = item.match(pathname)

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      aria-current={current ? 'page' : undefined}
      title={item.label}
      className={cn(
        'flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        'text-muted-foreground hover:bg-muted hover:text-foreground',
        'max-[1179px]:justify-center max-[1179px]:px-0',
        mobile && 'w-auto shrink-0 px-2.5',
        current && 'bg-muted font-medium text-foreground shadow-sm',
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={current ? 2.1 : 1.8} aria-hidden="true" />
      <span className={mobile ? 'whitespace-nowrap text-xs' : 'truncate max-[1179px]:hidden'}>{item.label}</span>
    </NavLink>
  )
}

/**
 * Shared navigation shell for the five product entries and settings.
 *
 * ≥1180px keeps labels in a wide rail, 760–1179px keeps an icon rail, and
 * <760px keeps product navigation in a horizontally scrollable top bar and
 * places settings in its own bottom navigation region.
 * The shell owns only navigation/layout state; page data remains in screens.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const settingsCurrent = pathname === '/settings'

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground min-[760px]:h-dvh">
      <header aria-label="主导航" className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card/90 px-2 py-1.5 backdrop-blur-xl min-[760px]:hidden">
        {NAV_ITEMS.map((item) => <NavigationLink key={item.path} item={item} pathname={pathname} mobile />)}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-16 shrink-0 flex-col border-r border-border bg-card/75 px-2 py-3 backdrop-blur-xl min-[760px]:flex min-[1180px]:w-[216px] min-[1180px]:px-3">
          <div className="px-2.5 pb-4 max-[1179px]:hidden">
            <div className="text-[15px] font-semibold tracking-tight">LearningJ</div>
            <div className="text-[11px] text-muted-foreground">源文优先的学习工作区</div>
          </div>

          <nav aria-label="主导航" className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => <NavigationLink key={item.path} item={item} pathname={pathname} />)}
          </nav>

          <div className="mt-auto border-t border-border pt-2">
            <NavLink
              to="/settings"
              aria-current={settingsCurrent ? 'page' : undefined}
              title="设置"
              className={cn(
                'flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                'max-[1179px]:justify-center max-[1179px]:px-0',
                settingsCurrent && 'bg-muted font-medium text-foreground shadow-sm',
              )}
            >
              <Settings className="size-[18px] shrink-0" strokeWidth={settingsCurrent ? 2.1 : 1.8} aria-hidden="true" />
              <span className="truncate max-[1179px]:hidden">设置</span>
            </NavLink>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <nav aria-label="设置导航" className="border-t border-border bg-card/90 px-2 py-1.5 backdrop-blur-xl min-[760px]:hidden">
        <NavLink
          to="/settings"
          aria-current={settingsCurrent ? 'page' : undefined}
          title="设置"
          className={cn(
            'flex min-h-10 w-full items-center justify-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
            settingsCurrent && 'bg-muted font-medium text-foreground shadow-sm',
          )}
        >
          <Settings className="size-[18px]" aria-hidden="true" />
          <span>设置</span>
        </NavLink>
      </nav>
    </div>
  )
}
