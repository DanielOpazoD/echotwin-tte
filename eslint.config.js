import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // plain Node scripts (CI helpers) outside the TypeScript sources
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Clinical logic must not live in UI components: UI may import from clinical/ (read-only data)
    // but must not import formulas directly; it goes through simulator/measurements.
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/clinical/formulas', '**/clinical/formulas/*'] },
      ],
    },
  },
  {
    // Layer boundary (docs/ARCHITECTURE.md): the engine, the clinical layer, the cases, education
    // and the math core never depend on the React application, the UI, the workers or the store.
    // This held on 2026-09-16 (docs/AUDITORIA_INGENIERIA.md, A9); the rule keeps it that way.
    // The remaining boundaries of the table (e.g. clinical ↛ simulator) are not enforced yet
    // because the code violates them today (finding B1); tighten this list as each cycle is broken.
    files: [
      'src/simulator/**/*.ts',
      'src/clinical/**/*.ts',
      'src/education/**/*.ts',
      'src/cases/**/*.ts',
      'src/core/**/*.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app', '@/app/*', '**/app/*'],
              message: 'the engine must not import the application layer',
            },
            { group: ['@/ui', '@/ui/*', '**/ui/*'], message: 'the engine must not import the UI' },
            {
              group: ['@/workers/*', '**/workers/*'],
              message: 'the engine must not import workers',
            },
            { group: ['zustand', 'react', 'react-dom'], message: 'the engine is framework-free' },
          ],
        },
      ],
    },
  },
  {
    // The math core depends on nothing inside src/ (ARCHITECTURE.md: «Importa de: —»).
    files: ['src/core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/*', '../*'], message: 'src/core must not import from other layers' },
          ],
        },
      ],
    },
  },
);
