-- Auction House for Claude Code: the schema.
-- Salerooms, clients (vendors and buyers), consignments and their lots, sales, absentee bids,
-- hammer results, buyer invoices and payments, vendor settlements, collection and storage, artist
-- resale royalties and taonga tūturu, for an auction house in New Zealand or Australia.
-- Plain Postgres. Runs on any Postgres 14+ and on the embedded PGlite.

create table settings (key text primary key, value integer not null check (value >= 0), meaning text not null default '');
insert into settings values
 ('default_premium_bps', 2000, 'Buyer''s premium on the hammer price when a sale does not set its own, in basis points (2000 = 20%).'),
 ('default_commission_bps', 1500, 'Vendor commission on the hammer price when a consignment does not set its own.'),
 ('buyer_pay_days', 3, 'A buyer invoice falls due this many days after the sale.'),
 ('free_storage_days', 7, 'Bought lots can stay this many days after the sale before storage is charged.'),
 ('storage_fee_cents', 1000, 'Storage charged per uncollected lot per day after the free days.'),
 ('return_unsold_days', 30, 'A lot passed in and not re-offered should go back to the vendor within this many days.'),
 ('quiet_consignment_days', 60, 'A lot received this many days ago and still not catalogued into a sale is flagged.'),
 ('royalty_charged_to_buyer', 0, '1 adds the artist resale royalty to the buyer invoice; 0 deducts it from the vendor settlement (the seller is liable under both Acts).'),
 ('sale_soon_days', 14, 'A sale within this many days is checked for lots with no reserve or no signed agreement.');

-- The rules that differ by country. Each row cites its sources (docs/compliance.md).
create table jurisdictions (
  country text primary key check (country in ('NZ', 'AU')),
  gst_bps integer not null check (gst_bps between 0 and 10000),
  resale_royalty_bps integer not null check (resale_royalty_bps between 0 and 10000),
  resale_threshold_cents bigint not null check (resale_threshold_cents >= 0),
  resale_term_years integer not null check (resale_term_years > 0),
  resale_report_period integer not null check (resale_report_period > 0),
  resale_report_unit text not null check (resale_report_unit in ('working_days', 'days')),
  resale_agency text not null,
  cash_threshold_cents bigint check (cash_threshold_cents >= 0),
  sources text not null);
