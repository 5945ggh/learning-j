import { describe, expect, it } from 'vitest'
import { asSentenceText, codePointLength, sliceByCodePoint } from './text'

describe('codePointLength', () => {
  it('BMP 外字符计 1 而不是 2', () => {
    expect(codePointLength('𠮟られた')).toBe(4)
    expect(codePointLength('𩸽定食')).toBe(3)
    expect(codePointLength('')).toBe(0)
  })
})

describe('sliceByCodePoint', () => {
  it('按 code point 而不是 UTF-16 unit 切片', () => {
    // 「𠮟」是代理对；裸 String.prototype.slice(0, 1) 会得到半个字符。
    expect(sliceByCodePoint('𠮟られた', 0, 1)).toBe('𠮟')
    expect(sliceByCodePoint('𠮟られた', 1, 3)).toBe('られ')
    expect(sliceByCodePoint('𠮟られた', 0, 4)).toBe('𠮟られた')
  })

  it('BMP 外字符位于句中时切片仍不产生孤立代理对', () => {
    expect(sliceByCodePoint('abc𠮟def', 2, 5)).toBe('c𠮟d')
    expect(sliceByCodePoint('𩸽定食', 0, 1)).toBe('𩸽')
    expect(sliceByCodePoint('𩸽定食', 1)).toBe('定食')
  })

  it('负值下标与 String.prototype.slice 语义一致，但按 code point 计数', () => {
    expect(sliceByCodePoint('こんにちは', -2)).toBe('ちは')
    expect(sliceByCodePoint('こんにちは', 0, -2)).toBe('こんに')
    expect(sliceByCodePoint('こんにちは', -3, -1)).toBe('にち')
    expect(sliceByCodePoint('𠮟られた', -1)).toBe('た')
  })

  it('越界与空区间收敛为空串', () => {
    expect(sliceByCodePoint('あ', 5, 10)).toBe('')
    expect(sliceByCodePoint('あいう', 2, 1)).toBe('')
    expect(sliceByCodePoint('あいう', 1, 1)).toBe('')
    expect(sliceByCodePoint('', 0, 1)).toBe('')
  })

  it('ZWJ emoji 按 code point 拆分（项目契约是 code point，不是字素簇）', () => {
    // 👨‍👩‍👦 = 5 个 code point（3 个人物 + 2 个 ZWJ）。
    // 切在成员之间会得到合法但更小的字符，这是契约允许的行为，关键是不产生孤立代理对。
    const family = '👨‍👩‍👦あ'
    expect(codePointLength(family)).toBe(6)
    expect(sliceByCodePoint(family, 0, 1)).toHaveLength(2) // 👨：高+低代理，仍成对
    expect(sliceByCodePoint(family, 5)).toBe('あ')
  })

  it('与 Array.from 的 code point 索引一致（性质测试抽样）', () => {
    const samples = ['𠮟られた', '所属長と𠮟られる', 'a𠮟b𩸽c', '普通の文章。']
    for (const text of samples) {
      const codePoints = Array.from(text)
      for (let start = 0; start <= codePoints.length; start += 1) {
        for (let end = start; end <= codePoints.length; end += 1) {
          expect(sliceByCodePoint(text, start, end)).toBe(codePoints.slice(start, end).join(''))
        }
      }
    }
  })
})

describe('asSentenceText', () => {
  it('标记类型不改变运行时行为', () => {
    const sentence = asSentenceText('𠮟られた')
    expect(sentence).toBe('𠮟られた')
    expect(sliceByCodePoint(sentence, 0, 1)).toBe('𠮟')
  })
})
