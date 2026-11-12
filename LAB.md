# How the scanner gets more accurate (and stays that way)

Every disagreement between Louis's label and the scanner ends in one of three places. Nothing is
fixed "just in the prompt" or for one store.

| The cause | Where the fix lives | Example |
| --- | --- | --- |
| The rule was unclear or open to interpretation | **Airtable**: Pass when / Fail when / Not relevant when, Niche notes, Seen in, Page Type | "At least one gallery image shows the product worn" instead of "lifestyle shots" |
| The scanner could not see it | **Capture code** (`lib/scanV2/capture.ts`), listed in the Airtable **Code check** field when it decides an answer | Product tabs opened; gallery frame shapes measured on the page |
| The AI broke a written rule more than once | A generic judge rule (`lib/scanV2/judge.ts`), or as a last resort a code check listed in **Code check** | "Words in the page text never prove a photo exists" |

A wrong label is the fourth outcome: then the label changes, not the scanner.

## Acceptance

1. **Labels are the acceptance criteria.** A checkpoint goes Live at 90% agreement with Louis's labels
   on 5+ stores, with few flips between runs (`lib/lab/verdict.ts`).
2. **Every change is re-judged against all labels** (`/api/lab/rejudge`) before it ships. It ships only
   if agreement does not drop beyond run-to-run noise (about 1 point overall). Changes that did not
   beat the baseline stay off behind a flag (gallery overview, full Shopify gallery).
3. **Capture changes are measured on new labels**, not by re-scanning labelled stores: a re-scan
   changes the evidence (store updates, EU vs US version) and the old labels no longer fit.
4. **Couldn't check** never counts as a disagreement: it is coverage, shown apart.
5. **A rewritten definition invalidates its labels.** Clear them (keep a backup), relabel, then measure.

## Where things are

- Definitions, page types, "Seen in", "Code check": Airtable checklist base `app1HP8C17pAMjacf`.
- Code checks: `lib/scanV2/guards.ts` (each one named in Airtable "Code check").
- Measurements: `lib/scanV2/measured.ts`.
- The lab: `/scan/lab` (labels, review/blind mode, promote, re-judge).
