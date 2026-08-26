import { BadRequestError } from '../errors';
import {
  AGENT_SYSTEM_FIELDS,
  DATE_SYSTEM_FIELDS,
  FilterCondition,
  LeadFilter,
  SYSTEM_FIELD_COLUMNS,
} from '../types/lead-filter';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STRING_CONDITIONS: FilterCondition[] = [
  'is',
  'is not',
  'contain',
  'does not contain',
  'starts with',
  'ends with',
  'is empty',
  'is not empty',
];

const DATE_CONDITIONS: FilterCondition[] = [
  'before',
  'after',
  'is',
  'is empty',
  'is not empty',
];

const NUMBER_CONDITIONS: FilterCondition[] = [
  'is',
  'greater than',
  'less than',
  'is empty',
  'is not empty',
];

const BOOLEAN_CONDITIONS: FilterCondition[] = ['is'];

/**
 * Holds the running list of parameterized values. clause() returns
 * placeholders like $3 while pushing the actual value onto `values`.
 */
class ParamBag {
  values: unknown[] = [];
  constructor(startIndex: number) {
    this.startIndex = startIndex;
  }
  private startIndex: number;
  push(v: unknown): string {
    this.values.push(v);
    return `$${this.startIndex + this.values.length}`;
  }
}

function assertValue(filter: LeadFilter): string {
  if (filter.value === undefined || filter.value === null || filter.value === '') {
    throw new BadRequestError(
      `filter for fieldId "${filter.fieldId}" requires a non-empty "value" for condition "${filter.condition}"`
    );
  }
  return filter.value;
}

function assertDate(value: string): string {
  if (!DATE_RE.test(value)) {
    throw new BadRequestError(`Invalid date "${value}", expected format YYYY-MM-DD`);
  }
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestError(`Invalid date "${value}"`);
  }
  return value;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Builds a clause for a system string column (name, phone, email). */
function buildSystemStringClause(
  column: string,
  nullable: boolean,
  filter: LeadFilter,
  bag: ParamBag
): string {
  if (!STRING_CONDITIONS.includes(filter.condition)) {
    throw new BadRequestError(
      `Unsupported condition "${filter.condition}" for string field "${filter.fieldId}"`
    );
  }

  switch (filter.condition) {
    case 'is': {
      const v = assertValue(filter);
      return `${column} ILIKE ${bag.push(v)}`;
    }
    case 'is not': {
      const v = assertValue(filter);
      return nullable
        ? `(${column} IS NULL OR ${column} NOT ILIKE ${bag.push(v)})`
        : `${column} NOT ILIKE ${bag.push(v)}`;
    }
    case 'contain': {
      const v = assertValue(filter);
      return `${column} ILIKE ${bag.push(`%${v}%`)}`;
    }
    case 'does not contain': {
      const v = assertValue(filter);
      return nullable
        ? `(${column} IS NULL OR ${column} NOT ILIKE ${bag.push(`%${v}%`)})`
        : `${column} NOT ILIKE ${bag.push(`%${v}%`)}`;
    }
    case 'starts with': {
      const v = assertValue(filter);
      return `${column} ILIKE ${bag.push(`${v}%`)}`;
    }
    case 'ends with': {
      const v = assertValue(filter);
      return `${column} ILIKE ${bag.push(`%${v}`)}`;
    }
    case 'is empty':
      return nullable ? `(${column} IS NULL OR ${column} = '')` : `${column} = ''`;
    case 'is not empty':
      return nullable ? `(${column} IS NOT NULL AND ${column} <> '')` : `${column} <> ''`;
    default:
      throw new BadRequestError(`Unsupported condition "${filter.condition}"`);
  }
}

/** Builds a clause for assignedTo / createdBy (agent UUID columns). */
function buildAgentClause(fieldId: string, filter: LeadFilter, bag: ParamBag): string {
  const column = SYSTEM_FIELD_COLUMNS[fieldId];
  const nullable = fieldId === 'assignedTo';
  const isMulti = filter.inputType === 'multiselect';

  switch (filter.condition) {
    case 'is':
    case 'contain': {
      const v = assertValue(filter);
      const ids = isMulti ? splitCsv(v) : [v];
      if (ids.length === 0) throw new BadRequestError('No valid ids supplied');
      return `${column} = ANY(${bag.push(ids)})`;
    }
    case 'is not':
    case 'does not contain': {
      const v = assertValue(filter);
      const ids = isMulti ? splitCsv(v) : [v];
      return nullable
        ? `(${column} IS NULL OR ${column} <> ALL(${bag.push(ids)}))`
        : `${column} <> ALL(${bag.push(ids)})`;
    }
    case 'is empty':
      if (!nullable) throw new BadRequestError(`"is empty" not supported for "${fieldId}"`);
      return `${column} IS NULL`;
    case 'is not empty':
      if (!nullable) throw new BadRequestError(`"is not empty" not supported for "${fieldId}"`);
      return `${column} IS NOT NULL`;
    default:
      throw new BadRequestError(
        `Unsupported condition "${filter.condition}" for field "${fieldId}"`
      );
  }
}

