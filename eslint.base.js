import { stripTypeScriptTypes } from 'node:module';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-constant-condition': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    // 原生擦除类型并保留行列位置，无需增加 TypeScript 解析器依赖。
    processor: {
      meta: { name: 'meal-typescript', version: '0.0.0' },
      preprocess(text) {
        return [stripTypeScriptTypes(text)];
      },
      postprocess(messages) {
        return messages.flat();
      },
    },
  },
];
