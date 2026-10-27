import type { Dish } from '../../../data/src/types.ts';

export const MAX_ITEM_GRAMS = 2000;
const PORTION_LIMITS = { riceFist: 260, riceBowl: 400, stirFry: 800 } as const;

// 数据集规则 10 与运行时裁剪共用此处的物理上界，不另存第二份表。
export function portionUpperLimit(dish: Dish, unit: string): number | null {
  const names = [dish.name, ...(Array.isArray(dish.aliases) ? dish.aliases : [])].filter(name => typeof name === 'string');
  const rice = dish.id === 'mifan' || names.includes('米饭') || names.includes('白米饭');
  const stirFry = dish.kind === 'dish' && (names.some(name => name.includes('炒'))
    || ['qingchao', 'jiachangchao', 'baochao'].includes(dish.method ?? ''));
  if (rice && unit === '拳') return PORTION_LIMITS.riceFist;
  if (rice && unit === '碗') return PORTION_LIMITS.riceBowl;
  if (stirFry && unit === '份') return PORTION_LIMITS.stirFry;
  return null;
}

export function applyBounds(grams: number, dish: Dish, qty: number | null, unit: string | null): { grams: number; overLimit: boolean } {
  const portion = portionUpperLimit(dish, unit ?? dish.portions[0]?.unit ?? '');
  // 单份上界按数量缩放；整项仍不得超过 2000g。
  const limit = Math.min(MAX_ITEM_GRAMS, portion === null ? MAX_ITEM_GRAMS : portion * (qty ?? 1));
  return { grams: Math.min(grams, limit), overLimit: grams > limit };
}
