---
description: "Artist resale royalties: what is owed, to whom, and when it must be reported."
---

# royalties

Run `node scripts/auction.mjs royalties --json`. Show lot, artist, sale price, royalty, the agency, the report deadline and the state. When the operator confirms a report went in (and the money with it): `node scripts/auction.mjs report-royalty <lot> --date=YYYY-MM-DD [--paid]`. The rules and their sources are in `docs/compliance.md`.
