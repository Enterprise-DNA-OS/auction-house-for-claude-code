# Moving from Auction Flex

Two files come across: your consignor list and your inventory. Sales already settled stay in Auction Flex (or as PDFs) for your records; you start here with the next sale.

## 1. Export from Auction Flex

- **Consignors.** Your consignor list as a spreadsheet saved as CSV, with the consignor number, name, email and phone.
- **Inventory.** Every item not yet sold, as CSV: inventory number, consignor number and name, title or description, artist, category, low and high estimate, reserve and the date it came in.

If a report only saves as Excel, open it and save it as CSV. Keep the files somewhere private: they hold client details.

## 2. Import, dry run first

```bash
node scripts/auction.mjs import auction-flex --kind=consignors --file=consignors.csv --dry-run
node scripts/auction.mjs import auction-flex --kind=lots --file=inventory.csv --saleroom=AKL --dry-run
```

Each dry run reports how many records it would create, how many it skips, and a warning for every row it cannot read. Nothing is written. When the counts look right, run the same commands without `--dry-run`.

The reader understands the common column names (`Consignor #`, `Consignor Name`, `Title`, `Artist`, `Low Estimate`, `High Estimate`, `Reserve`, `Inventory #`, `Date Received`). If yours are different, give a mapping file:

```json
{ "vendor": "Seller", "vendor_code": "Seller No", "title": "Lead Line", "low": "Est Low", "high": "Est High", "inventory": "Item No" }
```

and add `--mapping=map.json`.

## 3. What maps

| Auction Flex | Here |
|---|---|
| Consignor number and name | `clients` (the number is kept in the note, so a second import finds them again) |
| Inventory item | `lots`, referenced `AF-<inventory number>`, so a repeat import adds nothing twice |
| Consignor plus date received | `consignments`, one per consignor per day |
| Category or title words | `category` (painting, print, sculpture, photograph, jewellery, furniture, ceramics, books, wine, collectables, or general) |
| Low, high, reserve | the estimates and reserve |

## 4. What does not come across

- **Consignment terms.** Agreement dates, commission and settlement days per consignor are not in a standard inventory export. Set them with `/update` (`set consignment CN-... --signed= --commission= --settlement-days=`). Until the agreement date is set, `/compliance` flags any lot of theirs in a sale.
- **Sale history, invoices and settlements already paid.** These stay in Auction Flex.
- **Bidder registrations and online bidding.** Online bidding platforms stay as they are; results come in through `/hammer`.
- **Identity, GST and bank details.** Check each client with `/clients` and fill the gaps with `/update`.
- **Taonga tūturu and royalty details.** Mark taonga (`set lot ... --taonga=yes`) and record the museum notice and certificate with `/taonga`. Add `--died=<year>` for artists who have died so the royalty term is right.

Then run `/attention` and `/compliance`, and check the first sale's invoices and settlements against how you would have done them in Auction Flex.
