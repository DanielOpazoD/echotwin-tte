import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules', 'public'] },
  js.configs.recommended,
  // type-aware rules (engineering audit, B8): no-floating-promises, no-misused-promises, unsafe-* and the
  // unnecessary-assertion family need the type checker; the project service reuses tsconfig.json
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // plain JS config files are not part of the TypeScript project
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // see the WEBGL_lose_context call: the linter's type resolution of that overload is not deterministic
    files: ['src/simulator/renderer/gpu/webgl2Renderer.ts'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
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
      // structure and tissue ids travel packed in Uint8Arrays and shader textures by design (renderer/types.ts), so
      // they are compared as plain numbers against the Tissue/Structure enums everywhere; the rule only adds noise
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Clinical logic must not live in UI components: UI may import from clinical/ (read-only data)
    // but must not import formulas directly; it goes through simulator/measurements.
    files: ['src/ui/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/clinical/formulas', '**/clinical/formulas/*'] },
      ],
      // A component that subscribes to the whole store re-renders on every change of any field (probe
      // motion, cine, fps). Select the fields it reads, with `useShallow` when it needs several
      // (docs/AUDITORIA_INGENIERIA.md, B-selectores; done for the 13 components on 2026-09-16).
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='useSimStore'][arguments.length=0]",
          message:
            'Suscríbete a los campos que usa el componente: useSimStore((s) => s.x) o useSimStore(useShallow((s) => ({ ... }))).',
        },
      ],
    },
  },
  {
    // Layer boundary (docs/ARCHITECTURE.md): the engine, the clinical layer, the cases, education
    // and the math core never depend on the React application, the UI, the workers or the store.
    // This held on 2026-09-16 (docs/AUDITORIA_INGENIERIA.md, A9); the rule keeps it that way. The blocks below
    // add the finer boundaries, and src/tests/layers.test.ts proves the whole layer graph is acyclic.
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
    // The clinical layer (formulas, guidelines, reference values) is leaf data any layer may read; it must not
    // reach back into the engine, the cases or the education layer (the report that did moved to education).
    files: ['src/clinical/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/simulator/*',
                '@/education/*',
                '@/cases',
                '@/cases/*',
                '@/app/*',
                '@/ui/*',
              ],
              message:
                'src/clinical is a leaf layer: it must not import the engine, the cases or education',
            },
          ],
        },
      ],
    },
  },
  {
    // The engine below education never depends on education (technique result types live in measurements/types).
    files: ['src/simulator/**/*.ts', 'src/cases/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/education', '@/education/*'],
              message: 'the engine must not import education',
            },
          ],
        },
      ],
    },
  },
  {
    // The renderer forms images; the Doppler engine consumes its frames, never the other way round.
    files: ['src/simulator/renderer/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/simulator/doppler/*', '**/doppler/*'],
              message: 'the renderer must not import the Doppler engine',
            },
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
