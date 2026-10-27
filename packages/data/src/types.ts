export type Source = 'TFDA' | 'USDA' | 'LABEL' | 'MANUAL';
export type Kind = 'dish' | 'ingredient' | 'packaged';

export interface Dish {
  id: string;
  name: string;
  aliases: string[];
  kind: Kind;
  per: '100g';
  // 未核实的营养字段显式留空，不参与热量计算。
  kcal: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
  // 可选的已核实纤维值；缺失时不推断、不补值。
  fiber?: number | null;
  portions: Array<{ unit: string; grams: number }>;
  method: string | null;
  source: Source;
  note?: string;
}

export interface Unit {
  id: string;
  name: string;
  grams: number;
  aliases: string[];
}

export interface Method {
  id: string;
  name: string;
  oil_g: number;
  sugar_g: number;
}

export interface AcceptanceCase {
  id: string;
  input: string;
  expect: {
    foods?: string[];
    unresolved?: number;
    must_be_exact?: string[];
    kcal?: number | null;
    kcal_range?: [number, number] | null;
  };
  skip?: boolean;
  skip_reason?: string;
}

export interface DataSet {
  dishes: Dish[];
  units: Unit[];
  methods: Method[];
  // 校验时注入验收语料，构建产物不携带此上下文。
  acceptance?: AcceptanceCase[];
}
