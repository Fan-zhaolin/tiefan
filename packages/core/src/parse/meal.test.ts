import { describe, expect, it, vi } from 'vitest';
import { readData } from '../../../data/scripts/load.ts';
import type { DataSet } from '../../../data/src/types.ts';
import { parseMeal } from '../index.ts';
import { buildDict } from './dict.ts';

const { data } = await readData();
const empty = { items: [], total: { kcal: null, kcalRange: null, protein: null, carb: null, fat: null } };

describe('MealResult 完整输出契约', () => {
  it('公开结果只含 items 和 total，条目字段完整', () => {
    const result = parseMeal('鸡胸200g', data);
    expect(Object.keys(result).sort()).toEqual(['items', 'total']);
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(['carb', 'confidence', 'fat', 'foodId', 'foodName', 'grams', 'kcal', 'protein', 'qty', 'raw', 'unit']);
    expect(result.items[0]).toEqual({ raw: '鸡胸200g', foodId: 'jixiong', foodName: '鸡胸', qty: 200, unit: 'g', grams: 200,
      kcal: 240, protein: 45, carb: 0, fat: 5.2, confidence: 'exact' });
  });

  it('全 exact 才输出热量点值', () => {
    const result = parseMeal('鸡胸200g 牛肉100g', data);
    expect(result.items.map(item => item.confidence)).toEqual(['exact', 'exact']);
    expect(result.total.kcal).toBe(391);
    expect(result.total.kcalRange).toBeNull();
    expect(result.total.protein).toBeCloseTo(66.6);
  });

  it('固定个体重量存在时两个鸡蛋为exact', () => {
    const result = parseMeal('鸡蛋2个', data);
    expect(result.items[0]).toMatchObject({ grams: 100, confidence: 'exact', kcal: 143 });
    expect(result.total.kcal).toBe(143);
  });

  it('碗是份量估计，区间按合计的0.85和1.15取整', () => {
    const result = parseMeal('一碗米饭', data);
    expect(result.items[0]).toMatchObject({ grams: 150, kcal: 195, confidence: 'estimate' });
    expect(result.total.kcal).toBeNull();
    expect(result.total.kcalRange).toEqual([166, 224]);
  });

  it('精确与估计混合也只给总区间', () => {
    const result = parseMeal('鸡胸200g 米饭一碗', data);
    expect(result.total.kcal).toBeNull();
    expect(result.total.kcalRange).toEqual([370, 500]);
  });

  it.each(['鸡胸200g左右', '大概200g鸡胸', '大概鸡胸200g', '鸡胸200g差不多'])('约数词会传导为estimate：%s', raw => {
    const result = parseMeal(raw, data);
    expect(result.items[0]?.confidence).toBe('estimate');
    expect(result.total.kcal).toBeNull();
    expect(result.total.kcalRange).toEqual([204, 276]);
  });

  it('无份量时只按该食物的首个已录入份量估计', () => {
    expect(parseMeal('米饭', data).items[0]).toMatchObject({ qty: null, unit: null, grams: 150, confidence: 'estimate' });
    expect(parseMeal('鸡胸', data).items[0]?.confidence).toBe('unresolved');
  });

  it('已知菜品缺营养值时仍保留菜名，所有营养与total留空', () => {
    const result = parseMeal('西红柿炒鸡蛋', data);
    expect(result.items[0]).toMatchObject({ foodId: 'fanqiechaodan', foodName: '番茄炒蛋', confidence: 'unresolved', kcal: null, protein: null, carb: null, fat: null });
    expect(result.total).toEqual(empty.total);
  });

  it('没有已定义的份量时不把半份擅自当作半盘', () => {
    expect(parseMeal('番茄炒蛋 半份', data).items[0]).toMatchObject({ foodId: 'fanqiechaodan', qty: 0.5, unit: '份', grams: null, confidence: 'unresolved' });
  });

  it('未知食物保留原文，全部unresolved时total全空', () => {
    const result = parseMeal('未录入食品200g', data);
    expect(result.items).toEqual([expect.objectContaining({ raw: '未录入食品200g', foodId: null, confidence: 'unresolved', kcal: null })]);
    expect(result.total).toEqual(empty.total);
  });

  it('精确条目混有未解析条目时不把小计冒充完整点值', () => {
    expect(parseMeal('鸡胸200g 未录入食品200g', data).total).toEqual(empty.total);
  });

  it('米饭估计份量混有字典未收录的黄焖鸡时，整餐合计五个字段全空', () => {
    expect(data.dishes.some(dish => [dish.name, ...dish.aliases].includes('黄焖鸡'))).toBe(false);
    const result = parseMeal('米饭一碗 黄焖鸡', data);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ qty: 1, unit: '碗', grams: 150 });
    expect(result.items.map(item => item.confidence)).toEqual(['estimate', 'unresolved']);
    expect(result.items[1]?.raw).toBe('黄焖鸡');
    expect(result.total).toEqual(empty.total);
  });

  it('鸡胸精确重量混有字典未收录的黄焖鸡时，整餐合计五个字段全空', () => {
    expect(data.dishes.some(dish => [dish.name, ...dish.aliases].includes('黄焖鸡'))).toBe(false);
    const result = parseMeal('鸡胸200g 黄焖鸡', data);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ grams: 200, confidence: 'exact' });
    expect(result.items[1]).toMatchObject({ raw: '黄焖鸡', confidence: 'unresolved' });
    expect(result.total).toEqual(empty.total);
  });

  it('超单项上界后按2000g查表，并降为estimate', () => {
    const result = parseMeal('鸡胸3000g', data);
    expect(result.items[0]).toMatchObject({ grams: 2000, kcal: 2400, confidence: 'estimate', flag: 'over_limit' });
    expect(result.total.kcalRange).toEqual([2040, 2760]);
  });

  it('一拳或一碗的超界裁剪传导到confidence和营养值', () => {
    for (const [unit, grams, limit] of [['拳', 300, 260], ['碗', 500, 400]] as const) {
      // 故意改坏内存中的份量，以验证运行时上界；不写回 YAML。
      const changed = structuredClone(data);
      const rice = changed.dishes.find(dish => dish.id === 'mifan');
      if (!rice) throw new Error('测试缺少米饭');
      rice.portions = [{ unit, grams }];
      expect(parseMeal(`一${unit}米饭`, changed).items[0]).toMatchObject({ grams: limit, confidence: 'estimate', flag: 'over_limit' });
    }
  });

  it.each(['', '！！！', '！！！？？？。。。。', 'ａｂｃ', '1000000', '🍚', '吃了点东西', '跟朋友吃了顿饭'])('无实体或边界输入返回空结果：%j', raw => {
    expect(() => parseMeal(raw, data)).not.toThrow();
    expect(parseMeal(raw, data)).toEqual(empty);
  });

  it('十万字输入不得抛异常，返回合法MealResult', () => {
    const raw = '字'.repeat(100000);
    expect(() => parseMeal(raw, data)).not.toThrow();
    const result = parseMeal(raw, data);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.total).toEqual(empty.total);
  });

  it('任意内部异常返回空结果，同时console.warn而不throw', () => {
    const broken = { get dishes() { throw new Error('故意制造读取失败'); } } as unknown as DataSet;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseMeal('鸡胸200g', broken)).toEqual(empty);
      expect(warning).toHaveBeenCalledTimes(1);
    } finally { warning.mockRestore(); }
  });

  it('字典按DataSet对象引用复用，新引用重新构建', () => {
    expect(buildDict(data)).toBe(buildDict(data));
    expect(buildDict({ ...data })).not.toBe(buildDict(data));
  });
});
