import { describe, expect, it } from 'vitest';
import { readData } from '../../../data/scripts/load.ts';
import { normalize } from '../normalize/index.ts';
import { gramsFor } from '../normalize/units.ts';
import { extractSegments, prepareRuleText } from './rules.ts';

const { data } = await readData();
const extract = (raw: string) => extractSegments(normalize(raw), data, raw);

describe('规则层 L1', () => {
  it.each([
    ['鸡胸200g', 200, 'g'], ['鸡胸 200 克', 200, 'g'],
    ['200g鸡胸', 200, 'g'], ['200克鸡胸', 200, 'g'],
    ['鸡胸200', 200, 'g'], ['二两牛肉', 2, 'liang'],
    ['半斤虾', 0.5, 'jin'], ['鸡胸两百克', 200, 'g'],
    ['两个鸡蛋', 2, 'ge'], ['鸡蛋2个', 2, 'ge'],
    ['一碗米饭', 1, '碗'], ['半份番茄炒蛋', 0.5, '份'],
    ['一拳头米饭', 1, '拳'], ['0.2kg鸡胸', 0.2, 'kg'],
    ['0.2公斤鸡胸', 0.2, 'kg'], ['鸡胸２００Ｇ', 200, 'g'],
    ['牛奶250ML', 250, 'ml'],
  ] as const)('%s 正确识别数量和标准单位', (raw, qty, unit) => {
    const segments = extract(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ qty, unit, raw });
  });

  it('无份量的菜名保留原文，不猜数量', () => {
    expect(extract('黄焖鸡')).toEqual([{ span: '黄焖鸡', raw: '黄焖鸡', qty: null, unit: null, start: 0, end: 3 }]);
  });

  it.each([
    ['鸡胸200g左右', '鸡胸200g'], ['大概200克鸡胸', '200克鸡胸'],
    ['约200g', '200g'], ['差不多鸡胸200克', '鸡胸200克'],
    ['鸡胸大概200g', '鸡胸200g'],
  ])('去掉约数词但保留 approx 和原文：%s', (raw, span) => {
    expect(extract(raw)).toEqual([expect.objectContaining({ span, raw, qty: 200, unit: 'g', approx: true })]);
  });

  it.each([
    ['一小碗米饭', 0.7, '碗'], ['一中碗米饭', 1, '碗'],
    ['一大盘番茄炒蛋', 1.4, '盘'], ['两份番茄炒蛋', 2, '份'],
    ['三份燕麦', 3, '份'],
  ] as const)('只按规格的份量倍数缩放：%s', (raw, qty, unit) => {
    expect(extract(raw)).toEqual([expect.objectContaining({ qty, unit })]);
  });

  it('同句后置数量分别归属各片段', () => {
    expect(extract('鸡胸200g 米饭一碗')).toEqual([
      expect.objectContaining({ span: '鸡胸200g', raw: '鸡胸200g', qty: 200, unit: 'g' }),
      expect.objectContaining({ span: '米饭1碗', raw: '米饭一碗', qty: 1, unit: '碗' }),
    ]);
  });

  it('同句前置数量分别归属各片段', () => {
    expect(extract('200g鸡胸 100g牛肉')).toEqual([
      expect.objectContaining({ span: '200g鸡胸', qty: 200, unit: 'g' }),
      expect.objectContaining({ span: '100g牛肉', qty: 100, unit: 'g' }),
    ]);
  });

  it('保留重复食物片段', () => {
    expect(extract('鸡蛋2个 鸡蛋1个').map(segment => segment.qty)).toEqual([2, 1]);
  });

  it('约数标记不会污染相邻的精确片段', () => {
    const segments = extract('鸡胸200g左右 米饭1碗');
    expect(segments[0]?.approx).toBe(true);
    expect(segments[1]?.approx).toBeUndefined();
  });

  it('中文数字和全角归一化后仍保留每段原文及下标', () => {
    const raw = '　鸡胸两百克，米饭　一碗　';
    const normalized = prepareRuleText(raw).text;
    const segments = extractSegments(normalized, data, raw);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.raw).toBe('鸡胸两百克');
    expect(segments[1]?.raw).toBe('米饭　一碗');
    for (const segment of segments) expect(normalized.slice(segment.start, segment.end)).toBe(segment.span);
  });

  it('单位别名来自注入数据，不另写固定别名表', () => {
    const changed = structuredClone(data);
    const unit = changed.units.find(unit => unit.id === 'g');
    if (!unit) throw new Error('测试缺少克单位');
    unit.aliases.push('测试克');
    expect(extractSegments(normalize('鸡胸200测试克'), changed)[0]).toMatchObject({ qty: 200, unit: 'g' });
  });
});

