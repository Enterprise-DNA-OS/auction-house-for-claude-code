---
description: "The catalogue for one sale, or put a lot into a sale."
---

# catalogue

To show a sale: `node scripts/auction.mjs catalogue <sale> --json`. Present lot number, title, artist, estimate range, reserve and the top absentee bid. Point out lots with no reserve and lots where the top absentee bid already covers the reserve.

To put a lot into a sale: `node scripts/auction.mjs catalogue-lot <lot> --sale=<sale> [--lot-number=N] --json`. Without a lot number it takes the next one. A lot passed in at an earlier sale can be re-offered this way; set a new reserve first with `node scripts/auction.mjs set lot <lot> --reserve=...` if the vendor agreed one.
