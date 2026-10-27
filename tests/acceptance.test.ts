import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readData } from '../packages/data/scripts/load.ts';
import { missingDataFor, skipReasonFor } from '../packages/data/src/rules.ts';
import { parseMeal } from '../packages/core/src/index.ts';

const { data } = await readData();
const fixtures = data.acceptance ?? [];
const skipped = fixtures.filter(fixture => fixture.skip === true).length;
let passed = 0;
let failed = 0;
const names = new Map(data.dishes.flatMap(dish => [dish.name, ...dish.aliases].map(name => [name, dish.id] as const)));

describe('原始验收用例', () => {
  for (const fixture of fixtures) {
    const run = fixture.skip === true ? it.skip : it;
    run(`${fixture.id} ${fixture.input || '空输入'}${fixture.skip ? `（${fixture.skip_reason}）` : ''}`, () => {
      try {
        expect(missingDataFor(fixture, data)).toEqual([]);
        const result = parseMeal(fixture.input, data);
        expect(Object.keys(result).sort()).toEqual(['items', 'total']);
        const expected = fixture.expect;
        if (expected.foods !== undefined) {
          expect(result.items.filter(item => item.foodId !== null).map(item => item.foodId))
            .toEqual(expected.foods.map(food => names.get(food)));
        }
        if (expected.unresolved !== undefined) expect(result.items.filter(item => item.confidence === 'unresolved')).toHaveLength(expected.unresolved);
        for (const food of expected.must_be_exact ?? []) {
          expect(result.items.find(item => item.foodId === names.get(food))?.confidence).toBe('exact');
        }
        if (expected.kcal != null) expect(result.total.kcal).toBe(expected.kcal);
        if (expected.kcal_range != null) {
          expect(result.total.kcalRange).not.toBeNull();
          expect(result.total.kcalRange?.[0]).toBeLessThanOrEqual(expected.kcal_range[0]);
          expect(result.total.kcalRange?.[1]).toBeGreaterThanOrEqual(expected.kcal_range[1]);
        }
        passed += 1;
      } catch (error) {
        failed += 1;
        throw error;
      }
    });
  }
  afterAll(() => {
    process.stdout.write(`验收：${passed} 通过 / ${skipped} 跳过 / ${failed} 失败（文档 30 条 + 原有基础 5 条）\n`);
  });
});

it('没有删掉基础用例，文档30条的 input 和 expect 原样保留', async () => {
  const doc = await readFile(new URL('../docs/测试用例.md', import.meta.url), 'utf8');
  const block = [...doc.matchAll(/```yaml\r?\n([\s\S]*?)```/gu)].map(match => match[1] ?? '')
    .map(text => parse(text) as typeof fixtures).find(cases => cases.length === 30);
  expect(block).toHaveLength(30);
  expect(fixtures).toHaveLength(35);
  expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(35);
  expect(fixtures.filter(fixture => fixture.id.startsWith('data-')).map(fixture => fixture.id))
    .toEqual(['data-jixiong', 'data-mifan', 'data-jidan', 'data-niunai', 'data-fanqiechaodan']);
  for (const source of block ?? []) {
    const actual = fixtures.find(fixture => fixture.id === source.id);
    expect(actual?.input).toBe(source.input);
    expect(actual?.expect).toEqual(source.expect);
  }
});

it('所有 skip 都有真实且准确的数据缺口，已具备数据的用例不得跳过', () => {
  for (const fixture of fixtures) {
    const missing = missingDataFor(fixture, data);
    expect(fixture.skip === true).toBe(missing.length > 0);
    if (fixture.skip) expect(fixture.skip_reason).toBe(skipReasonFor(missing));
  }
});