describe('「两」消歧与实际克数', () => {
  it('二两牛肉最终为 100g', () => {
    const segment = extract('二两牛肉')[0];
    expect(segment).toMatchObject({ qty: 2, unit: 'liang' });
    expect(gramsFor(segment?.qty ?? null, segment?.unit ?? null, data)).toBe(100);
  });

  it('两碗米饭为 2 碗，按数据中的份量最终为 300g', () => {
    const segment = extract('两碗米饭')[0];
    expect(segment).toMatchObject({ qty: 2, unit: '碗' });
    const rice = data.dishes.find(dish => dish.id === 'mifan');
    expect(gramsFor(segment?.qty ?? null, segment?.unit ?? null, data, rice?.portions)).toBe(300);
  });

  it('两百克最终为 200g', () => {
    const segment = extract('两百克')[0];
    expect(segment).toMatchObject({ qty: 200, unit: 'g' });
    expect(gramsFor(segment?.qty ?? null, segment?.unit ?? null, data)).toBe(200);
  });

  it('两斤最终为 1000g', () => {
    const segment = extract('两斤')[0];
    expect(segment).toMatchObject({ qty: 2, unit: 'jin' });
    expect(gramsFor(segment?.qty ?? null, segment?.unit ?? null, data)).toBe(1000);
  });

  it('换算系数只取注入的单位表', () => {
    const changed = structuredClone(data);
    const unit = changed.units.find(unit => unit.id === 'liang');
    if (!unit) throw new Error('测试缺少两单位');
    unit.grams = 60;
    expect(gramsFor(2, 'liang', changed)).toBe(120);
  });

  it('个数依赖食物份量，缺少份量时不猜克数', () => {
    const segment = extract('两个鸡蛋')[0];
    const egg = data.dishes.find(dish => dish.id === 'jidan');
    expect(gramsFor(segment?.qty ?? null, segment?.unit ?? null, data, egg?.portions)).toBe(100);
    expect(gramsFor(2, 'ge', data)).toBeNull();
    expect(gramsFor(1, '未知单位', data)).toBeNull();
  });

  it.each([null, -1, Infinity, NaN])('非法数量不产生克数：%j', qty => {
    expect(gramsFor(qty, 'g', data)).toBeNull();
  });
});

describe('任意输入的降级路径', () => {
  it.each(['', '！！！', 'ａｂｃ', '1000000', '1', 'g', '🍚'])('边界输入返回空数组且不抛异常：%j', raw => {
    expect(() => extract(raw)).not.toThrow();
    expect(extract(raw)).toEqual([]);
  });

  it('重复 1000 次的长串不抛异常、不丢失可识别片段', () => {
    const raw = '鸡胸200g '.repeat(1000);
    expect(() => extract(raw)).not.toThrow();
    const segments = extract(raw);
    expect(segments).toHaveLength(1000);
    expect(segments[0]?.qty).toBe(200);
    expect(segments[999]?.qty).toBe(200);
  });

  it('重复 1000 次的乱码长串返回空数组', () => {
    const raw = '！！！ａｂｃ1000000 '.repeat(1000);
    expect(() => extract(raw)).not.toThrow();
    expect(extract(raw)).toEqual([]);
  });
});
