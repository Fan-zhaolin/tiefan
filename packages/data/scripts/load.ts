import { readdir, readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { checkAll } from '../src/rules.ts';
import type { DataSet } from '../src/types.ts';

const dataDirectory = new URL('../', import.meta.url);

async function readYaml(file: URL): Promise<unknown> {
  try {
    return parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`读取 ${file.pathname} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readData() {
  const dishDirectory = new URL('dishes/', dataDirectory);
  const files = (await readdir(dishDirectory)).filter(file => /\.ya?ml$/u.test(file)).sort();
  const [dishes, units, methods, acceptance] = await Promise.all([
    Promise.all(files.map(file => readYaml(new URL(file, dishDirectory)))),
    readYaml(new URL('units.yaml', dataDirectory)),
    readYaml(new URL('methods.yaml', dataDirectory)),
    readYaml(new URL('../../tests/fixtures/acceptance.yaml', dataDirectory)),
  ]);
  // YAML 的类型断言不替代校验；CLI、测试和构建均交给 checkAll 判断。
  return { data: { dishes, units, methods, acceptance } as DataSet, fileCount: files.length };
}

export async function loadData() {
  const { data, fileCount } = await readData();
  const failures = checkAll(data).filter(result => !result.ok);
  if (failures.length > 0) throw new Error(`${failures.map(result => result.msg).join('\n')}\n校验失败：${failures.length} 项`);
  // 验收语料只是校验上下文，不进入营养数据构建产物。
  return { data: { dishes: data.dishes, units: data.units, methods: data.methods }, fileCount };
}
