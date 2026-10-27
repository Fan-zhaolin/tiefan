import type { AcceptanceCase, DataSet, Dish } from './types.ts';
import { MAX_ITEM_GRAMS, portionUpperLimit } from '../../core/src/validate/bounds.ts';
import { nutritionOf, toGrams } from '../../core/src/lookup/index.ts';
import { parseMealParts } from '../../core/src/parse/meal.ts';

export interface RuleResult {
  rule: number;
  ok: boolean;
  msg?: string;
}

export interface MissingData {
  food: string;
  needs: string[];
  source: string;
}

const sourceRequirements: Readonly<Record<string, string>> = {
  '三杯鸡': 'TFDA 同口径成品，或 MANUAL 配方与生重；需默认份量重量',
  '八宝粥': 'TFDA 同口径成品，或 MANUAL 配方与生重；需默认份量重量',
  '夫妻肺片': 'TFDA 同口径成品，或 MANUAL 配方与生重；需默认份量重量',
  '黄焖鸡': 'TFDA 同口径成品，或 MANUAL 配方与生重；需默认份量重量',
  '牛肉面': 'TFDA 同口径成品，或 MANUAL 配方与生重；需一碗成品重量',
  '汉堡': 'USDA 明确种类的汉堡，或 MANUAL 配方；需单个重量',
  '面': 'USDA / TFDA 明确品种的熟面条；需一碗重量',
  '宫保鸡丁': 'TFDA 同口径成品，或 MANUAL 配方与生重；需默认份量重量',
  '炒饭': 'TFDA 同口径成品，或 MANUAL 配方与生重；需默认份量重量',
  '蛋白粉': 'USDA 明确粉种；需每勺重量',
  '番茄炒蛋': 'TFDA 同口径成品，或 MANUAL 配方与生重；需一份成品重量',
  '米饭': 'USDA 营养已录入；只需补一份的实测重量',
};

// 缺数据判断由校验器、验收测试和清单共用；不根据 parseMeal 的失败来决定 skip。
export function missingDataFor(fixture: AcceptanceCase, data: DataSet): MissingData[] {
  const names = new Map(data.dishes.flatMap(dish => [dish.name, ...dish.aliases].map(name => [name, dish] as const)));
  const required = fixture.expect.foods ?? [];
  const strict = fixture.expect.unresolved === 0 || fixture.expect.kcal != null || fixture.expect.kcal_range != null;
  const parts = parseMealParts(fixture.input, data);
  return required.flatMap(food => {
    const dish = names.get(food);
    const needs: string[] = [];
    if (!dish) needs.push('食物条目');
    else if (strict || fixture.expect.must_be_exact?.includes(food)) {
      if (nutritionOf(100, dish) === null) needs.push('营养值');
      const part = parts.items.find(item => item.foodId === dish.id);
      if (part && toGrams(part, part, data) === null) needs.push(part.unit ? `份量「${part.unit}」` : '默认份量');
    }
    return needs.length === 0 ? [] : [{ food, needs, source: sourceRequirements[dish?.name ?? food] ?? 'TFDA 或 MANUAL 已核实配方与生重' }];
  });
}

export function skipReasonFor(missing: MissingData[]): string {
  return `缺 ${missing.map(item => `${item.food}（${item.needs.join('、')}）`).join('、')} 数据`;
}

