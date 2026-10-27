import { describe, expect, it } from 'vitest';
import { readData } from '../../../data/scripts/load.ts';
import type { Dish } from '../../../data/src/types.ts';
import { normalize } from '../index.ts';
import { parseMealParts } from './meal.ts';
import { normalizeWithOffsets } from '../normalize/index.ts';
import { buildDict, matchAll } from './dict.ts';
import { extractSegments } from './rules.ts';

const { data: recorded } = await readData();
// 只构造字典测试样本，不写入 YAML，也不编造营养数值。
function namedDish(id: string, name: string, aliases: string[] = []): Dish {
  return { id, name, aliases, kind: 'dish', per: '100g', kcal: null, protein: null, carb: null, fat: null,
    portions: [], method: null, source: 'MANUAL', note: '待录入；仅作字典测试样本' };
}
const data = { ...recorded, dishes: [...recorded.dishes,
  namedDish('sanbeiji', '三杯鸡'), namedDish('babaozhou', '八宝粥'),
  namedDish('fuqifeipian', '夫妻肺片'), namedDish('sixiwanzhi', '四喜丸子'),
  namedDish('erguotou', '二锅头'), namedDish('gongbaojiding', '宫保鸡丁', ['宫爆鸡丁']),
  namedDish('huangmenji', '黄焖鸡'), namedDish('huangmenjimifan', '黄焖鸡米饭'),
  namedDish('englishchicken', '英文别名样本', ['Chicken']),
] };
const dict = buildDict(data);

describe('字典前的无损归一化', () => {
  it.each(['三杯鸡', '八宝粥', '夫妻肺片', '四喜丸子', '二锅头', '两百克鸡胸'])('normalize 保留中文数字和菜名：%s', text => {
    expect(normalize(text)).toBe(text);
  });

  it('只转换全角与连续空白，不转换数量', () => {
    expect(normalize('　两百克\t鸡胸\n三杯鸡　')).toBe('两百克 鸡胸 三杯鸡');
  });

  it('normalizeWithOffsets 同样保留中文数字及原始下标', () => {
    const raw = '　八宝粥　 两百克　';
    const source = normalizeWithOffsets(raw);
    expect(source.text).toBe('八宝粥 两百克');
    expect(source.offsets).toHaveLength(source.text.length);
    const start = source.text.indexOf('两');
    const range = source.offsets[start];
    expect(range && raw.slice(range.start, range.end)).toBe('两');
    expect(source.raw).toBe(raw);
  });
});

describe('字典最长匹配', () => {
  it.each([
    ['三杯鸡', '三杯鸡'], ['八宝粥', '八宝粥'], ['夫妻肺片', '夫妻肺片'],
    ['四喜丸子', '四喜丸子'], ['二锅头', '二锅头'],
    ['宫爆鸡丁', '宫保鸡丁'], ['西红柿炒鸡蛋', '番茄炒蛋'],
    ['番茄 炒蛋', '番茄炒蛋'], ['黄焖鸡米饭', '黄焖鸡米饭'],
  ])('%s 命中 %s', (text, name) => {
    expect(matchAll(text, dict).map(match => match.foodName)).toEqual([name]);
  });

  it('命中长词后跳过整个区间，不再产生短词候选', () => {
    const text = '黄焖鸡米饭米饭';
    const matches = matchAll(text, dict);
    expect(matches.map(match => match.foodName)).toEqual(['黄焖鸡米饭', '米饭']);
    expect(matches[0]?.end).toBe(matches[1]?.start);
  });

  it('名称和别名一起按长度比较，避免别名被短名称截断', () => {
    expect(matchAll('西红柿炒鸡蛋', dict)).toEqual([
      { foodId: 'fanqiechaodan', foodName: '番茄炒蛋', span: '西红柿炒鸡蛋', start: 0, end: 6 },
    ]);
  });

  it.each(['CHICKEN', 'chicken', 'ChIcKeN', 'ＣＨＩＣＫＥＮ'])('英文别名大小写不敏感：%s', text => {
    expect(matchAll(text, dict)).toEqual([
      { foodId: 'englishchicken', foodName: '英文别名样本', span: text, start: 0, end: text.length },
    ]);
  });

  it('去空白匹配后，span 和下标仍能指回传入原文', () => {
    const text = 'xx番茄   炒蛋yy';
    const matches = matchAll(text, dict);
    expect(matches).toEqual([
      { foodId: 'fanqiechaodan', foodName: '番茄炒蛋', span: '番茄   炒蛋', start: 2, end: text.length - 2 },
    ]);
    for (const match of matches) expect(text.slice(match.start, match.end)).toBe(match.span);
  });

  it('不自动产生数字别名，3杯鸡不能冒充三杯鸡', () => {
    expect(matchAll('3杯鸡', dict)).toEqual([]);
    expect(data.dishes.find(dish => dish.id === 'sanbeiji')?.aliases).toEqual([]);
  });

  it('未知词不做拼音、编辑距离或同义推导', () => {
    expect(matchAll('sanbeiji 宫爆鸡定 不存在的食物', dict)).toEqual([]);
  });

  it('同一别名映射不同 id 时直接抛错', () => {
    const invalid = { ...recorded, dishes: [namedDish('aaa', '甲', ['共同别名']), namedDish('bbb', '乙', ['共同别名'])] };
    expect(() => buildDict(invalid)).toThrow('别名冲突：「共同别名」同时映射 aaa 和 bbb');
  });

  it('别名与另一个名称冲突时也抛错', () => {
    const invalid = { ...recorded, dishes: [namedDish('aaa', '甲', ['乙']), namedDish('bbb', '乙')] };
    expect(() => buildDict(invalid)).toThrow('别名冲突');
  });

  it('大小写和空白折叠产生的跨食物别名冲突同样拒绝', () => {
    const invalid = { ...recorded, dishes: [namedDish('aaa', '甲', ['Chicken']), namedDish('bbb', '乙', ['C H I C K E N'])] };
    expect(() => buildDict(invalid)).toThrow('别名冲突');
  });

  it('同一食物自己的重复名称不会产生重复命中', () => {
    const own = buildDict({ ...recorded, dishes: [namedDish('aaa', '甲', ['甲'])] });
    expect(matchAll('甲', own)).toHaveLength(1);
  });
});

