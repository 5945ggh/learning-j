import { describe, expect, it } from 'vitest'
import { formatTimeRange, formatTimestamp } from './time'

describe('formatTimestamp', () => {
  it('一分钟以内按 mm:ss.mmm 展示', () => {
    expect(formatTimestamp(0)).toBe('00:00.000')
    expect(formatTimestamp(1000)).toBe('00:01.000')
    expect(formatTimestamp(4200)).toBe('00:04.200')
    expect(formatTimestamp(59999)).toBe('00:59.999')
  })

  it('超过一小时切换为 h:mm:ss.mmm', () => {
    expect(formatTimestamp(60_000)).toBe('01:00.000')
    expect(formatTimestamp(3_661_000)).toBe('1:01:01.000')
    expect(formatTimestamp(9_723_456)).toBe('2:42:03.456')
  })
})

describe('formatTimeRange', () => {
  it('两端齐全时返回闭区间展示', () => {
    expect(formatTimeRange(1000, 4200)).toBe('00:01.000–00:04.200')
  })

  it('任一端缺失时返回 null，不虚构单端时间', () => {
    expect(formatTimeRange(null, 4200)).toBeNull()
    expect(formatTimeRange(1000, null)).toBeNull()
    expect(formatTimeRange(null, null)).toBeNull()
  })
})
