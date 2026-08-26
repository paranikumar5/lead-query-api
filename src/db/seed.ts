import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './client';

// Fixed UUIDs so README curls are reproducible.
export const IDS = {
  tenantA: 'aaaaaaaa-0000-0000-0000-000000000001',
  tenantB: 'bbbbbbbb-0000-0000-0000-000000000002',
  adminA: 'aaaaaaaa-0000-0000-0000-0000000000a1',
  agentA1: 'aaaaaaaa-0000-0000-0000-0000000000a2',
  agentA2: 'aaaaaaaa-0000-0000-0000-0000000000a3',
  cityField: 'aaaaaaaa-0000-0000-0000-0000000000c1',
  leadRam: '11111111-0000-0000-0000-000000000001',
  leadRamesh: '11111111-0000-0000-0000-000000000002',
  leadPriya: '11111111-0000-0000-0000-000000000003',
  leadAnand: '11111111-0000-0000-0000-000000000004',
  leadSita: '11111111-0000-0000-0000-000000000005',
  leadTenantB: '22222222-0000-0000-0000-000000000001',
};

async function main() {
  const client = await pool.connect();
  try {
    // Ensure schema exists (idempotent — safe to run repeatedly)
    const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schemaSql);

    // Clean slate for a repeatable seed
    await client.query(
      'TRUNCATE lead_custom_field_values, leads, custom_fields, users, tenants CASCADE'
    );

    await client.query('BEGIN');

    await client.query('INSERT INTO tenants (id, name) VALUES ($1,$2), ($3,$4)', [
      IDS.tenantA,
      'Tenant A',
      IDS.tenantB,
      'Tenant B',
    ]);

    await client.query(
      `INSERT INTO users (id, tenant_id, name, role) VALUES
        ($1,$2,$3,'admin'), ($4,$2,$5,'agent'), ($6,$2,$7,'agent')`,
      [IDS.adminA, IDS.tenantA, 'Admin A', IDS.agentA1, 'Agent A1', IDS.agentA2, 'Agent A2']
    );

    await client.query(
      `INSERT INTO custom_fields (id, tenant_id, label, type, status) VALUES ($1,$2,'City','string',true)`,
      [IDS.cityField, IDS.tenantA]
    );

    const leads = [
      [IDS.leadRam, 'Ram Kumar', '9000000001', 'ram@example.com', IDS.agentA1, '2026-08-10', 5],
      [IDS.leadRamesh, 'Ramesh', '9000000002', 'ramesh@example.com', IDS.agentA1, '2026-07-01', 4],
      [IDS.leadPriya, 'Priya', '9000000003', null, IDS.agentA2, null, 3],
      [IDS.leadAnand, 'Anand', '9000000004', 'anand@example.com', null, '2026-08-15', 2],
      [IDS.leadSita, 'Sita', '9000000005', 'sita@example.com', IDS.agentA2, '2026-08-01', 1],
    ] as const;

    for (const [id, name, phone, email, assignedTo, followUp, daysAgo] of leads) {
      await client.query(
        `INSERT INTO leads (id, tenant_id, user_id, name, phone, country_code, e164, email, assigned_to, follow_up_date, created_at)
         VALUES ($1,$2,$3,$4,$5,'+91',$6,$7,$8,$9, now() - ($10 || ' days')::interval)`,
        [id, IDS.tenantA, IDS.adminA, name, phone, `+91${phone}`, email, assignedTo, followUp, daysAgo]
      );
    }

    const cities: [string, string][] = [
      [IDS.leadRam, 'Chennai'],
      [IDS.leadRamesh, 'Madurai'],
      [IDS.leadPriya, 'Chennai'],
      [IDS.leadAnand, 'Coimbatore'],
      [IDS.leadSita, 'Chennai'],
    ];
    for (const [leadId, city] of cities) {
      await client.query(
        `INSERT INTO lead_custom_field_values (lead_id, field_id, value) VALUES ($1,$2,$3)`,
        [leadId, IDS.cityField, city]
      );
    }

    // Tenant B lead — must never appear in Tenant A queries
    await client.query(
      `INSERT INTO leads (id, tenant_id, user_id, name, phone, country_code, e164, email, created_at)
       VALUES ($1,$2,$3,'Kumar B','9111111111','+91','+919111111111','kumarb@example.com', now())`,
      [IDS.leadTenantB, IDS.tenantB, IDS.adminA]
    );

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(IDS);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
