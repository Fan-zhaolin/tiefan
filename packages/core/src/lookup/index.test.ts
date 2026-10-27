import { describe, expect, it } from 'vitest';
import { readData } from '../../../data/scripts/load.ts';
import { nutritionOf, toGrams } from './index.ts';

const { data } = await readData();
const chicken = data.dishes.find(dish => dish.id === 'jixiong');
const stirFry = data.dishes.find(dish => dish.id === 'fanqiechaodan');
if (!chicken || !stirFry) throw new Error('测试缺少原始食物数据');

describe('查表与单位折算', () => {
  it.each([
    ['jixiong', 200, 'g', 200], ['jixiong', 0.2, 'kg', 200],
    ['jidan', 2, 'ge', 100], ['mifan', 2, '碗', 300],
    ['mifan', null, null, 150], ['jixiong', null, null, null],
    ['fanqiechaodan', 0.5, '份', null], ['mifan', 1, '份', null],
    ['jixiong', 0, 'g', null], ['jixiong', -1, 'g', null],
    ['missing', 100, 'g', null],
  ] as const)('%s %s %s 的克数为 %s', (foodId, qty, unit, grams) => {
    expect(toGrams({ qty, unit }, { foodId }, data)).toBe(grams);
  });

  it('营养只按原 YAML 的每100g数值线性缩放', () => {
    expect(nutritionOf(200, chicken)).toEqual({ grams: 200, kcal: 240, protein: 45, carb: 0, fat: 5.2 });
  });

  it('缺营养数据时保留空值，不给番茄炒蛋编数值', () => {
    expect(nutritionOf(320, stirFry)).toBeNull();
  });

  it('热量不从宏量反推，纤维也不加入热量计算', () => {
    // 故意改坏内存副本，只验证计算读取哪个字段，绝不写回 YAML。
    const changed = { ...chicken, protein: 0, carb: 0, fat: 0, fiber: 5 };
    expect(nutritionOf(100, changed)?.kcal).toBe(120);
  });
});
