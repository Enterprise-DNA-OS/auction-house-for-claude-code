---
description: "Change a field on a record: estimates, reserves, dates, terms, identity, GST or bank details."
---

# update

Run `node scripts/auction.mjs set <type> <name or ref> --field=value ... --json`. Examples: `set lot L-3003 --reserve=4500`, `set client "Peter Vance" --gst-number=111-222-333 --bank=yes`, `set consignment CN-105 --signed=2026-11-13`. Say back what changed.
