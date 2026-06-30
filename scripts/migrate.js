// Reads .env.local, creates the sales_data table, and inserts all rows from sales_data.json
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Read .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envVars = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) envVars[key.trim()] = val.join('=').trim();
});

const PROJECT_REF = 'pkgapilmzcpqjoxrejtw';
const DB_PASSWORD = envVars['SUPABASE_DB_PASSWORD'];

if (!DB_PASSWORD) {
  console.error('SUPABASE_DB_PASSWORD not found in .env.local');
  process.exit(1);
}

const encodedPassword = encodeURIComponent(DB_PASSWORD);
const connectionString = `postgresql://postgres:${encodedPassword}@db.${PROJECT_REF}.supabase.co:5432/postgres`;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sales_data (
  id          SERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL,
  date        DATE NOT NULL,
  outlet      TEXT NOT NULL,
  product     TEXT NOT NULL,
  category    TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(10,2) NOT NULL,
  payment_method TEXT NOT NULL
);
`;

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Supabase database.');

  // Create table
  await client.query(CREATE_TABLE_SQL);
  console.log('Table created (or already exists).');

  // Load data
  const dataPath = path.join(__dirname, '..', 'public', 'sales_data.json');
  const rows = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Inserting ${rows.length} rows...`);

  // Clear existing data
  await client.query('TRUNCATE TABLE sales_data RESTART IDENTITY');

  // Batch insert in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r, idx) => {
      const base = idx * 10;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10})`;
    }).join(',');
    const params = chunk.flatMap(r => [
      r.order_id, r.date, r.outlet, r.product, r.category,
      r.quantity, r.unit_price, r.discount_pct, r.amount, r.payment_method
    ]);
    await client.query(
      `INSERT INTO sales_data (order_id,date,outlet,product,category,quantity,unit_price,discount_pct,amount,payment_method) VALUES ${values}`,
      params
    );
    console.log(`  Inserted rows ${i + 1}–${Math.min(i + CHUNK, rows.length)}`);
  }

  const { rows: countRows } = await client.query('SELECT COUNT(*) FROM sales_data');
  console.log(`\nDone. Total rows in Supabase: ${countRows[0].count}`);
  await client.end();
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
