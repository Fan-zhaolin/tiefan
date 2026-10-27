import type { DataSet, Dish } from '../../../data/src/types.ts';
import { gramsFor } from '../normalize/units.ts';

export interface Resolved {
  grams: number;
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}

export function toGrams(
  segment: { qty: number | null; unit: string | null },
  match: { foodId: string }, data: DataSet,
): number | null {
  const dish = data.dishes.find(candidate => candidate.id === match.foodId);
  if (!dish) return null;
  if (segment.qty === null && segment.unit === null) {
    const grams = dish.portions[0]?.grams;
    return grams !== undefined && Number.isFinite(grams) && grams > 0 ? grams : null;
  }
  if (segment.qty === null || segment.qty <= 0) return null;
  return gramsFor(segment.qty, segment.unit, data, dish.portions);
}

export function nutritionOf(grams: number, dish: Dish): Resolved | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const values = [dish.kcal, dish.protein, dish.carb, dish.fat];
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null;
  // 只缩放 YAML 中已录入的数值，不从宏量反推热量，也不使用做法模板。
  const scale = (value: number | null): number => (value as number) * grams / 100;
  return { grams, kcal: scale(dish.kcal), protein: scale(dish.protein), carb: scale(dish.carb), fat: scale(dish.fat) };
}
