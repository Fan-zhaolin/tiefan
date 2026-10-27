export { normalize } from './normalize/index.ts';
export { extractSegments } from './parse/rules.ts';
export type { Segment } from './parse/rules.ts';
export { gramsFor } from './normalize/units.ts';
export { buildDict, matchAll } from './parse/dict.ts';
export type { Dict, Match } from './parse/dict.ts';
export { parseMeal, totalFor } from './parse/meal.ts';
export type { Confidence, MealItem, MealResult } from './types.ts';
export { displayWidth, formatMeals, formatItemKcal, formatPortion, formatTotal } from './format.ts';
