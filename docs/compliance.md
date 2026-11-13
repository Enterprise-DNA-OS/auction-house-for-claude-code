# The rules this system checks

`/compliance` (and `node scripts/auction.mjs compliance`) checks the records against the rules below. Each rule has its source, what a breach looks like in the data, and where the number lives so you can change it. Country-specific numbers are in the `jurisdictions` table; house terms are in `settings`. Every source was read on 2026-11-13.

Nothing here is legal advice. It records the rules the system enforces, with sources. If a rule changes, update this file and the table together (`/customise`).

## 1. Artist resale royalty, New Zealand

- **Rule.** A resale of an original visual artwork for NZ$2,000 or more, with an art market professional involved (an auctioneer counts), carries a royalty of 5% of the resale value. Resale value leaves out GST, commission and buyer's premium, so the base here is the hammer price. The right lasts 50 years after the end of the year the artist dies. The information (title, description, resale value, artist, who is liable) goes to the collection agency in writing within 60 working days after the resale is completed, and the royalty is paid within 60 working days. The seller and the seller's agent are jointly and severally liable.
- **Sources.** Resale Right for Visual Artists Act 2023 ss 10, 11, 15, 16, 17, 21 (https://www.legislation.govt.nz/act/public/2023/0059/latest/whole.html); Resale Right for Visual Artists Regulations 2024 regs 5, 7, 8 (https://www.legislation.govt.nz/regulation/public/2024/0044/latest/whole.html). Collection agency: Resale Royalties Aotearoa.
- **In the data.** `invoice <sale>` creates a `resale_royalties` row for each qualifying lot (category painting, print, sculpture or photograph; artist known; artist is not the vendor; within the term; hammer at or over the threshold) with its report deadline. A row past its deadline with no `reported_on` is a breach.
- **Change it.** `jurisdictions` (NZ row): `resale_royalty_bps`, `resale_threshold_cents`, `resale_term_years`, `resale_report_period`. Which categories count: `ARTWORK` in `scripts/auction.mjs`. Working days skip weekends only; public holidays are not removed, so the deadline shown is the earliest it could be.

## 2. Artist resale royalty, Australia

- **Rule.** A commercial resale of an artwork for A$1,000 or more carries a royalty of 5% of the sale price. The sale price includes GST and leaves out the buyer's premium. The seller must give the collecting society notice of the resale within 90 days, and may do it through an agent. The right lasts 70 years after the end of the year the artist dies. The seller and the art market professional acting as the seller's agent are jointly and severally liable.
- **Sources.** Resale Royalty Right for Visual Artists Act 2009 ss 8, 10, 18, 20, 28, 32 (https://www.legislation.gov.au/C2009A00125/2024-10-14/2024-10-14/text/original/epub/OEBPS/document_1/document_1.html).
- **In the data.** As for New Zealand, with a 90-day deadline in calendar days. The base is the hammer price; if you charge GST on the hammer for registered vendors, add it with `/customise`.
- **Who pays.** By default the royalty is deducted from the vendor's settlement and paid by the house. Set `royalty_charged_to_buyer` to 1 to add it to the buyer's invoice instead.

## 3. Taonga tūturu, New Zealand

- **Rule.** An auctioneer trading in taonga tūturu must be licensed to do so. A condition of the licence is to notify an authorised public museum of every taonga tūturu to be offered for sale, and not to offer or sell one until the museum has issued a certificate of examination. Taonga tūturu are sold only to public museums, licensed dealers, licensed auctioneers or registered collectors; a sale to anyone else is not completed and possession not given until they become a registered collector. The certificate goes to the buyer.
- **Source.** Protected Objects Act 1975 ss 13, 14, 15 (https://www.legislation.govt.nz/act/public/1975/0041/latest/whole.html).
- **In the data.** `lots.is_taonga_tuturu`, `museum_notified_on`, `examination_certificate`; `clients.is_registered_collector`. A taonga in a sale with no notice or certificate is flagged; `hammer` refuses to sell one with no certificate; `collect` refuses to hand one to a buyer who is not a registered collector; `settle` holds the vendor's money for it until the sale can complete.

## 4. Cash, New Zealand high-value dealers

- **Rule.** A business that buys or sells by cash of $10,000 or more in the ordinary course of business is a high-value dealer under the AML/CFT Act, and the goods listed include paintings, prints, sculptures, photographs, carvings and protected New Zealand objects. Buying or selling jewellery, watches, precious metals and stones, motor vehicles or boats by cash of $10,000 or more is prohibited, including related cash payments that add up to $10,000.
- **Source.** Department of Internal Affairs, AML/CFT information for high-value dealers (https://www.dia.govt.nz/AML-CFT-Information-for-High-Value-Dealers).
- **In the data.** Cash payments on one invoice are added up. At or over the threshold: a breach if the invoice holds jewellery, otherwise a check that the dealer obligations apply, noting when the buyer's identity is not recorded. Change the threshold in `jurisdictions.cash_threshold_cents`.

## 5. The consignment agreement

- **Rule.** Your own terms: a lot goes into a sale only under a signed consignment agreement that sets commission, fees, reserve and settlement days.
- **In the data.** `consignments.agreement_signed_on` empty while any of its lots is catalogued, sold or passed in.

## 6. Vendor settlement

- **Rule.** Your own terms: the vendor is paid within the settlement days in their consignment agreement, counted from the sale date, for every lot whose buyer has paid.
- **In the data.** A settlement not paid by its `due_on`. `/attention` also lists paid lots with no settlement run yet.

## 7. GST details

- **Rule.** Commission and fees carry GST at 15% in New Zealand and 10% in Australia, and so does the buyer's premium. A GST-registered vendor's settlement statement needs their GST number.
- **Sources.** Inland Revenue (https://www.ird.govt.nz/gst) and the Australian Taxation Office (https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst).
- **In the data.** `clients.gst_registered` with an empty `gst_number` on a vendor. GST on the hammer for registered vendors differs between houses; this base does not charge it. Add it with `/customise` if you do.
