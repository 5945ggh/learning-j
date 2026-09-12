/**
 * 素材时间戳格式化。
 *
 * 契约：Sentence.time_start / time_end 是毫秒整数（data-model §8.2），仅用于
 * 字幕定位展示；本模块不做播放控制，也不产生任何阅读活动记录。
 */

/** `mm:ss.mmm`；超过一小时用 `h:mm:ss.mmm`（小时不补零）。 */
export function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const millis = milliseconds % 1000
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const mmm = String(millis).padStart(3, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`
}

/** 时间区间；任一端缺失时返回 null（不虚构单端时间）。 */
export function formatTimeRange(
  timeStart: number | null,
  timeEnd: number | null,
): string | null {
  if (timeStart === null || timeEnd === null) return null
  return `${formatTimestamp(timeStart)}–${formatTimestamp(timeEnd)}`
}
