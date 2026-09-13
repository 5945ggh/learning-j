import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'study' | 'lexical' | 'syntax' | 'success' | 'warning' | 'plain'

const toneClass: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  study: 'bg-study/15 text-study',
  lexical: 'bg-lexical/15 text-lexical',
  syntax: 'bg-syntax/20 text-syntax-foreground',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  plain: 'text-muted-foreground',
}

export type BadgeProps = ComponentProps<'span'> & { tone?: BadgeTone }

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-5', toneClass[tone], className)}
      {...props}
    />
  )
}

