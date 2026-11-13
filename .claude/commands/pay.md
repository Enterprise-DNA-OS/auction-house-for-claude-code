---
description: "Record a buyer payment."
---

# pay

Run `node scripts/auction.mjs pay <invoice> [--amount=<dollars>] [--method=bank|card|cash|other] [--date=YYYY-MM-DD] --json`. Without an amount it records the full balance. Record a payment only when the operator confirms the money arrived. Cash of $10,000 or more at a New Zealand saleroom is flagged by `/compliance`; for jewellery it is not allowed at all.
