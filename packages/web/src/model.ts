import { parseMeal, totalFor } from '@meal/core';
import type { MealItem, MealResult } from '@meal/core';
import data from '@meal/data';

export interface SavedMeal {
  t: string;
  raw: string;
  portions?: Record<string, string>;
  dismissed?: number[];
}

export function dateKey(now: Date): string {
  return `meal:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function placeholderFor(hour: number): string {
  if (hour >= 5 && hour < 10) return '早饭吃了什么…';
  if (hour >= 10 && hour < 14) return '中午吃了什么…';
  if (hour >= 14 && hour < 17) return '下午吃了什么…';
  if (hour >= 17 && hour < 22) return '晚上吃了什么…';
  return '又吃了什么…';
}

export function readRecords(storage: Pick<Storage, 'getItem'> | null, key: string): SavedMeal[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is SavedMeal => typeof entry === 'object' && entry !== null &&
      typeof entry.t === 'string' && typeof entry.raw === 'string');
  } catch { return []; }
}

export function writeRecords(storage: Pick<Storage, 'setItem'> | null, key: string, records: SavedMeal[]): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(records));
    return true;
  } catch { return false; }
}

export function portionOptions(item: MealItem): Array<{ unit: string; grams: number }> {
  return item.confidence === 'estimate' ? data.dishes.find(dish => dish.id === item.foodId)?.portions ?? [] : [];
}

export function resolveRecord(saved: SavedMeal): MealResult {
  const result = parseMeal(saved.raw, data);
  const items = result.items.map((item, index) => {
    const unit = saved.portions?.[String(index)];
    if (typeof unit !== 'string') return item;
    const dish = data.dishes.find(dish => dish.id === item.foodId);
    const selected = dish?.portions.find(portion => portion.unit === unit);
    if (!dish || !selected) return item;
    // 点击确认后，以当前表内该份量的克数重新走唯一的解析、上界与查表实现。
    const confirmed = parseMeal(`${dish.name}${selected.grams}g`, data).items[0];
    return confirmed ? { ...confirmed, raw: item.raw, qty: 1, unit: selected.unit } : item;
  });
  return { items, total: totalFor(items) };
}

export function blurInput(input: { blur(): void }): void {
  input.blur();
}
