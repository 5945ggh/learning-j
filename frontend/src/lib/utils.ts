import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui 约定的类名合并工具。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
