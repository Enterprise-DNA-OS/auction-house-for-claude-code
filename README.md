<h1 align="center">Auction House for Claude Code</h1>

<p align="center">
  <strong>The open-source auction house system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Auction Flex data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=auction-flex">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/auction-flex?utm_source=github&utm_medium=readme&utm_campaign=auction-flex">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-auction-flex">Instead of Auction Flex</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Auction House for Claude Code does the job you pay Auction Flex for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Auction Flex dashboard cannot.

Auction Flex rents its desktop software by the workstation: US$85 a month for one, US$190 a month for four, US$30 a month for each one after that, or US$550 a month for unlimited, which is US$6,600 a year. The web version, Auction Flex 360, runs from US$95 to US$295 a month, and online bidding through HiBid adds a 2% auction fee on top ([Auction Flex pricing](https://www.auctionflex.com/pricing.htm), checked 2026-11-13). Here there is no workstation count and no per-sale fee.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=auction-flex).

It is built for auction houses in New Zealand and Australia: art, antiques, jewellery, furniture, collectables and estates. Consignments come in with their terms, lots go into sales with estimates and reserves, the absentee book fills, results come off the clerk sheet, and the system raises buyer invoices with premium and GST, takes payments, charges storage, releases lots, and settles each vendor only for lots whose buyer has paid. It keeps the obligations straight as it goes: the artist resale royalty in both countries, taonga tūturu under the Protected Objects Act, cash limits for high-value dealers, and the settlement date in every consignment agreement.

### Ten questions it answers on day one

1. Which buyers are past the payment date, and which vendor settlements are they holding up?
2. Which lots have been bought and not collected, and how much storage has each run up?
3. Which artworks sold at or over the resale royalty threshold, and which royalty reports are late?
4. Which taonga tūturu are in a sale with no certificate of examination, or knocked down to a buyer who is not a registered collector?
5. Which invoices were paid with $10,000 or more in cash, and which of those included jewellery?
6. Which vendors have paid lots waiting for settlement, and whose settlement is past the date in their terms?
7. Which lots were passed in more than 30 days ago and are still in the store?
8. Which lots in the next sale have no reserve, and which already have an absentee bid that covers it?
9. Which consignments have lots in a sale and no signed agreement?
10. How did each sale do against its estimates: sell-through, hammer against the low and high, lots above the high and below the low?

### Your first hour: ten things to ask for

1. "What needs my attention today?" (`/attention`)
2. "Show me the catalogue for the Summer Art Sale with the absentee bids." (`/catalogue`)
3. "Who hasn't paid from the last sale?" (`/overdue`)
4. "Run the vendor settlements for S-102 as a dry run." (`/settle`)
5. "Which artist royalties do we need to report, and by when?" (`/royalties`)
6. "Are we compliant on royalties, taonga and cash?" (`/compliance`)
7. "What's still in the store that's been bought?" (`/storage`)
8. "How did the Decorative Arts sale go against estimates?" (`/results`)
9. "Draft the results letter for the Cole estate." (`/draft-vendor-report`)
10. "Add a field for the buyer's paddle number to every invoice." (`/customise`)

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/auction-house-for-claude-code.git
cd auction-house-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo auction house has a saleroom in Auckland and one in Sydney, twelve clients, seven consignments and four sales (three held, one coming up), with the usual loose ends: a buyer who has not paid, lots nobody has collected, a lot passed in and never sent back, lots in the store with no sale, a vendor settlement past its date with no bank account on file, an Australian royalty report past 90 days, a hei tiki knocked down to a buyer who is not a registered collector, a carved wahaika in the next sale with no museum certificate, a ring paid for in cash over the limit, an unsigned consignment agreement and a lot with no reserve.

`npm run view` writes the dashboards (this week, sale results, money in and out, royalties and taonga) to `views/`. `npm run docs` writes buyer tax invoices, vendor settlement statements and consignment receipts to `docs-out/`, in your brand from `brand.json`.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/absentee` | The absentee and phone bid book for a sale, or take a new bid. |
| `/add` | Add a saleroom, client, consignment, lot, sale or absentee bid from a plain description. |
| `/attention` | Everything that needs the saleroom today, in one list. |
| `/audit` | What changed recently and on which record. |
| `/card` | Show the full record for one saleroom, client, consignment, sale, lot, bid, invoice or settlement. |
| `/catalogue` | The catalogue for one sale, or put a lot into a sale. |
| `/clients` | Vendors and buyers, with identity, GST, bank and registered collector details. |
| `/collect` | Hand a bought lot to its buyer. |
| `/compliance` | Check the records against the rules in docs/compliance.md (artist resale royalty, taonga tūturu, cash, consignment agreements, vendor settlements, GST) and report what is breached, held or due, with the rule cited. |
| `/consignments` | Consignments: who sent what, on what terms, and what has sold. |
| `/customise` | Make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it. |
| `/draft-collection-notice` | Draft a note to a buyer whose lots are still in the store. |
| `/draft-payment-reminder` | Draft a payment reminder to a buyer with an overdue invoice. |
| `/draft-vendor-report` | Draft the results letter to a vendor for one consignment. |
| `/draft-weekly-review` | Save the Monday review as a draft file. |
| `/export` | Export every record to CSV and one JSON snapshot. |
| `/hammer` | Record sale results: the hammer price and buyer, a pass, or a withdrawal. |
| `/import` | Bring consignors and inventory across from Auction Flex or another system. |
| `/invoices` | Raise the buyer invoices for a sale, or list invoices. |
| `/lots` | Find lots by sale, status, vendor or consignment. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/overdue` | Buyers who have not paid on time. |
| `/passed-in` | Lots that did not sell, and what to do with each. |
| `/pay` | Record a buyer payment. |
| `/results` | How a held sale went: sell-through, hammer against estimates, top lots. |
| `/royalties` | Artist resale royalties: what is owed, to whom, and when it must be reported. |
| `/sales` | Every sale: date, status, lots offered and sold, sell-through and hammer against the estimates. |
| `/settle` | Run the vendor settlements for a sale, check them and approve them. |
| `/settlements` | Vendor settlements: drafted, approved, paid and due. |
| `/storage` | Bought lots still in the store, and the storage they are running up. |
| `/taonga` | Taonga tūturu in the saleroom: museum notice, certificate, buyer status. |
| `/update` | Change a field on a record: estimates, reserves, dates, terms, identity, GST or bank details. |
| `/weekly-review` | The Monday review: what needs attention, the next sale, recent results, money owed both ways. |

Every command drives one CLI: `node scripts/auction.mjs help`.

## Instead of Auction Flex

Two files come across: your consignor list (`import auction-flex --kind=consignors`) and your inventory (`import auction-flex --kind=lots`), each as CSV with a dry run first. A repeat import adds nothing twice. Consignment terms, identity and bank details are filled in after. The guide, including what does not come across: [docs/replace-auction-flex.md](docs/replace-auction-flex.md).

The rules the compliance checks enforce, with sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
auction-house-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Auction House for Claude Code for your business, migrates your Auction Flex data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=auction-flex)
- Read more: [enterprisedna.co/omni/instead-of/auction-flex](https://enterprisedna.co/omni/instead-of/auction-flex?utm_source=github&utm_medium=readme&utm_campaign=auction-flex)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
