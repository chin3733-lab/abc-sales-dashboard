import { NextResponse } from 'next/server';

type MonthRow = { month: string; amount: number };
type OutletRow = { outlet: string; amount: number };
type ProductRow = { product: string; amount: number };
type TargetRow = { outlet: string; target: number; actual: number; diff: number; pct: number };

type AnalyzePayload = {
  dateFrom: string;
  dateTo: string;
  selectedOutlet: string;
  totalSales: number;
  totalOrders: number;
  avgOrder: number;
  salesByMonth: MonthRow[];
  salesByOutlet: OutletRow[];
  salesByProduct: ProductRow[];
  targetData: TargetRow[];
};

function buildPrompt(d: AnalyzePayload): string {
  const fmt = (n: number) => `RM ${n.toLocaleString('en-MY')}`;

  const monthTrend = d.salesByMonth
    .map((m) => `  ${m.month}: ${fmt(m.amount)}`)
    .join('\n');

  const targets = d.targetData
    .map(
      (t) =>
        `  ${t.outlet}: Target ${fmt(t.target)}, Actual ${fmt(t.actual)}, ${t.pct}% (${t.pct >= 100 ? 'Ahead' : 'Behind'})`
    )
    .join('\n');

  const topProducts = d.salesByProduct
    .slice(0, 5)
    .map((p) => `  ${p.product}: ${fmt(p.amount)}`)
    .join('\n');

  return `You are a business analyst briefing a busy retail business owner in Malaysia. Analyze this sales data and give a SHORT, clear summary.

Date Range: ${d.dateFrom} to ${d.dateTo}
Outlet Filter: ${d.selectedOutlet}
Total Sales: ${fmt(d.totalSales)}
Total Orders: ${d.totalOrders.toLocaleString()}
Avg Order Value: ${fmt(d.avgOrder)}

Monthly Sales Trend:
${monthTrend}

Outlet Performance vs Target:
${targets}

Top Products:
${topProducts}

Respond in EXACTLY this format — nothing else:

**What's doing well**
[Write 1–2 short sentences. Be specific with numbers.]

**What needs attention**
[Write 1–2 short sentences. Be specific with numbers.]

**One action to take now**
[Write 1 clear, direct sentence.]

Rules: No jargon. No bullet points inside sections. No markdown other than the bold headers. Write like a smart colleague briefing a busy boss. Short and clear.`;
}

export async function POST(req: Request) {
  try {
    const data: AnalyzePayload = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not set up on the server.' }, { status: 500 });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(data) }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 800,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return NextResponse.json(
        { error: 'Could not reach the AI. Check that the API key is correct.' },
        { status: 502 }
      );
    }

    const result = await geminiRes.json();
    const text: string =
      result.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from AI.';

    return NextResponse.json({ summary: text });
  } catch (err) {
    console.error('Analyze route error:', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
