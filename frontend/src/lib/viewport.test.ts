import { describe, expect, it } from 'vitest'
import { LOOKUP_BREAKPOINTS, resolveLookupVariant } from './viewport'

describe('查词面板响应式形态（DESIGN.md 响应式行为）', () => {
  it('宽屏（≥1180px）使用右侧抽屉', () => {
    expect(resolveLookupVariant(1180)).toBe('drawer')
    expect(resolveLookupVariant(1440)).toBe('drawer')
  })

  it('紧凑布局（760–1179px）使用锚定 popover', () => {
    expect(resolveLookupVariant(1179)).toBe('popover')
    expect(resolveLookupVariant(760)).toBe('popover')
    expect(resolveLookupVariant(1024)).toBe('popover')
  })

  it('移动断点以下（<760px）使用底部面板 sheet', () => {
    expect(resolveLookupVariant(759)).toBe('sheet')
    expect(resolveLookupVariant(360)).toBe('sheet')
  })

  it('断点取值与 DESIGN.md 的 1180/760 一致', () => {
    expect(LOOKUP_BREAKPOINTS.drawer).toBe(1180)
    expect(LOOKUP_BREAKPOINTS.popover).toBe(760)
  })
})
