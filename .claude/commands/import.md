---
description: "Bring consignors and inventory across from Auction Flex or another system."
---

# import

Read `docs/replace-auction-flex.md` first. Order: consignors, then lots.

1. `node scripts/auction.mjs import auction-flex --kind=consignors --file=<consignors.csv> --dry-run --json`
2. `node scripts/auction.mjs import auction-flex --kind=lots --file=<inventory.csv> [--saleroom=AKL] --dry-run --json`

Show the counts and warnings from each dry run. Different column names take `--mapping=<file.json>` (for example `{"title": "Lead Line", "low": "Est Low"}`). Run without `--dry-run` only when the operator says go. Then `/consignments` to record agreement dates and terms, which the export does not carry.
