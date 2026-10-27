import { describe, expect, it } from 'vitest';
import { readData } from '../../data/scripts/load.ts';
import { displayWidth, formatMeals, parseMeal } from './index.ts';

const { data } = await readData();
const format = (raw: string) => formatMeals([{ time: '12:40', result: parseMeal(raw, data) }]);

describe('displayWidth', () => {
  it.each([['鸡胸', 4], ['200g', 4], ['约', 2]] as const)('displayWidth(%s) === %i', (text, width) => {
    expect(displayWidth(text)).toBe(width);
  });

  it('按码点而非 UTF-16 长度计数，阈值严格大于 0x2E80', () => {
    expect(displayWidth('')).toBe(0);
    expect(displayWidth(String.fromCodePoint(0x2E80))).toBe(1);
    expect(displayWidth(String.fromCodePoint(0x2E81))).toBe(2);
    expect(displayWidth('𠀀')).toBe(2);
    expect(displayWidth('Ａ！')).toBe(4);
  });
});

describe('共享输出格式', () => {
  it('中文与数字混排后，五列及宏量数字仍对齐', () => {
    const [chicken = '', rice = '', separator = '', total = ''] = format('鸡胸200g 米饭一碗').split('\n');
    for (const [row, name, quantity, kcal, protein] of [[chicken, '鸡胸', '200g', '240', 'P45'], [rice, '米饭', '一碗', '约195', 'P4']] as const) {
      expect(row.startsWith('12:40  ')).toBe(true);
      expect(displayWidth(row.slice(0, row.indexOf(name)))).toBe(7);
      expect(displayWidth(row.slice(0, row.indexOf(quantity)))).toBe(20);
      expect(displayWidth(row.slice(0, row.indexOf(kcal) + kcal.length))).toBe(35);
      expect(displayWidth(row.slice(0, row.indexOf(protein)))).toBe(36);
    }
    expect(displayWidth(chicken.slice(0, chicken.indexOf('C')))).toBe(displayWidth(rice.slice(0, rice.indexOf('C'))));
    expect(displayWidth(chicken.slice(0, chicken.indexOf('F')))).toBe(displayWidth(rice.slice(0, rice.indexOf('F'))));
    expect(chicken).toContain('P45 C0  F5');
    expect(rice).toContain('P4  C42 F0');
    expect(separator).toBe('─'.repeat(34));
    expect(total.trimEnd()).toMatch(/^今天 +约 370–500$/u);
    expect(displayWidth(total)).toBe(35);
  });

  it.each(['米饭一碗 黄焖鸡', '鸡胸200g 黄焖鸡'])('混有未知项时不显示合计数字：%s', raw => {
    const text = format(raw);
    expect(text.split('\n').at(-1)).toBe('合计不可用：有 1 项没认出');
    expect(text).not.toMatch(/null|undefined/u);
    expect(text).not.toMatch(/^今天/mu);
  });

  it('未解析项保留原文与空值占位，不把空营养打印成零', () => {
    const text = format('米饭一碗 黄焖鸡');
    expect(text).toContain('黄焖鸡');
    expect(text).toContain('P— C—');
    expect(text).not.toContain('P0 C0 F0');
  });

  it('多餐汇总仍复用整餐合计规则，未解析数量按条目计数', () => {
    const entries = [
      { time: '08:00', result: parseMeal('鸡胸200g 黄焖鸡', data) },
      { time: '12:40', result: parseMeal('米饭一碗 未录入菜品', data) },
    ];
    expect(formatMeals(entries).split('\n').at(-1)).toBe('合计不可用：有 2 项没认出');
  });

  it('精确合计不加约，显示时四舍五入且不改变原结果', () => {
    const result = parseMeal('鸡胸200g', data);
    const before = structuredClone(result);
    expect(formatMeals([{ time: '12:40', result }]).split('\n').at(-1)).toMatch(/^今天 +240$/u);
    expect(result).toEqual(before);
  });
});
