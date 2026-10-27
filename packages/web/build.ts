import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [fileURLToPath(new URL('src/main.ts', import.meta.url))],
  tsconfig: fileURLToPath(new URL('tsconfig.json', import.meta.url)),
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  minify: true, charset: 'utf8', legalComments: 'none',
});
const script = result.outputFiles[0]?.text;
if (!script) throw new Error('没有生成 Web 脚本');
const [template, css] = await Promise.all([
  readFile(new URL('index.html', import.meta.url), 'utf8'),
  readFile(new URL('src/style.css', import.meta.url), 'utf8'),
]);
const html = template.replace('<!-- APP_CSS -->', () => `<style>${css}</style>`)
  .replace('<!-- APP_JS -->', () => `<script>${script.replace(/<\/script/giu, '<\\/script')}</script>`);
if (/https?:\/\//iu.test(html)) throw new Error('单文件产物含有外链');
const bytes = Buffer.byteLength(html);
if (bytes >= 150 * 1024) throw new Error('单文件产物超过 150KB');
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await writeFile(new URL('dist/index.html', import.meta.url), html);
console.log(`Web 构建完成：${bytes} 字节（单个 index.html）。`);
