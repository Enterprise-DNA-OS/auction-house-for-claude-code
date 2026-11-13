---
description: "The absentee and phone bid book for a sale, or take a new bid."
---

# absentee

To show the book: `node scripts/auction.mjs absentee <sale> --json`. Group by lot, highest bid first, and say for each lot whether the top bid covers the reserve.

To take a bid: `node scripts/auction.mjs bid <lot> --bidder=<client> --max=<dollars> [--kind=phone] --json`. A second bid from the same bidder on the same lot replaces the first. Add the bidder first with `/add` if they are new, and check their identity is recorded before the sale.
