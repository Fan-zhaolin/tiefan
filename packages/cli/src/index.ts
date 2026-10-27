#!/usr/bin/env node
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { formatMeals, parseMeal } from '@meal/core';
import data from '@meal/data';

interface RecordLine {
  t: string;
  raw: string;
}

const output = (text: string): void => { process.stdout.write(`${text}\n`); };
const storage = (): string => process.env.MEAL_HOME || join(homedir(), '.meal');
function dateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function record(raw: string, dry: boolean, json: boolean): Promise<void> {
  const result = parseMeal(raw, data);
  if (!result.items.some(item => item.foodId !== null)) {
    output(json ? JSON.stringify(result) : `没认出是什么。原文：${raw}`);
    return;
  }
  const now = new Date();
  const time = now.toTimeString().slice(0, 5);
  if (!dry) {
    const line: RecordLine = { t: time, raw };
    try {
      await mkdir(storage(), { recursive: true });
      await appendFile(join(storage(), `${dateKey(now)}.jsonl`), `${JSON.stringify(line)}\n`);
    } catch {
      if (json) process.stderr.write('记不下来，但算出来了：\n');
      else output('记不下来，但算出来了：');
    }
  }
  output(json ? JSON.stringify(result) : formatMeals([{ time, result }]));
}

async function today(): Promise<void> {
  let text: string;
  try { text = await readFile(join(storage(), `${dateKey()}.jsonl`), 'utf8'); }
  catch (error) {
    output((error as NodeJS.ErrnoException).code === 'ENOENT' ? '今天还没有记录。' : '暂时读不到今天的记录。');
    return;
  }
  const entries = [];
  for (const line of text.split(/\r?\n/u).filter(line => line.trim() !== '')) {
    try {
      const saved: unknown = JSON.parse(line);
      if (typeof saved !== 'object' || saved === null || !('raw' in saved) || typeof saved.raw !== 'string' ||
        !('t' in saved) || typeof saved.t !== 'string') throw new Error('记录格式不完整');
      entries.push({ time: saved.t, result: parseMeal(saved.raw, data) });
    } catch { process.stderr.write('有一条记录读不出来，已保留原文件。\n'); }
  }
  output(entries.length === 0 ? '今天还没有记录。' : formatMeals(entries));
}

async function exportRecords(): Promise<void> {
  try {
    // 保留目录枚举顺序及文件原文，不排序、不重新序列化。
    const files = await readdir(storage(), { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      try { process.stdout.write(await readFile(join(storage(), file.name), 'utf8')); }
      catch { process.stderr.write(`暂时读不到记录：${file.name}\n`); }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') process.stderr.write('暂时读不到记录目录。\n');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.includes('--help')) {
    output('用法：meal [--dry] [--json] "吃了什么"\n      meal today\n      meal export\n无参数时逐行读取输入，空行退出。');
    return;
  }
  const unknown = args.find(arg => arg.startsWith('--') && arg !== '--dry' && arg !== '--json');
  const values = args.filter(arg => arg !== '--dry' && arg !== '--json');
  const command = values[0];
  if (unknown) { output(`未知参数：${unknown}`); return; }
  if (command !== undefined && /^[a-z][a-z-]*$/iu.test(command) && command !== 'today' && command !== 'export') {
    output(`未知子命令：${command}`);
    process.exitCode = 1;
    return;
  }
  if (command === 'today') { await today(); return; }
  if (command === 'export') { await exportRecords(); return; }
  if (values.length > 0) { await record(values.join(' '), args.includes('--dry'), args.includes('--json')); return; }
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (line.trim() === '') break;
      await record(line, args.includes('--dry'), args.includes('--json'));
    }
  } finally { reader.close(); }
}

// 管道提前关闭或读取失败也不向用户抛异常。
process.stdout.on('error', () => { process.exitCode = 0; });
process.stderr.on('error', () => { process.exitCode = 0; });
try { await main(); }
catch { output('暂时无法处理这次输入。'); }
