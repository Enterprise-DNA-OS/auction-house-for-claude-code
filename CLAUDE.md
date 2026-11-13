# Auction House for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs me today? | `/attention` |
| Our sales and how they went | `/sales` |
| Show a sale's catalogue, or put a lot in a sale | `/catalogue` |
| The absentee book, or take a bid | `/absentee` |
| Enter the results off the clerk sheet | `/hammer` |
| How did a sale go? | `/results` |
| Find lots | `/lots` |
| Consignments and their terms | `/consignments` |
| Vendors and buyers | `/clients` |
| What didn't sell? | `/passed-in` |
| What's bought and still here? | `/storage` |
| Raise or list buyer invoices | `/invoices` |
| Who hasn't paid? | `/overdue` |
| Record a payment | `/pay` |
| A buyer is collecting | `/collect` |
| Pay the vendors for a sale | `/settle` |
| Show settlements | `/settlements` |
| Artist resale royalties | `/royalties` |
| Taonga tūturu | `/taonga` |
| Are we compliant? | `/compliance` |
| Monday review | `/weekly-review` |
| Save the Monday review | `/draft-weekly-review` |
| Results letter to a vendor | `/draft-vendor-report` |
| Chase a buyer for payment | `/draft-payment-reminder` |
| Ask a buyer to collect | `/draft-collection-notice` |
| Add a record | `/add` |
| Change a field | `/update` |
| Show one record | `/card` |
| What changed? | `/audit` |
| Bring data across from Auction Flex | `/import` |
| Export everything | `/export` |
| Change a field, rule or stage | `/customise` |
| Add a dashboard page | `/new-view` |

If an ask fits nothing here, run the CLI directly (`node scripts/auction.mjs help`) and then propose a new command for it.

## House rules for an auction house

- A vendor's reserve, commission and settlement, and a buyer's bids and spending, are private to them. Never put one client's figures in another's draft.
- Record a hammer price, a payment, a collection or a royalty report only when the operator confirms it happened, with the date it happened.
- Invoices and settlements run as a dry run first. Approve a settlement only on the operator's yes. Approved settlements are never edited: fix the record and settle again.
- Never sell or hand over a taonga tūturu outside the Protected Objects Act rules in `docs/compliance.md`. Never accept cash past the limits there.
- Terms come from the consignment agreement. If a commission, fee or reserve is not recorded, ask; never assume.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Auction Flex.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/auction-flex
