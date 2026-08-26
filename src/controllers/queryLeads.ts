import { Request, Response } from 'express';
import { pool } from '../db/client';
import { BadRequestError } from '../errors';
import { buildLeadFilterClause, buildSearchClause } from '../services/filters';
import { buildVisibilityClause } from '../services/visibility';
import { queryLeadsBodySchema, queryParamsSchema } from '../types/validation';

const SORT_COLUMN: Record<string, string> = {
  createdAt: 'created_at',
  followUpDate: 'follow_up_date',
};

export async function queryLeads(req: Request, res: Response) {
  const user = req.currentUser!;

  const parsedQuery = queryParamsSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new BadRequestError(parsedQuery.error.issues[0].message);
  }
  const { page, limit, sortBy, sortDirection } = parsedQuery.data;

  const parsedBody = queryLeadsBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    throw new BadRequestError(parsedBody.error.issues[0].message);
  }
  const { q, logic, filters } = parsedBody.data;

  // ---- Build WHERE clause pieces ----
  const clauses: string[] = ['tenant_id = $1'];
  const params: unknown[] = [user.tenantId];

  const visibility = buildVisibilityClause(user, params.length);
  if (visibility.clause) {
    clauses.push(visibility.clause);
    params.push(...visibility.params);
  }

  const search = buildSearchClause(q, params.length);
  const filterResult = buildLeadFilterClause(filters, logic, params.length + search.params.length);

  // search AND filters, combined as its own group
  if (search.clause && filterResult.clause) {
    clauses.push(`(${search.clause} AND ${filterResult.clause})`);
    params.push(...search.params, ...filterResult.params);
  } else if (search.clause) {
    clauses.push(search.clause);
    params.push(...search.params);
  } else if (filterResult.clause) {
    clauses.push(filterResult.clause);
    params.push(...filterResult.params);
  }

  const whereSql = clauses.join(' AND ');

  // ---- Count total matching rows ----
  const countSql = `SELECT count(*)::int AS count FROM leads WHERE ${whereSql}`;
  const countResult = await pool.query(countSql, params);
  const totalRecords: number = countResult.rows[0].count;
  const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

  // ---- id-then-hydrate: fetch matching IDs with sort/pagination ----
  const sortCol = SORT_COLUMN[sortBy];
  const nullsClause = sortDirection === 'asc' ? 'NULLS LAST' : 'NULLS LAST';
  const offset = (page - 1) * limit;

  const idSql = `
    SELECT id FROM leads
    WHERE ${whereSql}
    ORDER BY ${sortCol} ${sortDirection.toUpperCase()} ${nullsClause}, id ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const idParams = [...params, limit, offset];
  const idResult = await pool.query(idSql, idParams);
  const ids: string[] = idResult.rows.map((r) => r.id);

  if (ids.length === 0) {
    return res.json({
      status: 'success',
      message: 'Leads fetched successfully',
      data: [],
      meta: { page, limit, totalRecords, totalPages },
    });
  }

  // Fetch full rows, preserving the ORDER BY from the id query
  const rowsSql = `
    SELECT id, tenant_id, user_id, name, phone, country_code, e164, email,
           assigned_to, follow_up_date, created_at, updated_at
    FROM leads
    WHERE id = ANY($1)
  `;
  const rowsResult = await pool.query(rowsSql, [ids]);
  const rowsById = new Map(rowsResult.rows.map((r) => [r.id, r]));

  // Hydrate custom fields for all leads in a single query (no N+1)
  const cfSql = `
    SELECT cfv.lead_id, cfv.field_id, cf.label, cfv.value
    FROM lead_custom_field_values cfv
    JOIN custom_fields cf ON cf.id = cfv.field_id
    WHERE cfv.lead_id = ANY($1)
  `;
  const cfResult = await pool.query(cfSql, [ids]);
  const customFieldsByLead = new Map<string, { fieldId: string; label: string; value: string }[]>();
  for (const row of cfResult.rows) {
    const list = customFieldsByLead.get(row.lead_id) ?? [];
    list.push({ fieldId: row.field_id, label: row.label, value: row.value });
    customFieldsByLead.set(row.lead_id, list);
  }

  const data = ids.map((id) => {
    const r = rowsById.get(id);
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      name: r.name,
      phone: r.phone,
      countryCode: r.country_code,
      e164: r.e164,
      email: r.email,
      assignedTo: r.assigned_to,
      followUpDate: r.follow_up_date,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      customFields: customFieldsByLead.get(id) ?? [],
    };
  });

  res.json({
    status: 'success',
    message: 'Leads fetched successfully',
    data,
    meta: { page, limit, totalRecords, totalPages },
  });
}
