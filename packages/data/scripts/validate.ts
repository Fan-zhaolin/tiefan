import { readData } from './load.ts';
import { checkAll } from '../src/rules.ts';

try {
  const { data, fileCount } = await readData();
  const results = checkAll(data);
  const failures = results.filter(result => !result.ok);
  const visible = failures.length > 0 ? failures : results;
  for (const result of visible.filter(result => result.msg)) console.log(result.msg);
  console.log(failures.length > 0 ? `校验失败：${failures.length} 项` : `校验通过：${fileCount} 个文件`);
  process.exitCode = Number(failures.length > 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