describe('parseMealParts 的字典优先管线', () => {
  it.each(['三杯鸡', '八宝粥'])('数字菜名 %s 不进入数量解析，也不产生剩余 Segment', name => {
    const result = parseMealParts(name, data);
    expect(result.matches.map(match => match.foodName)).toEqual([name]);
    expect(result.items).toEqual([expect.objectContaining({ foodName: name, raw: name, qty: null, unit: null, grams: null })]);
    expect(result.unresolved).toEqual([]);
  });

  it('整句鸡胸200g 三杯鸡同时命中两个食物，三杯鸡不是鸡加3杯', () => {
    const result = parseMealParts('鸡胸200g 三杯鸡', data);
    expect(result.matches.map(match => match.foodName)).toEqual(['鸡胸', '三杯鸡']);
    expect(result.items).toEqual([
      expect.objectContaining({ foodId: 'jixiong', qty: 200, unit: 'g', grams: 200, raw: '鸡胸200g' }),
      expect.objectContaining({ foodId: 'sanbeiji', qty: null, unit: null, grams: null, raw: '三杯鸡' }),
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('两百克鸡胸仍得到鸡胸200g', () => {
    const result = parseMealParts('两百克鸡胸', data);
    expect(result.items).toEqual([expect.objectContaining({ foodId: 'jixiong', qty: 200, unit: 'g', grams: 200, raw: '两百克鸡胸' })]);
    expect(result.unresolved).toEqual([]);
  });

  it('两碗米饭仍为2碗和300g', () => {
    const result = parseMealParts('两碗米饭', data);
    expect(result.items).toEqual([expect.objectContaining({ foodId: 'mifan', qty: 2, unit: '碗', grams: 300 })]);
    expect(result.unresolved).toEqual([]);
  });

  it.each([
    ['二两牛肉', 'niurou', 2, 'liang', 100],
    ['两斤牛肉', 'niurou', 2, 'jin', 1000],
    ['鸡胸两百克', 'jixiong', 200, 'g', 200],
    ['鸡胸200', 'jixiong', 200, 'g', 200],
  ] as const)('词典拆分后仍保留已有数量能力：%s', (raw, id, qty, unit, grams) => {
    expect(parseMealParts(raw, data).items).toEqual([expect.objectContaining({ foodId: id, qty, unit, grams })]);
  });

  it('两个鸡蛋一杯牛奶的前置数量不会串到同一食物上', () => {
    expect(parseMealParts('两个鸡蛋一杯牛奶', data).items).toEqual([
      expect.objectContaining({ foodId: 'jidan', qty: 2, unit: 'ge', grams: 100 }),
      expect.objectContaining({ foodId: 'niunai', qty: 1, unit: '杯', grams: 250 }),
    ]);
  });

  it('全角和中文数量变化后，仍保留原文并保护后面的数字菜名', () => {
    const raw = '　两百克　鸡胸　三杯鸡　';
    const result = parseMealParts(raw, data);
    expect(result.raw).toBe(raw);
    expect(result.items[0]).toMatchObject({ raw: '两百克　鸡胸', grams: 200 });
    expect(result.items[1]).toMatchObject({ raw: '三杯鸡', qty: null, unit: null });
  });

  it('未命中的食物和数量仍保留原文，不误绑定到已命中的鸡胸', () => {
    const result = parseMealParts('鸡胸 未录入食品200克', data);
    expect(result.items[0]?.qty).toBeNull();
    expect(result.unresolved).toEqual([expect.objectContaining({ raw: '未录入食品200克', qty: 200 })]);
  });

  it.each(['', '！！！', 'ａｂｃ', '1000000', '🍚'])('整句管线边界输入不抛异常：%j', raw => {
    expect(() => parseMealParts(raw, data)).not.toThrow();
    expect(parseMealParts(raw, data).items).toEqual([]);
  });

  it.fails('错误顺序反例：先提取数字再匹配，会丢失三杯鸡的整词身份', () => {
    const corrupted = extractSegments(normalize('三杯鸡'), data)[0]?.span ?? '';
    expect(matchAll(corrupted, dict).map(match => match.foodName)).toEqual(['三杯鸡']);
  });
});
