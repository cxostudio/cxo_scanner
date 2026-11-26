# Checkpoints, statuses and test stores

## Where checkpoints live
Airtable base `app1HP8C17pAMjacf`, table **Conversion Checkpoints** (368 records on 26 Nov 2026).
Airtable is the single source of truth: question, pass / fail / not-relevant definitions, device, niches,
check method, page type and status. Mapping to code: `lib/conversionCheckpoints/getCheckpointRules.ts`.

## The three statuses (field "Scanner status")
| Status | Count | Who sees it |
|---|---|---|
| **Live** | 184 | Every scan: free scan and paid report |
| **Draft** | 69 | Test scans only (see below). Being trained: not shown to customers |
| **Off** | 115 | Nobody. Never leaves Airtable (not fetched at all) |

Archived records are ignored like Off.

## The filters, in order
1. **Fetched from Airtable** (`SCANNER_FORMULA` in `getCheckpointRules.ts`):
   `AND(NOT({Archived}), OR({Scanner status}='Live', {Scanner status}='Draft'))`
2. **Status** (`ruleIsScannable` in `filterByUrlPageType.ts`): Live always; Draft only when `includeDrafts`.
3. **`includeDrafts` = test scan** = the email matches `isTestEmail()` in `pageType.ts`:
   any `@cxo.studio` address, or any address with `+test` before the @ (e.g. `you+test@gmail.com`).
   Test scans also skip the "homepage → best seller" swap: they scan exactly the URL given.
   `/lab` re-judges with drafts on.
4. **Check method**: `Manual (audit only)` and `Customer upload` are never run by the scanner,
   whatever the status (`NOT_SCANNABLE_METHODS`). Scannable: `AI on screenshots`, `Measured`, `AI + measured`.
   A Draft `Measured` rule with no measurement yet comes back as "unknown".
5. **Page type** (field "Page Type", `getRequiredPageTypeIds`):
   - homepage URL → General + Home Page
   - product URL → General + Product + Cart (+ Checkout for test scans and the paid report)
   - collection URL → General + Category
   - anything else → General
6. **Niches / device / seen in**: applied by the judge from the Airtable fields
   ("Niches", "Not relevant for niches", "Device", "Seen in").

## Draft and Off by method (26 Nov 2026)
- Draft (69): AI on screenshots 30, Customer upload 16, Manual 11, Measured 9, AI + measured 3.
  By page: Product 20, Checkout 15, Thank you 13, General 8, Cart 5, Home 4, Category 2, Search 1.
- Off (115): no method set 74, AI on screenshots 19, Measured 10, Manual 8, AI + measured 4.
- Full list: `docs/checkpoints-draft-off.csv` (status, method, page, title, record id).

## Promoting a checkpoint
`/lab` (password `LAB_KEY`) → accuracy per checkpoint across test scans → Live / Draft / Audit buttons
write "Scanner status" (and "Check method" for audit) back to Airtable (`app/api/lab/promote`).
Rule of thumb used so far: promote to Live once it's right on the test stores, keep Draft otherwise.

## Test stores
32 stores the full report was run on (Nov 2026): `docs/test-stores.csv`, with the last outcome and known issues.
Open a report: `https://cxo.studio/scan/report?id=<report id>`.
Batch runner used: `POST /scan/api/report/test` (test emails only).

## Environment
`.env.example` lists every variable with what it does. Values only in Vercel: `vercel env pull .env.local`.
