---
description: "Raise the buyer invoices for a sale, or list invoices."
---

# invoices

To list: `node scripts/auction.mjs invoices [--sale=] [--unpaid] --json`. For one invoice: `node scripts/auction.mjs invoice <INV-ref> --json`.

To raise invoices after a sale: first `node scripts/auction.mjs invoice <sale> --dry-run --json` and show each buyer's hammer, premium, GST and total, plus the artist resale royalties the sale created. Then, on the operator's yes, `node scripts/auction.mjs invoice <sale> --json`. Every lot needs a result first. Existing invoices are kept, never changed. `npm run docs -- buyer-invoice` renders them in your brand.
