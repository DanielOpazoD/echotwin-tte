import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** The engine, the clinical layer, the cases, education and the math core (docs/ARCHITECTURE.md). */
const ENGINE_FILES = [
  'src/simulator/**/*.ts',
  'src/clinical/**/*.ts',
  'src/education/**/*.ts',
  'src/cases/**/*.ts',
  'src/core/**/*.ts',
];
/** None of them depends on the React application, the UI, the workers or the store (audit A9, 2026-09-16). */
const ENGINE_FENCE = [
  {
    group: ['@/app', '@/app/*', '**/app/*'],
    message: 'the engine must not import the application layer',
  },
  { group: ['@/ui', '@/ui/*', '**/ui/*'], message: 'the engine must not import the UI' },
  { group: ['@/workers/*', '**/workers/*'], message: 'the engine must not import workers' },
  { group: ['zustand', 'react', 'react-dom'], message: 'the engine is framework-free' },
];
/** The clinical layer (formulas, guidelines, reference values) is leaf data any layer may read. */
const CLINICAL_LEAF = [
  {
    group: ['@/simulator/*', '@/education/*', '@/cases', '@/cases/*'],
    message: 'src/clinical is a leaf layer: it must not import the engine, the cases or education',
  },
];
/** The engine below education never depends on education (technique result types live in measurements/types). */
const NO_EDUCATION = [
  { group: ['@/education', '@/education/*'], message: 'the engine must not import education' },
];
/** The renderer forms images; the Doppler engine consumes its frames, never the other way round. */
const RENDERER_NO_DOPPLER = [
  {
    group: ['@/simulator/doppler/*', '**/doppler/*'],
    message: 'the renderer must not import the Doppler engine',
  },
];
/** The math core depends on nothing inside src/ (ARCHITECTURE.md: «Importa de: —»). */
const CORE_LEAF = [
  { group: ['@/*', '../*'], message: 'src/core must not import from other layers' },
];
/** A layer block: every pattern set that applies to these files, merged, since a later block would replace them. */
const fence = (files, ...sets) => ({
  files,
  ignores: ['**/*.test.ts', '**/*.test.tsx'],
  rules: { 'no-restricted-imports': ['error', { patterns: sets.flat() }] },
});

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
  // Layer boundaries (docs/ARCHITECTURE.md), one block per set of files, each carrying every pattern that applies to
  // them. In a flat config the last block that matches a file REPLACES the options of `no-restricted-imports`: the
  // finer blocks of commit fb267c2 silently erased the engine fence of commit 8ca5af9, both of 2026-09-16, and React,
  // zustand or the store could be imported into the engine with no error (decision 154).
  // src/tests/layerLint.test.ts checks the resolved rule of a file of every layer.
  fence(ENGINE_FILES, ENGINE_FENCE),
  fence(['src/clinical/**/*.ts'], ENGINE_FENCE, CLINICAL_LEAF),
  fence(['src/simulator/**/*.ts', 'src/cases/**/*.ts'], ENGINE_FENCE, NO_EDUCATION),
  fence(['src/simulator/renderer/**/*.ts'], ENGINE_FENCE, NO_EDUCATION, RENDERER_NO_DOPPLER),
  fence(['src/core/**/*.ts'], ENGINE_FENCE, CORE_LEAF),
);
