import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import { noBareStringSlice } from './eslint-rules/no-bare-string-slice.js'

const learningjPlugin = { rules: { 'no-bare-string-slice': noBareStringSlice } }

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
      learningj: learningjPlugin,
    },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ADR-023 的自动化形式：组件不得反向依赖 shell。
      // P5 验收（复习视图不改任何组件装配出来）依赖这条规则全程生效。
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/components',
              from: './src/shells',
              message:
                '组件不得 import src/shells/**（ADR-023）：组件独立于 shell，由 shell 装配组件；所需数据一律通过 props 传入。',
            },
          ],
        },
      ],

      // 审查 A5 / 项目硬约束：字符串切片必须走 code point（sliceByCodePoint）。
      'learningj/no-bare-string-slice': 'error',
    },
  },
  {
    // ADR-023 的第二道栅栏：组件不读取路由。路由与 shell 内部状态只存在于
    // shell 层；这是 import 来源级的限制，覆盖未来的 react-router 与任何
    // 相对路径引用 shells 的形式，与上面的 zones 规则互为补充。
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react-router', 'react-router-dom', '**/shells', '**/shells/*'],
              message: '组件不得依赖路由或 shell（ADR-023）；所需数据一律通过 props 传入。',
            },
          ],
        },
      ],
    },
  },
)
