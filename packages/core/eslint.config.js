import baseConfig from '../../eslint.base.js';

export const coreRules = {
  'no-restricted-imports': ['error', {
    patterns: ['node:*', 'fs', 'path', 'os', 'child_process', 'fs/*', 'path/*', 'os/*', 'child_process/*'],
  }],
  'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'fetch'],
};

export default [
  ...baseConfig,
  {
    files: ['**/*.{js,mjs,ts}'],
    rules: coreRules,
  },
];
