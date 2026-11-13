---
description: "Run the vendor settlements for a sale, check them and approve them."
---

# settle

1. `node scripts/auction.mjs settle <sale> --dry-run --json` and show each vendor: lots settled, lots held (buyer not paid, or a taonga waiting for a registered collector), hammer, commission, lot fees, GST, artist resale royalty deducted, and net.
2. On the operator's yes, `node scripts/auction.mjs settle <sale> --json`. Drafts can be rerun; approved settlements are kept.
3. `node scripts/auction.mjs approve <settlement|sale>` only on the operator's yes. `npm run docs -- vendor-settlement` renders the statements.
4. When the money has left: `node scripts/auction.mjs mark-paid <settlement|sale> --date=YYYY-MM-DD`. It refuses a vendor with no bank account on file.
