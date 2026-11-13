---
description: "Add a saleroom, client, consignment, lot, sale or absentee bid from a plain description."
---

# add

Turn the description into `node scripts/auction.mjs add <type> --field=value ... --json`. Types: saleroom, client, consignment, sale, lot, bid. Money in dollars, percentages as percentages. Examples:

- `node scripts/auction.mjs add client --name="Aria Patel" --email=aria@example.com --phone="021 555 0113"`
- `node scripts/auction.mjs add consignment --vendor="Aria Patel" --saleroom=AKL --commission=15 --lot-fee=25 --settlement-days=21 --signed=2026-11-13`
- `node scripts/auction.mjs add lot --consignment=CN-108 --title="Lustre jug" --category=ceramics --low=300 --high=500 --reserve=250`
- `node scripts/auction.mjs add sale --name="Winter Sale" --saleroom=AKL --date=2026-12-12 --premium=20`

Read back what was created with its reference. If a name is ambiguous the CLI lists the candidates: ask which.
