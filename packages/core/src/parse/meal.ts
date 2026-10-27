import type { DataSet } from '../../../data/src/types.ts';
import { normalizeWithOffsets } from '../normalize/index.ts';
import { gramsFor } from '../normalize/units.ts';
import { nutritionOf, toGrams } from '../lookup/index.ts';
import { applyBounds } from '../validate/bounds.ts';
import type { MealItem, MealResult } from '../types.ts';
import { buildDict, matchAll } from './dict.ts';
import type { Match } from './dict.ts';
import { approximationSide, extractSegments } from './rules.ts';
import type { Segment } from './rules.ts';

export interface ParsedMealItem {
  foodId: string;
  foodName: string;
  raw: string;
  qty: number | null;
  unit: string | null;
  grams: number | null;
  approx?: boolean;
}

export interface ParsedMeal {
  raw: string;
  items: ParsedMealItem[];
  matches: Match[];
  unresolved: Segment[];
}

// console 是浏览器与 CLI 共有的接口，不引入 Node 或 DOM 类型。
declare const console: { warn(message: string, error?: unknown): void };

// 匹配和份量阶段独立保留，供词典测试与验收数据依赖检查复用。
export function parseMealParts(raw: string, data: DataSet): ParsedMeal {
  const source = normalizeWithOffsets(raw);
  const matches = matchAll(source.text, buildDict(data));
  const originalSpan = (start: number, end: number): string => {
    const first = source.offsets[start];
    const last = source.offsets[end - 1];
    return first && last ? raw.slice(first.start, last.end) : '';
  };
  const items: ParsedMealItem[] = matches.map(match => ({
    foodId: match.foodId, foodName: match.foodName, raw: originalSpan(match.start, match.end),
    qty: null, unit: null, grams: null,
  }));
  const bounds = matches.map(match => ({ start: match.start, end: match.end }));
  const dishes = new Map(data.dishes.map(dish => [dish.id, dish]));
  const unresolved: Segment[] = [];

  // 匹配区间永远不进入 extractSegments，中文数字只在这些空隙中转换。
  for (let index = 0; index <= matches.length; index += 1) {
    const start = matches[index - 1]?.end ?? 0;
    const end = matches[index]?.start ?? source.text.length;
    // 只移除规格用例中的叙述词，且以等长空白替换，保留原文偏移。
    const gap = source.text.slice(start, end).replace(/早上|中午|下午|晚上|加餐|昨天剩的|吃了|跟朋友|点东西|顿饭/gu, word => ' '.repeat(word.length));
    const segments = extractSegments(gap, data, gap, {
      allowBareQuantity: matches.length > 0,
      leadingQuantityAfterFood: index > 0 && items[index - 1]?.qty === null,
    });
    const approximateSide = segments.length === 0 ? approximationSide(gap) : null;
    if (approximateSide) {
      const targetIndex = approximateSide === 'previous' ? index - 1 : index;
      const target = items[targetIndex];
      const range = bounds[targetIndex];
      if (target && range) {
        target.approx = true;
        range.start = Math.min(range.start, start);
        range.end = Math.max(range.end, end);
        target.raw = originalSpan(range.start, range.end).trim();
      }
    }
    for (const segment of segments) {
      const segmentStart = start + segment.start;
      const segmentEnd = start + segment.end;
      const previous = items[index - 1];
      const targetIndex = previous && previous.qty === null ? index - 1 : index;
      const target = items[targetIndex];
      const range = bounds[targetIndex];
      if (target && range && target.qty === null && segment.qty !== null && segment.unit !== null && !segment.hasFood) {
        target.qty = segment.qty;
        target.unit = segment.unit;
        target.grams = gramsFor(segment.qty, segment.unit, data, dishes.get(target.foodId)?.portions);
        if (segment.approx) target.approx = true;
        range.start = Math.min(range.start, segmentStart);
        range.end = Math.max(range.end, segmentEnd);
        target.raw = originalSpan(range.start, range.end);
      } else {
        unresolved.push({ ...segment, raw: originalSpan(segmentStart, segmentEnd), start: segmentStart, end: segmentEnd });
      }
    }
  }
  return { raw, items, matches, unresolved };
}

function emptyTotal(): MealResult['total'] {
  return { kcal: null, kcalRange: null, protein: null, carb: null, fat: null };
}

// 整餐与当天汇总复用同一处合计判断，任何未解析条目都会使合计留空。
export function totalFor(items: MealItem[]): MealResult['total'] {
  if (items.length === 0 || items.some(item => item.confidence === 'unresolved')) return emptyTotal();
  const sum = (field: 'kcal' | 'protein' | 'carb' | 'fat'): number => items.reduce((total, item) => total + (item[field] ?? 0), 0);
  const total = emptyTotal();
  total.protein = sum('protein');
  total.carb = sum('carb');
  total.fat = sum('fat');
  if (items.some(item => item.confidence === 'estimate')) {
    total.kcalRange = [Math.round(sum('kcal') * 0.85), Math.round(sum('kcal') * 1.15)];
  } else if (items.every(item => item.confidence === 'exact')) total.kcal = sum('kcal');
  return total;
}

function unresolvedItem(raw: string, qty: number | null, unit: string | null): MealItem {
  return { raw, foodId: null, foodName: null, qty, unit, grams: null,
    kcal: null, protein: null, carb: null, fat: null, confidence: 'unresolved' };
}

export function parseMeal(raw: string, data: DataSet): MealResult {
  try {
    const parts = parseMealParts(raw, data);
    const dishes = new Map(data.dishes.map(dish => [dish.id, dish]));
    const items: MealItem[] = parts.items.map(part => {
      const dish = dishes.get(part.foodId);
      const item = { ...unresolvedItem(part.raw, part.qty, part.unit), foodId: part.foodId, foodName: part.foodName };
      if (!dish) return item;
      const grams = toGrams(part, part, data);
      if (grams === null) return item;
      const bounded = applyBounds(grams, dish, part.qty, part.unit);
      item.grams = bounded.grams;
      if (bounded.overLimit) item.flag = 'over_limit';
      const nutrition = nutritionOf(bounded.grams, dish);
      if (!nutrition) return item;
      Object.assign(item, nutrition);
      // 个/只/枚须由 Dish 提供重量，已有该固定个体重量时可走精确路径。
      const absolute = part.unit !== null && data.units.some(unit => unit.id === part.unit);
      item.confidence = absolute && !part.approx && !bounded.overLimit ? 'exact' : 'estimate';
      return item;
    });
    for (const segment of parts.unresolved) items.push(unresolvedItem(segment.raw, segment.qty, segment.unit));
    return { items, total: totalFor(items) };
  } catch (error) {
    console.warn('输入解析失败，保留空结果。', error);
    return { items: [], total: emptyTotal() };
  }
}
