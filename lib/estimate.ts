// Rough store economics from the bands answered on cxo.studio/start. Band midpoints only:
// good enough to show the order of magnitude, never presented as exact.
// Values must match the option values in cxo-studio src/data/content.ts (start.*).

const REVENUE: Record<string, number> = {
  "Under €10,000 / month": 6000,
  "€10,000–€50,000 / month": 30000,
  "€50,000–€100,000 / month": 75000,
  "Over €100,000 / month": 150000,
};
const TRAFFIC: Record<string, number> = { "<5k": 3000, "5k-20k": 12000, "20k-100k": 50000, "100k+": 150000 };
const CR: Record<string, number> = { "<1": 0.007, "1-2": 0.015, "2-3": 0.025, "3+": 0.035 };

export type Estimate = {
  revenue: number;
  visitors?: number;
  rpv?: number; // revenue per visitor
  aov?: number; // average order value
  cr?: number; // conversion rate (0-1)
  lift10: number; // extra monthly revenue from a 10% conversion lift
};

export function estimate(revenueBand: string, trafficBand: string, crBand: string): Estimate | null {
  const revenue = REVENUE[revenueBand];
  if (!revenue) return null;
  const visitors = TRAFFIC[trafficBand];
  const cr = CR[crBand];
  const out: Estimate = { revenue, lift10: revenue * 0.1 };
  if (visitors) {
    out.visitors = visitors;
    out.rpv = revenue / visitors;
    if (cr) {
      const aov = revenue / (visitors * cr);
      out.cr = cr;
      // answers that don't fit together (e.g. tiny traffic, huge revenue) give no AOV
      if (aov >= 8 && aov <= 1500) out.aov = aov;
    }
  }
  return out;
}

export const eur = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
