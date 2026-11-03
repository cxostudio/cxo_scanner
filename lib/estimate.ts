// Store economics from the three figures asked on cxo.studio/start (revenue, average order
// value, conversion rate). Band midpoints only: right order of magnitude, never exact.
// Visitors and revenue per visitor are derived: revenue = visitors × conversion × AOV.
// Option values must match cxo-studio src/data/content.ts (start.revenue / aov / cr).

const REVENUE: Record<string, number> = {
  "Under €10,000 / month": 6000,
  "€10,000–€50,000 / month": 30000,
  "€50,000–€100,000 / month": 75000,
  "Over €100,000 / month": 150000,
};
const AOV: Record<string, number> = { "<40": 30, "40-80": 60, "80-150": 110, "150+": 220 };
const CR: Record<string, number> = { "<1": 0.007, "1-2": 0.015, "2-3": 0.025, "3+": 0.035 };
/** used when the visitor doesn't know their conversion rate */
export const BENCHMARK_CR = 0.014;

export type Estimate = {
  revenue: number;
  aov?: number;
  cr?: number; // 0-1
  crIsBenchmark?: boolean;
  orders?: number;
  visitors?: number;
  rpv?: number; // revenue per visitor
  lift10: number; // extra monthly revenue from a 10% conversion lift
};

export function estimate(revenueBand: string, aovBand: string, crBand: string): Estimate | null {
  const revenue = REVENUE[revenueBand];
  if (!revenue) return null;
  const out: Estimate = { revenue, lift10: revenue * 0.1 };
  const aov = AOV[aovBand];
  if (!aov) return out;
  const known = CR[crBand];
  const cr = known ?? BENCHMARK_CR;
  out.aov = aov;
  out.cr = cr;
  out.crIsBenchmark = !known;
  out.orders = revenue / aov;
  out.visitors = out.orders / cr;
  out.rpv = aov * cr;
  return out;
}

export const eur = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const num = (n: number) => new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(Math.round(n / 100) * 100);
