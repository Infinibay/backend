module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'standard'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: [
    '@typescript-eslint'
  ],
  rules: {
    // TypeScript specific rules
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // Standard JavaScript rules adjustments for TypeScript
    'no-unused-vars': 'off', // Use TypeScript version instead
    'no-undef': 'off', // TypeScript handles this

    // Code style rules
    'indent': ['error', 2],
    'quotes': ['error', 'single'],
    'semi': ['error', 'never'],
    'comma-dangle': ['error', 'never'],
    'space-before-function-paren': ['error', 'always']
  },
  overrides: [
    {
      files: ['app/**/*.ts'],
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    {
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off'
      }
    }
  ],
  ignorePatterns: [
    'dist/**',
    'node_modules/**',
    'lib/**/*.node'
  ]
}
