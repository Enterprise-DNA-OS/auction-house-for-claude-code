---
description: "Check the records against the rules in docs/compliance.md (artist resale royalty, taonga tūturu, cash, consignment agreements, vendor settlements, GST) and report what is breached, held or due, with the rule cited."
---

# compliance

1. Read `docs/compliance.md`.
2. Run `node scripts/auction.mjs compliance --json`.
3. Report as a table: severity (breach, hold, due, check), rule, record, finding. Breaches first. Cite the source for each rule from `docs/compliance.md`.
4. For each breach, say the fix: the record to update, the report to make, or the note to draft (to `drafts/`, never sent).
5. If a rule in `docs/compliance.md` is out of date, say so and stop. Do not guess at law.

Nothing here is legal advice. The doc records the rules the operator has told the system to enforce, with sources.
