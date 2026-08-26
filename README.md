# Lead Filter Query API

A standalone Express + TypeScript service implementing a multi-tenant CRM
"Leads" query endpoint with a flexible AND/OR filter DSL over system
columns and EAV-style custom fields.

## Stack

- Node 20+, Express, TypeScript
- Postgres (raw `pg` driver, hand-written parameterized SQL — no ORM)
- Zod for request validation

## 1. Setup

```bash
npm install
cp .env.example .env
# edit .env if your Postgres connection details differ
```

`.env`:

```
PORT=3000
DATABASE_URL=postgres://postgres:pass@localhost:5432/lead_query_api
```

## 2. Create the database

If the `lead_query_api` database doesn't exist yet, create it first
(e.g. via psql or pgAdmin):

```sql
CREATE DATABASE lead_query_api;
```

## 3. Migrate + seed

The seed script applies `src/db/schema.sql` (idempotent — safe to
re-run) and then loads sample data.

```bash
npm run seed
```

This truncates and reloads the tables every time it runs, so it's safe
to run repeatedly during development.

## 4. Run the server

```bash
npm run dev     # ts-node/tsx watch mode
# or
npm run build && npm start
```

Server starts on `http://localhost:3000`.

## Seed data / fixed IDs

| Entity | ID |
| --- | --- |
| Tenant A | `aaaaaaaa-0000-0000-0000-000000000001` |
| Tenant B | `bbbbbbbb-0000-0000-0000-000000000002` |
| Admin A (role: admin) | `aaaaaaaa-0000-0000-0000-0000000000a1` |
| Agent A1 (role: agent) | `aaaaaaaa-0000-0000-0000-0000000000a2` |
| Agent A2 (role: agent) | `aaaaaaaa-0000-0000-0000-0000000000a3` |
| Custom field "City" | `aaaaaaaa-0000-0000-0000-0000000000c1` |

Tenant A leads: Ram Kumar (→ Agent A1, Chennai), Ramesh (→ Agent A1,
Madurai), Priya (→ Agent A2, Chennai, no follow-up), Anand (unassigned,
Coimbatore), Sita (→ Agent A2, Chennai).

Tenant B has one lead ("Kumar B") that must never appear in Tenant A
queries.

## Example curls

### 1. Admin — City contains "Chennai" AND assigned to Agent A2

```bash
curl -s -X POST 'http://localhost:3000/api/v1/leads/query?page=1&limit=20' \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: aaaaaaaa-0000-0000-0000-000000000001' \
  -H 'x-user-id: aaaaaaaa-0000-0000-0000-0000000000a1' \
  -H 'x-user-role: admin' \
  -d '{
    "logic": "AND",
    "filters": [
      { "fieldId": "aaaaaaaa-0000-0000-0000-0000000000c1", "fieldType": "string", "condition": "contain", "value": "Chennai" },
      { "fieldId": "assignedTo", "fieldType": "string", "condition": "is", "value": "aaaaaaaa-0000-0000-0000-0000000000a3", "inputType": "multiselect" }
    ]
  }'
```

Expect: Priya, Sita.

### 2. Agent — only sees own leads, sorted by follow-up date

```bash
curl -s -X POST 'http://localhost:3000/api/v1/leads/query?page=1&limit=20&sortBy=followUpDate&sortDirection=asc' \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: aaaaaaaa-0000-0000-0000-000000000001' \
  -H 'x-user-id: aaaaaaaa-0000-0000-0000-0000000000a2' \
  -H 'x-user-role: agent' \
  -d '{ "q": "Ram" }'
```

Expect: Ram Kumar, Ramesh (never Priya/Anand/Sita — agent visibility).

### 3. Free-text search by phone digits

```bash
curl -s -X POST 'http://localhost:3000/api/v1/leads/query' \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: aaaaaaaa-0000-0000-0000-000000000001' \
  -H 'x-user-id: aaaaaaaa-0000-0000-0000-0000000000a1' \
  -H 'x-user-role: admin' \
  -d '{ "q": "9000000003" }'
```

Expect: Priya.

