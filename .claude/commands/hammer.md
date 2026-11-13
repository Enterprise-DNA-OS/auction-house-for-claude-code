---
description: "Record sale results: the hammer price and buyer, a pass, or a withdrawal."
---

# hammer

Clerk sheet in, results out. For each lot:

- Sold: `node scripts/auction.mjs hammer <lot> --price=<dollars> --buyer=<client or paddle name> --json`. A price below the reserve is refused unless the vendor agreed (`--below-reserve`).
- Passed in: `node scripts/auction.mjs pass <lot>`.
- Withdrawn: `node scripts/auction.mjs withdraw <lot>`.

A taonga tūturu with no certificate of examination cannot be sold. Report every warning (for example a taonga knocked down to a buyer who is not a registered collector). When every lot has a result, offer `/invoices` to raise the buyer invoices.
