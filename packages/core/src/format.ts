import type { MealItem, MealResult } from './types.ts';
import { totalFor } from './parse/meal.ts';

export function displayWidth(s: string): number {
  let width = 0;
  for (const char of s) width += (char.codePointAt(0) ?? 0) > 0x2E80 ? 2 : 1;
  return width;
}

function pad(text: string, width: number, right = false): string {
  const spaces = ' '.repeat(Math.max(0, width - displayWidth(text)));
  return right ? spaces + text : text + spaces;
}

export function formatPortion(item: MealItem): string {
  // 绝对单位已由解析器换成克；相对份量保留碗、拳等原单位。
  if (item.qty !== null && item.unit !== null && !/^[a-z]+$/u.test(item.unit)) {
    const quantity = new Map([[0.5, '半'], [1, '一'], [2, '两'], [3, '三']]);
    return `${quantity.get(item.qty) ?? item.qty}${item.unit}`;
  }
  return item.grams === null ? '—' : `${item.grams}g`;
}

function rounded(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

export function formatItemKcal(item: MealItem): string {
  return item.kcal === null ? '—' : `${item.confidence === 'estimate' ? '约' : ''}${Math.round(item.kcal)}`;
}

export function formatTotal(items: MealItem[]): string {
  const missing = items.filter(item => item.confidence === 'unresolved').length;
  if (missing > 0) return `合计不可用：有 ${missing} 项没认出`;
  const total = totalFor(items);
  if (total.kcalRange !== null) return `约 ${total.kcalRange[0]}–${total.kcalRange[1]}`;
  return total.kcal === null ? '合计不可用' : String(Math.round(total.kcal));
}

// 纯格式化函数，CLI 与后续 Web 复用同一套词和列序。
export function formatMeals(entries: Array<{ time: string; result: MealResult }>): string {
  const rows = entries.flatMap(({ time, result }) => result.items.map(item => ({ time, item })));
  const macros = rows.map(({ item }) => [`P${rounded(item.protein)}`, `C${rounded(item.carb)}`, `F${rounded(item.fat)}`]);
  const macroWidths = [0, 1, 2].map(index => Math.max(0, ...macros.map(values => displayWidth(values[index] ?? ''))));
  const lines = rows.map(({ time, item }, index) => {
    const macro = (macros[index] ?? []).map((value, column) => column < 2 ? pad(value, macroWidths[column] ?? 0) : value).join(' ');
    return [pad(time, 6), pad(item.foodName ?? item.raw, 12), pad(formatPortion(item), 8), pad(formatItemKcal(item), 6, true), macro].join(' ');
  });
  lines.push('─'.repeat(34));
  const items = rows.map(row => row.item);
  const value = formatTotal(items);
  lines.push(value.startsWith('合计不可用') ? value : pad('今天', 35 - displayWidth(value)) + value);
  return lines.join('\n');
}
