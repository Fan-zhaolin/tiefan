import type { DataSet, Dish } from '../../../data/src/types.ts';

export type UnitData = Pick<DataSet, 'units' | 'dishes'>;

export function buildUnitAliases(data: UnitData): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const unit of data.units) {
    for (const alias of [unit.name, ...unit.aliases]) aliases.set(alias.toLowerCase(), unit.id);
  }
  for (const dish of data.dishes) {
    for (const portion of dish.portions) {
      if (!aliases.has(portion.unit)) aliases.set(portion.unit, portion.unit);
      if (portion.unit === '拳') aliases.set('拳头', portion.unit);
    }
  }
  return aliases;
}

// 额外验收要求最终克数：换算只在此处实现，后续查表层直接复用。
export function gramsFor(
  qty: number | null,
  unit: string | null,
  data: Pick<DataSet, 'units'>,
  portions: Readonly<Dish['portions']> = [],
): number | null {
  if (qty === null || unit === null || !Number.isFinite(qty) || qty < 0) return null;
  const absolute = data.units.find(candidate => candidate.id === unit);
  const weight = absolute && absolute.grams > 0 ? absolute.grams
    : portions.find(portion => portion.unit === (absolute?.name ?? unit))?.grams;
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) return null;
  const grams = qty * weight;
  return Number.isFinite(grams) ? grams : null;
}
