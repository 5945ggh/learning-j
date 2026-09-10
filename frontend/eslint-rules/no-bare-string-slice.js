import ts from 'typescript'

/**
 * learningj/no-bare-string-slice
 *
 * 禁止对字符串使用裸 `String.prototype.slice / substring / substr`。
 * 这些方法按 UTF-16 code unit 切分，会把 BMP 外字符（如「𠮟」「𩸽」）切成
 * 孤立代理对，违反项目「字符偏移使用 Unicode code point」硬约束（审查 A5）。
 * 字符串切片一律使用 `src/lib/text.ts` 的 `sliceByCodePoint()`。
 *
 * 通过 type-aware 检查实现：仅当接收者类型为 string（含字面量与联合中的
 * string 成员）时报告；`Array.prototype.slice` 等数组切片不受影响。
 * 因此本规则不需要、也不提供任何豁免配置。
 */

const SLICE_FAMILY = new Set(['slice', 'substring', 'substr'])

function isStringLike(type) {
  if (!type) return false
  if (typeof type.isUnion === 'function' && type.isUnion()) return type.types.some(isStringLike)
  if (typeof type.isIntersection === 'function' && type.isIntersection()) {
    return type.types.some(isStringLike)
  }
  return (type.flags & ts.TypeFlags.StringLike) !== 0
}

export const noBareStringSlice = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '字符串上的裸 slice/substring/substr 按 UTF-16 unit 切分；必须使用 lib/text 的 sliceByCodePoint（code point 偏移）。',
    },
    schema: [],
    messages: {
      bareSlice:
        "裸 '.{{method}}' 按 UTF-16 code unit 切分字符串，会切碎 BMP 外字符（如「𠮟」）。" +
        '字符串切片请使用 src/lib/text.ts 的 sliceByCodePoint()（code point 偏移）；数组切片不受影响。',
    },
  },

  create(context) {
    const services = context.sourceCode?.parserServices
    if (!services?.program || typeof services.getTypeAtLocation !== 'function') return {}

    return {
      CallExpression(node) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) return
        const property = callee.property
        if (!property || property.type !== 'Identifier' || !SLICE_FAMILY.has(property.name)) return
        if (isStringLike(services.getTypeAtLocation(callee.object))) {
          context.report({
            node: property,
            messageId: 'bareSlice',
            data: { method: property.name },
          })
        }
      },
    }
  },
}
