import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use Select from @/components/ui/select instead of a raw <select>.',
        },
      ],
    },
  },
  {
    // Legacy files that still use a raw <select>: remove a file from this list when it is migrated.
    files: ['src/pages/CategorizePage.tsx', 'src/pages/SettingsPage.tsx', 'src/pages/YnabPage.tsx'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use Select from @/components/ui/select instead of a raw <select>.',
        },
      ],
    },
  },
  {
    // shadcn files export variant helpers next to their components.
    files: ['src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
