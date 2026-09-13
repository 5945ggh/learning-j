import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'study' | 'surface' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  study: 'bg-study text-study-foreground hover:bg-study/90',
  surface: 'border border-border bg-card text-foreground hover:bg-muted',
  outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-8 rounded-md px-2.5 text-xs',
  md: 'min-h-9 rounded-md px-3 text-sm',
  lg: 'min-h-10 rounded-md px-4 text-sm',
  icon: 'size-9 rounded-md p-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'surface', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  )
})

