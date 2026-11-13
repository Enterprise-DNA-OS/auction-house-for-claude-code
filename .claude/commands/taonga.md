---
description: "Taonga tūturu in the saleroom: museum notice, certificate, buyer status."
---

# taonga

Run `node scripts/auction.mjs taonga --json`. For each lot show whether an authorised museum has been notified, the certificate of examination, and whether the buyer is a registered collector. Record a notice or certificate with `node scripts/auction.mjs notify-museum <lot> --date= --certificate=`. A buyer becomes a registered collector through Manatū Taonga, not here: record it with `node scripts/auction.mjs set client <name> --registered-collector=yes` once they show the certificate.
