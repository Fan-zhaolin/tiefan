import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { loadData } from './load.ts';

try {
  // 先校验再写产物，避免错误源数据覆盖已有构建结果。
  const { data, fileCount } = await loadData();
  const outputDirectory = new URL('../dist/', import.meta.url);
  const json = JSON.stringify(data, null, 2);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(new URL('data.json', outputDirectory), `${json}\n`);
  await copyFile(new URL('../src/types.ts', import.meta.url), new URL('types.ts', outputDirectory));
  await writeFile(new URL('index.ts', outputDirectory),
    `// 由 YAML 自动生成，请勿手改。\nimport type { DataSet } from './types.ts';\nexport type { Source, Kind, Dish, Unit, Method, DataSet } from './types.ts';\nexport const data: DataSet = ${json};\nexport default data;\n`);
  console.log(`构建完成：${fileCount} 个食物、${data.units.length} 个单位、${data.methods.length} 个做法。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
