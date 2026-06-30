// Inserts all rows from sales_data.json into Supabase using the REST API
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read env vars from .env.local
const envLines = readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}

const supabase = createClient(
  env['NEXT_PUBLIC_SUPABASE_URL'],
  env['SUPABASE_SERVICE_ROLE_KEY']
);

const data = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'sales_data.json'), 'utf8'));
console.log(`Loaded ${data.length} rows from sales_data.json`);

// Clear existing rows
const { error: delErr } = await supabase.from('sales_data').delete().neq('id', 0);
if (delErr) console.warn('Clear warning:', delErr.message);

// Insert in batches of 500
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < data.length; i += BATCH) {
  const batch = data.slice(i, i + BATCH);
  const { error } = await supabase.from('sales_data').insert(batch);
  if (error) {
    console.error(`Error at row ${i}:`, error.message);
    process.exit(1);
  }
  inserted += batch.length;
  console.log(`  Inserted ${inserted} / ${data.length}`);
}

const { count } = await supabase.from('sales_data').select('*', { count: 'exact', head: true });
console.log(`\nDone. Total rows in Supabase: ${count}`);
