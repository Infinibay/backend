const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'lib/**/*.node',
      'coverage/**',
      'prisma/generated/**',
      '**/*.d.ts',
      'tmp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      indent: ['error', 2],
      quotes: ['error', 'single'],
      semi: ['error', 'never'],
      'comma-dangle': ['error', 'never'],
      'space-before-function-paren': ['error', 'always'],
    },
  },
  {
    files: ['app/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