### 4. Missing auth headers → 401

```bash
curl -s -X POST 'http://localhost:3000/api/v1/leads/query' -d '{}'
```

### 5. Invalid operator → 400

```bash
curl -s -X POST 'http://localhost:3000/api/v1/leads/query' \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: aaaaaaaa-0000-0000-0000-000000000001' \
  -H 'x-user-id: aaaaaaaa-0000-0000-0000-0000000000a1' \
  -H 'x-user-role: admin' \
  -d '{ "filters": [{ "fieldId": "name", "fieldType": "string", "condition": "greater than", "value": "x" }] }'
```

## Design decisions & tradeoffs

- **No ORM, raw parameterized SQL.** The filter DSL compiles directly
  to SQL fragments (`src/services/filters.ts`), which makes AND/OR
  composition and EAV `EXISTS` subqueries much easier to control than
  going through an ORM's query builder. Every value is passed as a
  bound parameter — no string concatenation of user input.
- **id-then-hydrate pattern.** The controller first selects matching
  `id`s (filtered, sorted, paginated), then fetches full rows by
  `id = ANY(...)` and joins custom field values in one extra query.
  This avoids row-multiplication from the EAV join affecting
  pagination/counts, and avoids N+1 queries when hydrating custom
  fields for a page of leads.
- **Empty-value semantics for custom fields.** `is empty` is defined
  as "no matching row in `lead_custom_field_values`, OR a row with a
  null/empty value" — i.e. both "field never set" and "field set to
  blank" count as empty. This felt like the more intuitive behavior
  for end users filtering a CRM.
- **`is not` / `does not contain` on nullable columns** (email,
  assignedTo) treat `NULL` as satisfying "not equal to X" — a lead
  with no email is considered to not-equal any specific email value.
- **Agent multiselect fields** (`assignedTo`, `createdBy`) use
  `= ANY($1)` / `<> ALL($1)` with a Postgres array parameter rather
  than building `IN (...)` with N placeholders — simpler parameter
  bookkeeping and no dynamic placeholder counting.
- **Date match on `is`** uses `column::date = value::date` so it works
  uniformly for both `DATE` columns (`follow_up_date`) and
  `TIMESTAMPTZ` columns (`created_at`, `updated_at`).
- **Sorting nulls:** `follow_up_date` sorts `NULLS LAST` regardless of
  direction, so leads with no follow-up date don't dominate an
  ascending sort.
- **Validation:** query params and body are both validated with Zod
  before touching the database; a failed validation always yields a
  clean `400` with a specific message via `BadRequestError`.

### Indexes for production filter load

Already included in `schema.sql`:
- `(tenant_id)`, `(tenant_id, assigned_to)`, `(tenant_id, created_at)`,
  `(tenant_id, follow_up_date)` — covers the mandatory tenant scoping
  plus the two sortable/filterable system columns.
- `(field_id, lead_id)` on `lead_custom_field_values` — supports the
  `EXISTS` subquery pattern (`field_id = ? AND lead_id = leads.id`)
  efficiently.
- `pg_trgm` GIN indexes on `leads.name` and `leads.phone` — speeds up
  `ILIKE '%...%'` free-text search, which a plain B-tree index can't
  accelerate.

With more time I'd add a similar trigram index on
`lead_custom_field_values.value` for large tenants doing heavy custom
field text search, and consider a covering index strategy once real
query patterns are known (e.g. `EXPLAIN ANALYZE` on production-shaped
data).

## Time spent / what I'd improve with another day

Time spent: roughly a day end-to-end (schema design, filter compiler,
controller, seed, README).

With another day I would add:
- Automated tests (unit tests for `buildLeadFilterClause` covering
  each operator/field-type combination; integration tests against a
  test database for the full endpoint).
- OpenAPI/Swagger spec for the endpoint.
- A stricter multiselect validator (currently any comma-separated
  string is accepted for agent fields; would validate each segment is
  a UUID and return 400 otherwise).
- Support for `custom_fields.status = false` fields being silently
  excluded from filtering (spec allows skipping this if not easy —
  currently not enforced).
