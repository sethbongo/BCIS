import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', 'release/**', 'database/migrations/**', '.localdb/**', 'data/**', 'test-results/**', 'tests/.tmp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Money must never go through floating-point helpers.
      'no-restricted-syntax': ['error', { selector: "CallExpression[callee.name='parseFloat']", message: 'Do not use parseFloat. Money is integer centavos: use parseMoney from @bcis/shared.' }],
    },
  },
  {
    files: ['source/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // The docs renderer runs inside Electron's CommonJS main process.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Tests and the seed poke at loosely typed JSON responses.
    files: ['tests/**/*.ts', 'database/seeds/**/*.ts', 'source/desktop/src/renderer/src/pages/Subscribers.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
