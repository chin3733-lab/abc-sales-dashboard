'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

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

const MONTHLY_TARGETS: Record<string, number> = {
  'Mid Valley': 85000,
  'Pavilion KL': 95000,
  'Jaya Shopping Centre': 60000,
  'KSL City JB': 65000,
};

const OUTLETS = ['Mid Valley', 'Pavilion KL', 'Jaya Shopping Centre', 'KSL City JB'];

const fmtRM = (v: number) =>
  'RM ' + Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtRMAxis = (v: number) => `RM ${(v / 1000).toFixed(0)}k`;

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-2 tracking-tight">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState('2026-06-30');
  const [selectedOutlet, setSelectedOutlet] = useState('All');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const PAGE = 1000;
    const allRows: SaleRow[] = [];
    let from = 0;
    let done = false;
    while (!done) {
      const { data: rows, error } = await supabase
        .from('sales_data')
        .select('order_id,date,outlet,product,category,quantity,unit_price,discount_pct,amount,payment_method')
        .range(from, from + PAGE - 1);
      if (error) { console.error('Supabase error:', error.message); break; }
      allRows.push(...(rows as SaleRow[]));
      if (!rows || rows.length < PAGE) done = true;
      else from += PAGE;
    }
    setData(allRows);
    setLoading(false);
    }
    loadData();
  }, []);

  const filtered = useMemo(
    () =>
      data.filter((row) => {
        const inRange = row.date >= dateFrom && row.date <= dateTo;
        const inOutlet = selectedOutlet === 'All' || row.outlet === selectedOutlet;
        return inRange && inOutlet;
      }),
    [data, dateFrom, dateTo, selectedOutlet]
  );

  const totalSales = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);
  const totalOrders = filtered.length;
  const avgOrder = totalOrders ? totalSales / totalOrders : 0;

  const salesByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => {
      const m = r.date.slice(0, 7);
      map[m] = (map[m] || 0) + r.amount;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-MY', {
          month: 'short',
          year: 'numeric',
        }),
        amount: Math.round(amount),
      }));
  }, [filtered]);

  // Sales by outlet always shows all outlets (unaffected by outlet dropdown)
  const salesByOutlet = useMemo(() => {
    const map: Record<string, number> = {};
    data
      .filter((r) => r.date >= dateFrom && r.date <= dateTo)
      .forEach((r) => {
        map[r.outlet] = (map[r.outlet] || 0) + r.amount;
      });
    return OUTLETS.map((outlet) => ({
      outlet: outlet === 'Jaya Shopping Centre' ? 'Jaya SC' : outlet,
      amount: Math.round(map[outlet] || 0),
    }));
  }, [data, dateFrom, dateTo]);

  const salesByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => {
      map[r.product] = (map[r.product] || 0) + r.amount;
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([product, amount]) => ({ product, amount: Math.round(amount) }));
  }, [filtered]);

  const targetData = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const months =
      (to.getFullYear() - from.getFullYear()) * 12 +
      (to.getMonth() - from.getMonth()) +
      1;

    const actualMap: Record<string, number> = {};
    data
      .filter((r) => r.date >= dateFrom && r.date <= dateTo)
      .forEach((r) => {
        actualMap[r.outlet] = (actualMap[r.outlet] || 0) + r.amount;
      });

    const outletList = selectedOutlet === 'All' ? OUTLETS : [selectedOutlet];
    return outletList.map((outlet) => {
      const target = MONTHLY_TARGETS[outlet] * months;
      const actual = Math.round(actualMap[outlet] || 0);
      const diff = actual - target;
      const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
      return { outlet, target, actual, diff, pct };
    });
  }, [data, dateFrom, dateTo, selectedOutlet]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAiSummary(null);
    setAiError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          selectedOutlet,
          totalSales: Math.round(totalSales),
          totalOrders,
          avgOrder: Math.round(avgOrder),
          salesByMonth,
          salesByOutlet,
          salesByProduct,
          targetData,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setAiError(json.error);
      } else {
        setAiSummary(json.summary);
      }
    } catch {
      setAiError('Could not connect. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-base">Loading dashboard…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">ABC SDN BHD</h1>
            <p className="text-sm text-gray-400 mt-0.5">Sales Dashboard</p>
          </div>
          <span className="text-xs text-gray-400">
            {new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex flex-wrap gap-5 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Outlet</label>
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All Outlets</option>
              {OUTLETS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="ml-auto flex items-center gap-2 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            {analyzing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Analyzing…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Analyze
              </>
            )}
          </button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard label="Total Sales" value={fmtRM(totalSales)} />
          <KpiCard label="Total Orders" value={totalOrders.toLocaleString()} />
          <KpiCard label="Avg Order Value" value={fmtRM(Math.round(avgOrder))} />
        </div>

        {/* AI Summary Card */}
        {(aiSummary || aiError) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <h2 className="text-sm font-semibold text-gray-700">AI Management Summary</h2>
            </div>
            {aiError ? (
              <p className="text-sm text-red-500">{aiError}</p>
            ) : (
              <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
                {aiSummary!.split('\n').filter(Boolean).map((line, i) => {
                  const isBold = line.startsWith('**') && line.endsWith('**');
                  const cleaned = line.replace(/\*\*/g, '');
                  return isBold ? (
                    <p key={i} className="font-semibold text-gray-900 mt-3 first:mt-0">{cleaned}</p>
                  ) : (
                    <p key={i} className="text-gray-600">{cleaned}</p>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sales by Month */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Sales by Month</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={salesByMonth} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={fmtRMAxis} />
                <Tooltip
                  formatter={(v) => [fmtRM(v as number), 'Sales']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#3B82F6"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#3B82F6' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sales by Outlet */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Sales by Outlet</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={salesByOutlet} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="outlet" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={fmtRMAxis} />
                <Tooltip
                  formatter={(v) => [fmtRM(v as number), 'Sales']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
                <Bar dataKey="amount" fill="#6366F1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales by Product */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Top Products by Sales</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={salesByProduct}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 130, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickFormatter={fmtRMAxis}
              />
              <YAxis
                type="category"
                dataKey="product"
                tick={{ fontSize: 11, fill: '#374151' }}
                width={130}
              />
              <Tooltip
                formatter={(v) => [fmtRM(v as number), 'Sales']}
                contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
              />
              <Bar dataKey="amount" fill="#10B981" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Target Section */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700">Outlet Targets vs Actual</h2>
          <p className="text-xs text-gray-400 mt-1 mb-5">
            Target is prorated across the selected date range.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Outlet
                  </th>
                  <th className="text-right pb-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Target
                  </th>
                  <th className="text-right pb-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Actual
                  </th>
                  <th className="text-right pb-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Difference
                  </th>
                  <th className="text-right pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Achievement
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {targetData.map((row) => (
                  <tr key={row.outlet} className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 pr-6 font-semibold text-gray-900">{row.outlet}</td>
                    <td className="py-4 pr-6 text-right text-gray-500">{fmtRM(row.target)}</td>
                    <td className="py-4 pr-6 text-right font-semibold text-gray-900">
                      {fmtRM(row.actual)}
                    </td>
                    <td
                      className={`py-4 pr-6 text-right font-semibold ${
                        row.diff >= 0 ? 'text-emerald-600' : 'text-red-500'
                      }`}
                    >
                      {row.diff >= 0 ? '+' : '-'}
                      {fmtRM(row.diff)}
                    </td>
                    <td className="py-4 text-right">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                          row.pct >= 100
                            ? 'bg-emerald-50 text-emerald-700'
                            : row.pct >= 80
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {row.pct >= 100 ? '↑' : '↓'} {row.pct}%{' '}
                        {row.pct >= 100 ? 'Ahead' : 'Behind'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-gray-300 pb-4 text-center">
          ABC SDN BHD · Sales Dashboard · Data from sales_dashboard_sample.xlsx
        </p>
      </div>
    </div>
  );
}
