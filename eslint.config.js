import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'examples/*/dist/', 'test-results/', 'playwright-report/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['examples/react-app/vite.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/client/**', 'src/box/ui/**', 'examples/react-app/src/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      '**/*.mjs',
      '**/*.js',
      'src/box/*.ts',
      'src/vite/**',
      'src/server/**',
      'e2e/**',
      '*.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Scripts that hand functions to the browser through Playwright.
    files: ['scripts/demo/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Vitest's asymmetric matchers, such as expect.stringContaining, are typed `any`.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
);
