import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../migrations/202610030002_appearance_preferences_v2.sql', import.meta.url);

test('appearance migration uses a per-user primary key and independent allowlisted fields', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /user_id uuid primary key references auth\.users \(id\) on delete cascade/i);
  assert.match(sql, /theme text not null default 'sub-zero'[\s\S]*check \(theme in \('sub-zero', 'onyx', 'cosmic', 'emerald', 'ghost'\)\)/i);
  assert.match(sql, /layout text not null default 'current'[\s\S]*check \(layout in \('current', 'reworked-old', 'new'\)\)/i);
  assert.match(sql, /enable row level security/i);
});

test('authenticated policies scope reads and writes to auth.uid and table grants are narrow', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /grant select, insert, update on table public\.list_r_appearance_preferences_v2 to authenticated/i);
  assert.match(sql, /for select to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(sql, /for insert to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(sql, /for update to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(sql, /revoke all on table public\.list_r_appearance_preferences_v2 from public, anon, authenticated/i);
});