/** Builds a clause for a system date column. */
function buildSystemDateClause(column: string, filter: LeadFilter, bag: ParamBag): string {
  if (!DATE_CONDITIONS.includes(filter.condition)) {
    throw new BadRequestError(
      `Unsupported condition "${filter.condition}" for date field "${filter.fieldId}"`
    );
  }
  switch (filter.condition) {
    case 'before': {
      const v = assertDate(assertValue(filter));
      return `${column} < ${bag.push(v)}`;
    }
    case 'after': {
      const v = assertDate(assertValue(filter));
      return `${column} > ${bag.push(v)}`;
    }
    case 'is': {
      const v = assertDate(assertValue(filter));
      // Works for both DATE and TIMESTAMPTZ columns (same-day match)
      return `${column}::date = ${bag.push(v)}::date`;
    }
    case 'is empty':
      return `${column} IS NULL`;
    case 'is not empty':
      return `${column} IS NOT NULL`;
    default:
      throw new BadRequestError(`Unsupported condition "${filter.condition}"`);
  }
}

/** Builds an EXISTS/NOT EXISTS clause for a custom field (EAV). */
function buildCustomFieldClause(filter: LeadFilter, bag: ParamBag): string {
  const fieldIdParam = bag.push(filter.fieldId);

  if (filter.condition === 'is empty') {
    return `NOT EXISTS (
      SELECT 1 FROM lead_custom_field_values cfv
      WHERE cfv.lead_id = leads.id AND cfv.field_id = ${fieldIdParam}
        AND cfv.value IS NOT NULL AND cfv.value <> ''
    )`;
  }
  if (filter.condition === 'is not empty') {
    return `EXISTS (
      SELECT 1 FROM lead_custom_field_values cfv
      WHERE cfv.lead_id = leads.id AND cfv.field_id = ${fieldIdParam}
        AND cfv.value IS NOT NULL AND cfv.value <> ''
    )`;
  }

  if (filter.fieldType === 'string') {
    if (!STRING_CONDITIONS.includes(filter.condition)) {
      throw new BadRequestError(
        `Unsupported condition "${filter.condition}" for custom string field`
      );
    }
    const v = assertValue(filter);
    let valueExpr: string;
    switch (filter.condition) {
      case 'is':
        valueExpr = `cfv.value ILIKE ${bag.push(v)}`;
        break;
      case 'is not':
        valueExpr = `cfv.value NOT ILIKE ${bag.push(v)}`;
        break;
      case 'contain':
        valueExpr = `cfv.value ILIKE ${bag.push(`%${v}%`)}`;
        break;
      case 'does not contain':
        valueExpr = `cfv.value NOT ILIKE ${bag.push(`%${v}%`)}`;
        break;
      case 'starts with':
        valueExpr = `cfv.value ILIKE ${bag.push(`${v}%`)}`;
        break;
      case 'ends with':
        valueExpr = `cfv.value ILIKE ${bag.push(`%${v}`)}`;
        break;
      default:
        throw new BadRequestError(`Unsupported condition "${filter.condition}"`);
    }
    const negated = filter.condition === 'is not' || filter.condition === 'does not contain';
    const quantifier = negated ? 'NOT EXISTS' : 'EXISTS';
    return `${quantifier} (
      SELECT 1 FROM lead_custom_field_values cfv
      WHERE cfv.lead_id = leads.id AND cfv.field_id = ${fieldIdParam} AND ${valueExpr}
    )`;
  }

  if (filter.fieldType === 'number') {
    if (!NUMBER_CONDITIONS.includes(filter.condition)) {
      throw new BadRequestError(
        `Unsupported condition "${filter.condition}" for custom number field`
      );
    }
    const v = assertValue(filter);
    if (Number.isNaN(Number(v))) {
      throw new BadRequestError(`Invalid number "${v}"`);
    }
    let op: string;
    switch (filter.condition) {
      case 'is':
        op = '=';
        break;
      case 'greater than':
        op = '>';
        break;
      case 'less than':
        op = '<';
        break;
      default:
        throw new BadRequestError(`Unsupported condition "${filter.condition}"`);
    }
    return `EXISTS (
      SELECT 1 FROM lead_custom_field_values cfv
      WHERE cfv.lead_id = leads.id AND cfv.field_id = ${fieldIdParam}
        AND cfv.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
        AND cfv.value::numeric ${op} ${bag.push(v)}
    )`;
  }

  if (filter.fieldType === 'boolean') {
    if (!BOOLEAN_CONDITIONS.includes(filter.condition)) {
      throw new BadRequestError(
        `Unsupported condition "${filter.condition}" for custom boolean field`
      );
    }
    const v = assertValue(filter);
    if (v !== 'true' && v !== 'false') {
      throw new BadRequestError(`Boolean value must be "true" or "false", got "${v}"`);
    }
    return `EXISTS (
      SELECT 1 FROM lead_custom_field_values cfv
      WHERE cfv.lead_id = leads.id AND cfv.field_id = ${fieldIdParam}
        AND cfv.value = ${bag.push(v)}
    )`;
  }

  if (filter.fieldType === 'date') {
    if (!DATE_CONDITIONS.includes(filter.condition)) {
      throw new BadRequestError(
        `Unsupported condition "${filter.condition}" for custom date field`
      );
    }
    const v = assertDate(assertValue(filter));
    let cmpExpr: string;
    switch (filter.condition) {
      case 'before':
        cmpExpr = `cfv.value::date < ${bag.push(v)}::date`;
        break;
      case 'after':
        cmpExpr = `cfv.value::date > ${bag.push(v)}::date`;
        break;
      case 'is':
        cmpExpr = `cfv.value::date = ${bag.push(v)}::date`;
        break;
      default:
        throw new BadRequestError(`Unsupported condition "${filter.condition}"`);
    }
    return `EXISTS (
      SELECT 1 FROM lead_custom_field_values cfv
      WHERE cfv.lead_id = leads.id AND cfv.field_id = ${fieldIdParam} AND ${cmpExpr}
    )`;
  }

  throw new BadRequestError(`Unsupported fieldType "${filter.fieldType}"`);
}

