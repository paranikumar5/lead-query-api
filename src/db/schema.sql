-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. TENANTS
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','agent'))
);

-- 3. CUSTOM FIELDS
CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('string','number','date','boolean')),
  status BOOLEAN NOT NULL DEFAULT true
);

-- 4. LEADS
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  country_code TEXT,
  e164 TEXT,
  email TEXT,
  assigned_to UUID REFERENCES users(id),
  follow_up_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. LEAD CUSTOM FIELD VALUES (EAV)
CREATE TABLE IF NOT EXISTS lead_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  UNIQUE (lead_id, field_id)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(tenant_id, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_lcfv_lookup ON lead_custom_field_values(field_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON leads USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm ON leads USING gin (phone gin_trgm_ops);
