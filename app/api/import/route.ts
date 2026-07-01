import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type SaleRow = {
  order_id: string;
  date: string;
  outlet: string;
  product: string;
  category: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  amount: number;
  payment_method: string;
};

const REQUIRED_COLUMNS = [
  'order_id', 'date', 'outlet', 'product', 'category',
  'quantity', 'unit_price', 'discount_pct', 'amount', 'payment_method',
];

export async function POST(req: Request) {
  try {
    const { rows }: { rows: Record<string, unknown>[] } = await req.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found in the file.' }, { status: 400 });
    }

    const toNum = (v: unknown): number => { const n = Number(v ?? 0); return isNaN(n) ? 0 : n; };

    // Normalise column names: lowercase + trim
    const normalised: SaleRow[] = rows.map((raw) => {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        r[k.toLowerCase().trim().replace(/\s+/g, '_')] = v;
      }

      const missing = REQUIRED_COLUMNS.filter((c) => !(c in r));
      if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);

      // Normalise date to YYYY-MM-DD
      let dateStr = String(r.date ?? '');
      if (/^\d{5}$/.test(dateStr)) {
        const d = new Date(Math.round((Number(dateStr) - 25569) * 86400 * 1000));
        dateStr = d.toISOString().slice(0, 10);
      } else if (dateStr.includes('T')) {
        dateStr = dateStr.slice(0, 10);
      }

      return {
        order_id: String(r.order_id ?? ''),
        date: dateStr,
        outlet: String(r.outlet ?? ''),
        product: String(r.product ?? ''),
        category: String(r.category ?? ''),
        quantity: toNum(r.quantity),
        unit_price: toNum(r.unit_price),
        discount_pct: toNum(r.discount_pct),
        amount: toNum(r.amount),
        payment_method: String(r.payment_method ?? ''),
      };
    });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Clear existing data
    const { error: delErr } = await supabase
      .from('sales_data')
      .delete()
      .neq('id', 0);
    if (delErr) throw new Error(`Failed to clear old data: ${delErr.message}`);

    // Insert in batches of 500
    const BATCH = 500;
    for (let i = 0; i < normalised.length; i += BATCH) {
      const { error } = await supabase
        .from('sales_data')
        .insert(normalised.slice(i, i + BATCH));
      if (error) throw new Error(`Insert failed at row ${i}: ${error.message}`);
    }

    return NextResponse.json({ count: normalised.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