-- NZ: Resale Right for Visual Artists Act 2023 ss 10, 15, 16, 17, 21 and Regulations 2024 regs 5, 7, 8;
-- AML/CFT high-value dealers (DIA). AU: Resale Royalty Right for Visual Artists Act 2009 ss 10, 18, 20, 28, 32.
insert into jurisdictions values
 ('NZ', 1500, 500, 200000, 50, 60, 'working_days', 'Resale Royalties Aotearoa', 1000000,
  'https://www.legislation.govt.nz/act/public/2023/0059/latest/whole.html ; https://www.legislation.govt.nz/regulation/public/2024/0044/latest/whole.html ; https://www.dia.govt.nz/AML-CFT-Information-for-High-Value-Dealers'),
 ('AU', 1000, 500, 100000, 70, 90, 'days', 'the Australian collecting society', null,
  'https://www.legislation.gov.au/C2009A00125/2024-10-14/2024-10-14/text/original/epub/OEBPS/document_1/document_1.html');

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table salerooms (
  id uuid primary key default gen_random_uuid(), ref text unique not null, name text not null,
  country text not null references jurisdictions,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- One table for everyone: a vendor can buy and a buyer can consign.
create table clients (
  id uuid primary key default gen_random_uuid(), ref text unique not null, name text not null,
  email text not null default '', phone text not null default '', country text not null default 'NZ',
  gst_registered boolean not null default false, gst_number text not null default '',
  id_verified_on date, bank_account_on_file boolean not null default false,
  is_registered_collector boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table consignments (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  vendor_id uuid not null references clients, saleroom_id uuid not null references salerooms,
  received_on date not null, agreement_signed_on date,
  commission_bps integer check (commission_bps between 0 and 10000),
  lot_fee_cents bigint not null default 0 check (lot_fee_cents >= 0),
  settlement_days integer not null default 21 check (settlement_days >= 0),
  note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table sales (
  id uuid primary key default gen_random_uuid(), ref text unique not null, name text not null,
  saleroom_id uuid not null references salerooms, sale_date date not null,
  premium_bps integer check (premium_bps between 0 and 10000),
  status text not null default 'planned' check (status in ('planned', 'catalogued', 'held', 'closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table lots (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  consignment_id uuid not null references consignments, sale_id uuid references sales,
  lot_number integer check (lot_number > 0),
  title text not null, category text not null default 'general'
    check (category in ('painting', 'print', 'sculpture', 'photograph', 'jewellery', 'furniture', 'ceramics', 'books', 'taonga', 'collectables', 'wine', 'general')),
  artist text not null default '', artist_died_year integer check (artist_died_year between 1000 and 2200),
  low_estimate_cents bigint check (low_estimate_cents >= 0), high_estimate_cents bigint check (high_estimate_cents >= 0),
  reserve_cents bigint check (reserve_cents >= 0),
  status text not null default 'received' check (status in ('received', 'catalogued', 'sold', 'passed_in', 'withdrawn', 'returned')),
  hammer_cents bigint check (hammer_cents >= 0), buyer_id uuid references clients, sold_on date,
  is_taonga_tuturu boolean not null default false, museum_notified_on date, examination_certificate text not null default '',
  collected_on date, returned_on date, location text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (sale_id, lot_number),
  check (high_estimate_cents is null or low_estimate_cents is null or high_estimate_cents >= low_estimate_cents),
  check ((status = 'sold') = (hammer_cents is not null and buyer_id is not null)));

create table absentee_bids (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  lot_id uuid not null references lots, bidder_id uuid not null references clients,
  max_cents bigint not null check (max_cents > 0), placed_on date not null default current_date,
  kind text not null default 'absentee' check (kind in ('absentee', 'phone')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (lot_id, bidder_id, kind));

create table invoices (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  sale_id uuid not null references sales, buyer_id uuid not null references clients,
  issued_on date not null, due_on date not null,
  hammer_cents bigint not null, premium_cents bigint not null, gst_cents bigint not null,
  storage_cents bigint not null default 0, total_cents bigint not null,
  currency text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (sale_id, buyer_id));

create table payments (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  invoice_id uuid not null references invoices, received_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('bank', 'card', 'cash', 'other')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table settlements (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  sale_id uuid not null references sales, consignment_id uuid not null references consignments,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  hammer_cents bigint not null, commission_cents bigint not null, fees_cents bigint not null,
  gst_cents bigint not null, royalty_cents bigint not null, net_cents bigint not null,
  lots_settled integer not null, lots_held integer not null,
  due_on date not null, paid_on date, currency text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements on delete cascade, lot_id uuid not null references lots,
  hammer_cents bigint not null, commission_cents bigint not null, fees_cents bigint not null, royalty_cents bigint not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (lot_id));

create table resale_royalties (
  id uuid primary key default gen_random_uuid(), lot_id uuid not null unique references lots,
  artist text not null, sale_price_cents bigint not null, royalty_cents bigint not null,
  agency text not null, report_due_on date not null, reported_on date, paid_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table audit_events (
  id bigserial primary key, at timestamptz not null default now(), entity text not null, action text not null,
  row_id uuid, data jsonb);

create or replace function audit_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    insert into audit_events(entity, action, row_id, data) values (tg_table_name, tg_op, old.id, to_jsonb(old));
    return old;
  end if;
  insert into audit_events(entity, action, row_id, data) values (tg_table_name, tg_op, new.id, to_jsonb(new));
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['salerooms', 'clients', 'consignments', 'sales', 'lots', 'absentee_bids', 'invoices', 'payments', 'settlements', 'settlement_lines', 'resale_royalties'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Every lot with its money, as one row.
create view lot_position as
select l.id as lot_id, l.ref as lot, l.lot_number, s.ref as sale, s.sale_date, l.title, l.category, l.artist, l.status,
       l.low_estimate_cents, l.high_estimate_cents, l.reserve_cents, l.hammer_cents,
       case when l.hammer_cents is not null and l.low_estimate_cents is not null then l.hammer_cents - l.low_estimate_cents end as vs_low_cents,
       v.ref as vendor_ref, v.name as vendor, b.ref as buyer_ref, b.name as buyer, c.ref as consignment, r.currency, r.country,
       l.collected_on, l.returned_on, c.received_on, l.location,
       l.consignment_id, l.sale_id, l.buyer_id, c.vendor_id
from lots l
join consignments c on c.id = l.consignment_id join clients v on v.id = c.vendor_id join salerooms r on r.id = c.saleroom_id
left join sales s on s.id = l.sale_id left join clients b on b.id = l.buyer_id;

-- Each buyer invoice with what has been paid and what is still owed.
create view invoice_status as
select i.id as invoice_id, i.ref as invoice, s.ref as sale, b.ref as buyer_ref, b.name as buyer, i.issued_on, i.due_on, i.total_cents,
       coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id), 0)::bigint as paid_cents,
       i.total_cents - coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id), 0)::bigint as owing_cents,
       (select max(p.received_on) from payments p where p.invoice_id = i.id) as last_paid_on,
       i.currency, i.sale_id, i.buyer_id
from invoices i join sales s on s.id = i.sale_id join clients b on b.id = i.buyer_id;

-- How each sale went: lots offered, sold, sell-through, hammer against the estimates.
create view sale_results as
select s.id as sale_id, s.ref as sale, s.name, s.sale_date, s.status, r.currency,
       count(l.id)::int as lots_offered,
       count(l.id) filter (where l.status = 'sold')::int as lots_sold,
       count(l.id) filter (where l.status = 'passed_in')::int as passed_in,
       case when count(l.id) > 0 then round(100.0 * count(l.id) filter (where l.status = 'sold') / count(l.id))::int end as sell_through_pct,
       coalesce(sum(l.hammer_cents), 0)::bigint as hammer_cents,
       coalesce(sum(l.low_estimate_cents), 0)::bigint as low_estimate_cents,
       coalesce(sum(l.high_estimate_cents), 0)::bigint as high_estimate_cents,
       count(l.id) filter (where l.status = 'sold' and l.hammer_cents > l.high_estimate_cents)::int as above_high,
       count(l.id) filter (where l.status = 'sold' and l.hammer_cents < l.low_estimate_cents)::int as below_low
from sales s join salerooms r on r.id = s.saleroom_id left join lots l on l.sale_id = s.id and l.status <> 'withdrawn'
group by s.id, r.currency;
