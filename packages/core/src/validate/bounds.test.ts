import { describe, expect, it } from 'vitest';
import { readData } from '../../../data/scripts/load.ts';
import { applyBounds, portionUpperLimit } from './bounds.ts';

const { data } = await readData();
const rice = data.dishes.find(dish => dish.id === 'mifan');
const stirFry = data.dishes.find(dish => dish.id === 'fanqiechaodan');
const chicken = data.dishes.find(dish => dish.id === 'jixiong');
if (!rice || !stirFry || !chicken) throw new Error('测试缺少食物');

describe('物理上界唯一实现', () => {
  it('一拳米饭最多260g', () => {
    expect(portionUpperLimit(rice, '拳')).toBe(260);
    expect(applyBounds(300, rice, 1, '拳')).toEqual({ grams: 260, overLimit: true });
  });
  it('一碗米饭最多400g', () => {
    expect(applyBounds(500, rice, 1, '碗')).toEqual({ grams: 400, overLimit: true });
  });
  it('一份炒菜最多800g', () => {
    expect(applyBounds(900, stirFry, 1, '份')).toEqual({ grams: 800, overLimit: true });
  });
  it('单项食物最多2000g', () => {
    expect(applyBounds(3000, chicken, 3, 'kg')).toEqual({ grams: 2000, overLimit: true });
  });
  it('单份上界按数量缩放，两碗600g不因一碗的上界而误裁剪', () => {
    expect(applyBounds(600, rice, 2, '碗')).toEqual({ grams: 600, overLimit: false });
  });
  it('恰好上界不标记超限', () => {
    expect(applyBounds(260, rice, 1, '拳')).toEqual({ grams: 260, overLimit: false });
  });
});
