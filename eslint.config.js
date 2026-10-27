import baseConfig from './eslint.base.js';
import { coreRules } from './packages/core/eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['packages/core/**/*.{js,mjs,ts}'],
    rules: coreRules,
  },
];
