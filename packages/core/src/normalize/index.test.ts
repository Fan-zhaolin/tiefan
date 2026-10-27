import { describe, expect, it } from 'vitest';
import { cnNumber, normalizeCnNumbers } from './cnnumber.ts';
import { toHalfWidth } from './fullwidth.ts';
import { normalize } from './index.ts';
import { prepareRuleText } from '../parse/rules.ts';

describe('全角与空白归一化', () => {
  it('按规格转换数字、大小写字母、点、斜杠和全角空格', () => {
    expect(toHalfWidth('０１２３４５６７８９ ＡＢＣＸＹＺ ａｂｃｘｙｚ ．／　'))
      .toBe('0123456789 ABCXYZ abcxyz ./ ');
  });

  it('其它中文、标点和表情保持原样', () => {
    expect(toHalfWidth('鸡胸！🍚')).toBe('鸡胸！🍚');
  });

  it('规则层预处理保留原有的全角、中文数量和空白行为', () => {
    expect(prepareRuleText('　鸡胸\t两百克\n 米饭　１碗　').text).toBe('鸡胸 200克 米饭 1碗');
  });

  it.each(['', ' ', '\t\n　'])('空输入与纯空白返回空字符串：%j', raw => {
    expect(normalize(raw)).toBe('');
  });

  it('规则层数量转换后保留长度变化和空白折叠的原文位置', () => {
    const raw = '　鸡胸  两百克　';
    const source = prepareRuleText(raw);
    expect(source.text).toBe('鸡胸 200克');
    expect(source.raw).toBe(raw);
    expect(source.offsets).toHaveLength(source.text.length);
    const numberStart = source.text.indexOf('200');
    const range = source.offsets[numberStart];
    expect(range && raw.slice(range.start, range.end)).toBe('两百');
    const space = source.offsets[source.text.indexOf(' ')];
    expect(space && raw.slice(space.start, space.end)).toBe('  ');
  });
});

describe('自实现的中文数字', () => {
  it.each([
    ['两百', 200], ['一百五', 150], ['两百五', 250],
    ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4], ['五', 5],
    ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10],
    ['十一', 11], ['二十', 20], ['二十三', 23], ['百', 100],
    ['一百', 100], ['一百五十', 150], ['两百一十五', 215], ['半', 0.5],
  ] as const)('%s = %s', (raw, expected) => {
    expect(cnNumber(raw)).toBe(expected);
  });

  it.each(['', 'abc', '一半', '一二', '两百百'])('未定义的数字形式保持不可解析：%j', raw => {
    expect(cnNumber(raw)).toBeNull();
  });

  it.each([
    ['二两牛肉', '2两牛肉'], ['2 两牛肉', '2 两牛肉'],
    ['两碗米饭', '2碗米饭'], ['两百克', '200克'], ['两斤', '2斤'],
    ['半斤虾', '0.5斤虾'], ['鸡胸两百五克', '鸡胸250克'],
  ])('中文数字归一化保留重量单位：%s', (raw, expected) => {
    expect(normalizeCnNumbers(raw)).toBe(expected);
  });
});
