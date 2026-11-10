// One config for server/ and frontend/. It is not type-aware (no `projectService`): typescript-eslint
// reads the code with the TypeScript installed here (6.0), and the two workspaces compile with 7, so
// type-aware rules would parse their tsconfig files with a compiler that is not theirs.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    'server/src/generated/',
    'server/prisma/migrations/',
    'frontend/src/routeTree.gen.ts',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    rules: {
      // The same convention as `noUnusedParameters` in both tsconfig files: a name that starts with `_`
      // is there on purpose (a parameter a signature needs, a property taken out of an object).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // `declare global { namespace Express { ... } }` is how Express's `Request` is extended.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },

  {
    files: ['server/**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'better-tailwindcss': betterTailwind },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'frontend/src/styles/index.css',
        // The classes of a look that varies live in a lookup object (`const sizes = { sm: '...' }`, see
        // "Conventions" in frontend.doc.md), not in a className, so the plugin is pointed at those too.
        selectors: [
          { kind: 'attribute', name: '^class(Name)?$', match: [{ type: 'strings' }] },
          { kind: 'variable', name: '^(variants|sizes|tones|layouts)$', match: [{ type: 'objectValues' }] },
        ],
      },
    },
    rules: {
      // Only the two classic rules. The `recommended` set of eslint-plugin-react-hooks 7 adds rules written for the
      // React Compiler, and they reported `ref={scroll.containerRef}` in Conversation.tsx (passing on a ref
      // that a hook returns), which is fine.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Tailwind drops a class it does not know without a word. The order of the classes is Prettier's job
      // (prettier-plugin-tailwindcss), so the order and wrapping rules of this plugin stay off.
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
    },
  },
]);