/** Compiles one LeadFilter into a SQL boolean expression string. */
function buildOneFilterClause(filter: LeadFilter, bag: ParamBag): string {
  const { fieldId } = filter;

  if (AGENT_SYSTEM_FIELDS.has(fieldId)) {
    return buildAgentClause(fieldId, filter, bag);
  }

  if (DATE_SYSTEM_FIELDS.has(fieldId)) {
    return buildSystemDateClause(SYSTEM_FIELD_COLUMNS[fieldId], filter, bag);
  }

  if (fieldId === 'name' || fieldId === 'phone' || fieldId === 'email') {
    const nullable = fieldId === 'email';
    return buildSystemStringClause(SYSTEM_FIELD_COLUMNS[fieldId], nullable, filter, bag);
  }

  // Otherwise: custom field (EAV) — fieldId is the custom_fields.id UUID
  return buildCustomFieldClause(filter, bag);
}

/**
 * Builds the full filter clause list for a query.
 * Returns { whereClause, params } where whereClause is a single
 * parenthesized boolean expression (or null if no filters), and
 * params are appended starting at `startParamIndex`.
 */
export function buildLeadFilterClause(
  filters: LeadFilter[] | undefined,
  logic: 'AND' | 'OR' | undefined,
  startParamIndex: number
): { clause: string | null; params: unknown[] } {
  if (!filters || filters.length === 0) {
    return { clause: null, params: [] };
  }

  const bag = new ParamBag(startParamIndex);
  const parts = filters.map((f) => buildOneFilterClause(f, bag));
  const joiner = logic === 'OR' ? ' OR ' : ' AND ';
  const clause = `(${parts.join(joiner)})`;
  return { clause, params: bag.values };
}

/** Builds the free-text search clause across name/phone/email/e164. */
export function buildSearchClause(
  q: string | undefined,
  startParamIndex: number
): { clause: string | null; params: unknown[] } {
  const trimmed = q?.trim();
  if (!trimmed) {
    return { clause: null, params: [] };
  }
  const bag = new ParamBag(startParamIndex);
  const p = bag.push(`%${trimmed}%`);
  const clause = `(name ILIKE ${p} OR phone ILIKE ${p} OR email ILIKE ${p} OR e164 ILIKE ${p})`;
  return { clause, params: bag.values };
}
