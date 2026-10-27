export type Confidence = 'exact' | 'estimate' | 'unresolved';

export interface MealItem {
  raw: string;
  foodId: string | null;
  foodName: string | null;
  qty: number | null;
  unit: string | null;
  grams: number | null;
  kcal: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
  confidence: Confidence;
  flag?: 'over_limit';
}

export interface MealResult {
  items: MealItem[];
  total: {
    kcal: number | null;
    kcalRange: [number, number] | null;
    protein: number | null;
    carb: number | null;
    fat: number | null;
  };
}
