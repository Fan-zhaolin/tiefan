import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
let directory: string;
let sequence = 0;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'meal-cli-test-')); });
afterAll(async () => {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('meal-cli-test-')) throw new Error('测试清理目录越界');
  await rm(target, { recursive: true, force: true });
});

function run(args: string[], home = join(directory, String(sequence++)), input = '', program = entry) {
  const result = spawnSync(process.execPath, [program, ...args], {
    cwd: directory, encoding: 'utf8', input, timeout: 10000,
    env: { ...process.env, MEAL_HOME: home },
  });
  expect(result.error).toBeUndefined();
  return { ...result, home };
}

describe('CLI 实际进程', () => {
  it('默认追加原始输入日志，严格只写 t 和 raw', async () => {
    const result = run(['鸡胸200g 米饭一碗']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/今天 +约 370–500/u);
    const files = await readdir(result.home);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/u);
    const text = await readFile(join(result.home, files[0] ?? ''), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ t: expect.stringMatching(/^\d{2}:\d{2}$/u), raw: '鸡胸200g 米饭一碗' });
  });

  it('多次调用只追加，不重写记录；today 按记录顺序显示并合计', async () => {
    const first = run(['鸡胸200g']);
    const second = run(['牛肉100g'], first.home);
    expect(second.status).toBe(0);
    const files = await readdir(first.home);
    const lines = (await readFile(join(first.home, files[0] ?? ''), 'utf8')).trim().split('\n');
    expect(lines.map(line => JSON.parse(line).raw)).toEqual(['鸡胸200g', '牛肉100g']);
    const today = run(['today'], first.home);
    expect(today.status).toBe(0);
    expect(today.stdout.indexOf('鸡胸')).toBeLessThan(today.stdout.indexOf('牛肉'));
    expect(today.stdout).toMatch(/今天 +391\n$/u);
  });

  it('混有未知项时保存原文，today 也不显示偏小的小计', () => {
    const parsed = run(['米饭一碗 黄焖鸡']);
    expect(parsed.status).toBe(0);
    expect(parsed.stdout).toMatch(/合计不可用：有 1 项没认出\n$/u);
    expect(parsed.stdout).not.toMatch(/null|undefined/u);
    const today = run(['today'], parsed.home);
    expect(today.stdout).toMatch(/合计不可用：有 1 项没认出\n$/u);
    expect(today.status).toBe(0);
  });

  it('today 只按原文和当前食物库重算，不采信旧日志里的结果数值', async () => {
    const saved = run(['鸡胸200g']);
    const files = await readdir(saved.home);
    // 故意在旧日志放入错误快照，确认读取时完全忽略这些字段。
    await writeFile(join(saved.home, files[0] ?? ''), `${JSON.stringify({ t: '12:40', raw: '鸡胸200g', kcal: 9999, p: 999, c: 999, f: 999, src: 'dish' })}\n`);
    const result = run(['today'], saved.home);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/今天 +240\n$/u);
    expect(result.stdout).not.toContain('999');
  });

  it('--dry 只算不创建目录，--json 只向 stdout 输出 MealResult', async () => {
    const result = run(['--dry', '--json', '鸡胸200g']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ items: [expect.objectContaining({ grams: 200, confidence: 'exact' })], total: { kcal: 240, kcalRange: null } });
    await expect(readdir(result.home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['', '！！！', 'ａｂｃ', '吃了点东西', '1000000'])('空输入或解析失败仍为退出码 0：%j', raw => {
    const result = run([raw]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`没认出是什么。原文：${raw}\n`);
  });

  it('十万字输入仍为退出码 0', () => {
    const result = run([], join(directory, 'long-input'), `${'字'.repeat(100000)}\n\n`);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('没认出是什么。原文：');
  });

  it('无参数逐行处理 stdin，遇空行退出，不处理后面的内容', async () => {
    const result = run([], join(directory, 'interactive'), '鸡胸200g\n米饭一碗\n\n牛肉100g\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('鸡胸');
    expect(result.stdout).toContain('米饭');
    expect(result.stdout).not.toContain('牛肉');
    const files = await readdir(result.home);
    const lines = (await readFile(join(result.home, files[0] ?? ''), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('无参数且 stdin 为空时正常退出', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('目录不可写时仍显示计算结果且退出码为 0', async () => {
    const blocked = join(directory, 'blocked-home');
    await writeFile(blocked, '用文件占住目录路径');
    const result = run(['鸡胸200g'], blocked);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^记不下来，但算出来了：\n/u);
    expect(result.stdout).toMatch(/今天 +240\n$/u);
    const json = run(['--json', '鸡胸200g'], blocked);
    expect(json.status).toBe(0);
    expect(json.stderr).toBe('记不下来，但算出来了：\n');
    expect(JSON.parse(json.stdout).total.kcal).toBe(240);
  });

  it('export 逐文件原样输出，不解析 JSON、不混入其它文件', async () => {
    const home = join(directory, 'export');
    await mkdir(home);
    await writeFile(join(home, '2026-10-27.jsonl'), ' {"raw":"米饭"}\n\n');
    await writeFile(join(home, '2026-10-26.jsonl'), '{"raw":"鸡胸"}\r\n');
    await writeFile(join(home, 'ignore.txt'), '不能导出');
    const files = (await readdir(home)).filter(file => file.endsWith('.jsonl'));
    const expected = (await Promise.all(files.map(file => readFile(join(home, file), 'utf8')))).join('');
    const result = run(['export'], home);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
  });

  it('记录不存在或单行损坏时不抛异常、不改源文件', async () => {
    const missing = run(['today']);
    expect(missing.status).toBe(0);
    expect(missing.stdout).toBe('今天还没有记录。\n');
    const exported = run(['export']);
    expect(exported.status).toBe(0);
    expect(exported.stdout).toBe('');
    const saved = run(['鸡胸200g']);
    const files = await readdir(saved.home);
    const file = join(saved.home, files[0] ?? '');
    await writeFile(file, '坏掉的 JSON\n{"raw":"鸡胸200g","t":"12:40"}\n');
    const original = await readFile(file, 'utf8');
    const result = run(['today'], saved.home);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('有一条记录读不出来，已保留原文件。\n');
    expect(result.stdout).toMatch(/今天 +240\n$/u);
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('唯一的非零退出是未知子命令，help 为 0', () => {
    const unknown = run(['unknown']);
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toBe('未知子命令：unknown\n');
    const help = run(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('用法：meal');
    const option = run(['--unknown']);
    expect(option.status).toBe(0);
    expect(option.stdout).toBe('未知参数：--unknown\n');
  });

  it('把单文件产物放进空目录仍可算，证明数据和 core 已内联', async () => {
    const isolated = join(directory, 'standalone');
    await mkdir(isolated);
    const program = join(isolated, 'meal.mjs');
    await copyFile(entry, program);
    const result = run(['--dry', '--json', '鸡胸200g'], join(isolated, 'home'), '', program);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).total.kcal).toBe(240);
    const code = await readFile(program, 'utf8');
    expect(code).not.toContain('acceptance');
    expect(code).not.toMatch(/from ['"]@meal\//u);
  });
});