// 0 对应原有的「结构」诊断；业务规则仍为 1—11，没有改变阈值。
function fail(id: string, rule: number, message: string, detail?: string): RuleResult {
  return { rule, ok: false, msg: `✗ ${id}: 规则 ${rule === 0 ? '结构' : rule} ${message}${detail ? `\n  ${detail}` : ''}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

function foodNames(dish: Record<string, unknown>): string[] {
  return [dish.name, ...(isTextArray(dish.aliases) ? dish.aliases : [])].filter(isText);
}

function summarize(results: RuleResult[], lastRule: number): RuleResult[] {
  const rules = Array.from({ length: lastRule }, (_, index) => index + 1);
  if (results.some(result => result.rule === 0)) rules.unshift(0);
  return rules.map(rule => {
    const matching = results.filter(result => result.rule === rule);
    const failures = matching.filter(result => !result.ok);
    const visible = failures.length > 0 ? failures : matching;
    const msg = visible.flatMap(result => result.msg ? [result.msg] : []).join('\n');
    return { rule, ok: matching.every(result => result.ok), ...(msg ? { msg } : {}) };
  });
}

function checkRuleOne(dish: Record<string, unknown>, id: string): RuleResult[] {
  const { kcal, protein, carb, fat, fiber } = dish;
  if (kcal === null) {
    return [{ rule: 1, ok: true, msg: `待录入：${id}；不参与营养自洽计算。` }];
  }
  if (!isNumber(kcal)) return [];
  if (!isNumber(protein) || !isNumber(carb) || !isNumber(fat)) {
    return [fail(id, 1, '宏量自洽无法校验：宏量缺失时，必须将 kcal 留空并标记「待录入」')];
  }

  const lowCalorie = kcal < 40;
  // 不从 note 推断 fiber，只有实际提供的数值才能参与纤维条件判断。
  const highFiber = isNumber(fiber) && fiber > carb * 0.2;
  const eligible = lowCalorie || highFiber;
  const marked = typeof dish.note === 'string' && dish.note.includes('规则1豁免');
  if (eligible && marked) {
    const reason = lowCalorie ? `kcal=${kcal} < 40` : `fiber=${fiber} > carb*0.2`;
    return [{ rule: 1, ok: true, msg: `规则 1 豁免：${id}（${reason}；note 已注明「规则1豁免」）。` }];
  }

  const results: RuleResult[] = [];
  const macroKcal = 4 * protein + 4 * carb + 9 * fat;
  const deviation = kcal === 0 ? (macroKcal === 0 ? 0 : Infinity) : Math.abs(macroKcal - kcal) / kcal;
  const packagedException = dish.kind === 'packaged' && typeof dish.note === 'string'
    && /酒类|纯纤维/u.test(dish.note) && /原因|豁免/u.test(dish.note);
  const limit = packagedException ? 0.30 : 0.15;
  if (deviation > limit + 1e-12) {
    results.push(fail(id, 1, `宏量自洽，偏差 ${deviation.toFixed(2)} > ${limit.toFixed(2)}`,
      `kcal=${kcal}, 4P+4C+9F=${Number(macroKcal.toFixed(1))}`));
  }
  if (eligible && !marked) results.push(fail(id, 1, '符合豁免条件，但 note 缺少「规则1豁免」，不予豁免'));
  return results;
}

// 单菜检查规则 1—10；全库、语料和配置结构检查由 checkAll 汇总。
export function checkDish(dish: Dish, data: DataSet): RuleResult[] {
  const results: RuleResult[] = [];
  const input: unknown = dish;
  if (!isRecord(input)) return [fail('食物', 0, '食物必须是对象')];
  const id = isText(input.id) ? input.id : '食物';
  const add = (rule: number, message: string): void => { results.push(fail(id, rule, message)); };
  if (!isRecord(data) || !Array.isArray(data.dishes) || !Array.isArray(data.methods)) return [fail('数据集', 0, 'dishes、methods 必须是数组')];
  const dishes = (data.dishes as unknown[]).filter(isRecord);
  const methodIds = new Set((data.methods as unknown[]).filter(isRecord).map(method => method.id));

  if (!isText(input.id) || !/^[a-z][a-z0-9_]{2,40}$/u.test(input.id)) add(5, 'id 格式不合法');
  if (dishes.filter(other => other.id === input.id).length > 1) add(5, 'id 重复');
  if (!isText(input.name)) add(0, 'name 必须是非空字符串');
  if (!isTextArray(input.aliases)) add(6, 'aliases 必须是非空字符串组成的数组，可为空数组');
  if (typeof input.kind !== 'string' || !['dish', 'ingredient', 'packaged'].includes(input.kind)) add(0, 'kind 必须是 dish / ingredient / packaged');
  if (input.per !== '100g') add(0, 'per 必须是 100g');
  if (input.note !== undefined && typeof input.note !== 'string') add(0, 'note 必须是字符串');
  if (typeof input.note === 'string' && input.note.includes('待录入') && input.kcal !== null) add(0, '标记「待录入」时，kcal 必须为 null');

  const names = foodNames(input);
  for (const name of names) {
    const owner = dishes.find(other => other.id !== input.id && foodNames(other).includes(name));
    if (owner) add(6, `名称或别名「${name}」与 ${String(owner.id)} 冲突`);
  }

  const { kcal, protein, carb, fat } = input;
  if (kcal !== null && (!isNumber(kcal) || kcal > 900)) add(3, 'kcal 必须是 0 至 900 的有限数值或 null');
  if (isNumber(kcal) && !Number.isInteger(kcal)) add(0, 'kcal 必须保留整数');
  for (const field of ['protein', 'carb', 'fat'] as const) {
    const value = input[field];
    if (value !== null && (!isNumber(value) || value > 100)) add(4, `${field} 必须是 0 至 100 的有限数值或 null`);
    if (isNumber(value) && Math.abs(value * 10 - Math.round(value * 10)) > 1e-8) add(0, `${field} 最多保留 1 位小数`);
  }
  if ([protein, carb, fat].filter(isNumber).reduce((sum, value) => sum + value, 0) > 100 + 1e-8) add(2, 'P + C + F 不得超过 100g / 100g');
  if (kcal === null && (typeof input.note !== 'string' || !input.note.includes('待录入'))) add(0, 'kcal 为 null 时，note 必须写「待录入」');
  results.push(...checkRuleOne(input, id));

  if (input.method !== null && (typeof input.method !== 'string' || !methodIds.has(input.method))) add(8, 'method 必须引用已定义的做法 id 或为 null');
  if (typeof input.source !== 'string' || !['TFDA', 'USDA', 'LABEL', 'MANUAL'].includes(input.source)) add(9, 'source 只能是 TFDA / USDA / LABEL / MANUAL');
  if (kcal !== null && ['LABEL', 'MANUAL'].includes(String(input.source)) && !isText(input.note)) add(9, 'LABEL 需注明品牌，MANUAL 需注明配方与生重');

  if (!Array.isArray(input.portions)) {
    add(7, 'portions 必须是数组，可为空数组');
  } else {
    const portionUnits = new Set<string>();
    for (const portion of input.portions as unknown[]) {
      if (!isRecord(portion) || !isText(portion.unit) || !/^[\p{Script=Han}]+$/u.test(portion.unit)
        || !isNumber(portion.grams) || portion.grams <= 0 || portion.grams > MAX_ITEM_GRAMS) {
        add(7, `份量单位必须为非空中文名，且满足 0 < grams ≤ ${MAX_ITEM_GRAMS}`);
        continue;
      }
      if (portionUnits.has(portion.unit)) add(7, `份量单位「${portion.unit}」重复`);
      portionUnits.add(portion.unit);
      const upperLimit = portionUpperLimit(input as unknown as Dish, portion.unit);
      if (upperLimit !== null && portion.grams > upperLimit) add(10, `物理上界，一${portion.unit}${String(input.name)} ${portion.grams}g > ${upperLimit}g`);
    }
  }
  return summarize(results, 10);
}

export function checkAll(data: DataSet): RuleResult[] {
  const input: unknown = data;
  if (!isRecord(input) || !Array.isArray(input.dishes) || !Array.isArray(input.units) || !Array.isArray(input.methods)) {
    return [fail('数据集', 0, 'dishes、units、methods 必须是数组')];
  }
  const results: RuleResult[] = [];
  const methodIds = new Set<string>();
  for (const method of input.methods as unknown[]) {
    if (!isRecord(method) || !isText(method.id) || !/^[a-z][a-z0-9_]{2,40}$/u.test(method.id)
      || !isText(method.name) || !isNumber(method.oil_g) || !isNumber(method.sugar_g)) {
      results.push(fail('做法', 0, '做法必须提供合法 id、name 和非负 oil_g / sugar_g'));
      continue;
    }
    if (methodIds.has(method.id)) results.push(fail(method.id, 0, '做法 id 重复'));
    methodIds.add(method.id);
  }

  const unitIds = new Set<string>();
  const unitNames = new Map<string, string>();
  for (const unit of input.units as unknown[]) {
    if (!isRecord(unit) || !isText(unit.id) || !isText(unit.name) || !isNumber(unit.grams) || !isTextArray(unit.aliases)) {
      results.push(fail('单位', 0, '单位必须提供 id、name、非负 grams 和 aliases 数组'));
      continue;
    }
    if (unitIds.has(unit.id)) results.push(fail(unit.id, 0, '单位 id 重复'));
    unitIds.add(unit.id);
    for (const name of [unit.name, ...unit.aliases]) {
      const owner = unitNames.get(name);
      if (owner !== undefined && owner !== unit.id) results.push(fail(unit.id, 0, `单位名称或别名「${name}」与 ${owner} 冲突`));
      unitNames.set(name, unit.id);
    }
  }

  results.push(...data.dishes.flatMap(dish => checkDish(dish, data)));

  // 缺数据允许显式跳过；理由必须和真实依赖一致，不能借 skip 掩盖实现错误。
  const names = new Set((input.dishes as unknown[]).filter(isRecord).flatMap(foodNames));
  const acceptance = input.acceptance;
  let regressionCount = 0;
  let skippedCount = 0;
  if (!Array.isArray(acceptance)) {
    results.push(fail('验收语料', 11, '必须显式提供 acceptance.yaml 数组'));
  } else {
    for (const fixture of acceptance as unknown[]) {
      if (!isRecord(fixture) || !isText(fixture.id) || typeof fixture.input !== 'string' || !isRecord(fixture.expect)) {
        results.push(fail('验收语料', 11, '每条用例必须包含 id、input 和 expect'));
        continue;
      }
      const foods = fixture.expect.foods ?? [];
      if (!isTextArray(foods)) {
        results.push(fail(fixture.id, 11, 'expect.foods 必须是食物名数组'));
        continue;
      }
      try {
        const missing = missingDataFor(fixture as unknown as AcceptanceCase, data);
        if (fixture.skip === true) {
          if (missing.length === 0) results.push(fail(fixture.id, 11, '用例数据已具备，不允许继续 skip'));
          else if (fixture.skip_reason !== skipReasonFor(missing)) results.push(fail(fixture.id, 11, `skip_reason 与缺数据不一致，应为「${skipReasonFor(missing)}」`));
          skippedCount += 1;
          continue;
        }
        if (missing.length > 0) results.push(fail(fixture.id, 11, `${skipReasonFor(missing)}，必须显式标注 skip`));
      } catch (error) {
        results.push(fail(fixture.id, 11, `无法检查数据依赖：${error instanceof Error ? error.message : String(error)}`));
      }
      for (const food of foods) {
        regressionCount += 1;
        if (!names.has(food)) results.push(fail(fixture.id, 11, `语料名称/别名「${food}」已不在食物字典中`));
      }
    }
  }
  if (!results.some(result => result.rule === 11 && !result.ok)) {
    results.push({ rule: 11, ok: true, msg: `规则 11：${regressionCount} 项名称/别名回归；${skippedCount} 条缺数据用例已标注跳过。` });
  }
  return summarize(results, 11);
}
