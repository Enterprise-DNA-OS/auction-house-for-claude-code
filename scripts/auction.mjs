#!/usr/bin/env node
// The one CLI for Auction House for Claude Code. Every slash command drives this file.
//   node scripts/auction.mjs <command> [args] [--json]
//   node scripts/auction.mjs help
// Human tables by default, --json for machines. Names match case-insensitively, ids by prefix;
// an ambiguous name lists the candidates and exits 1. Money is typed in dollars (--price=4200),
// stored in cents. Percentages are typed as percentages (--commission=15), stored as basis points.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, heading } from './lib/format.mjs';

// ------------------------------------------------------------------ records

const ENTITIES = {
  saleroom: { table: 'salerooms', name: 'name', fields: ['ref', 'name', 'country', 'currency'] },
  client: { table: 'clients', prefix: 'C', name: 'name', fields: ['ref', 'name', 'email', 'phone', 'country', 'gst_registered', 'gst_number', 'id_verified_on', 'bank_account_on_file', 'is_registered_collector', 'note'] },
  consignment: { table: 'consignments', prefix: 'CN', fields: ['ref', 'vendor_id', 'saleroom_id', 'received_on', 'agreement_signed_on', 'commission_bps', 'lot_fee_cents', 'settlement_days', 'note'] },
  sale: { table: 'sales', prefix: 'S', name: 'name', fields: ['ref', 'name', 'saleroom_id', 'sale_date', 'premium_bps', 'status'] },
  lot: { table: 'lots', prefix: 'L', name: 'title', fields: ['ref', 'consignment_id', 'title', 'category', 'artist', 'artist_died_year', 'low_estimate_cents', 'high_estimate_cents', 'reserve_cents', 'is_taonga_tuturu', 'museum_notified_on', 'examination_certificate', 'location'] },
  bid: { table: 'absentee_bids', prefix: 'AB', fields: ['ref', 'lot_id', 'bidder_id', 'max_cents', 'placed_on', 'kind'] },
  invoice: { table: 'invoices', fields: ['ref'] },
  payment: { table: 'payments', prefix: 'P', fields: ['ref'] },
  settlement: { table: 'settlements', fields: ['ref'] },
};
const FK = { vendor_id: 'client', bidder_id: 'client', buyer_id: 'client', saleroom_id: 'saleroom', consignment_id: 'consignment', sale_id: 'sale', lot_id: 'lot' };
const ALIAS = {
  vendor: 'vendor_id', bidder: 'bidder_id', saleroom: 'saleroom_id', room: 'saleroom_id', consignment: 'consignment_id', lot: 'lot_id',
  low: 'low_estimate_cents', high: 'high_estimate_cents', reserve: 'reserve_cents', max: 'max_cents', lot_fee: 'lot_fee_cents',
  commission: 'commission_bps', premium: 'premium_bps', received: 'received_on', signed: 'agreement_signed_on', agreement: 'agreement_signed_on',
  date: 'sale_date', id_verified: 'id_verified_on', taonga: 'is_taonga_tuturu', collector: 'is_registered_collector', registered_collector: 'is_registered_collector',
  bank: 'bank_account_on_file', died: 'artist_died_year', museum_notified: 'museum_notified_on', certificate: 'examination_certificate', placed: 'placed_on',
};
const MONEY = /_cents$/;
const PCT = /_bps$/;
const DATES = /(_on|_date)$/;
const BOOLS = new Set(['gst_registered', 'bank_account_on_file', 'is_registered_collector', 'is_taonga_tuturu']);
const INTS = new Set(['settlement_days', 'artist_died_year']);
// The categories the resale royalty Acts treat as visual artworks in this system. /customise changes it.
const ARTWORK = new Set(['painting', 'print', 'sculpture', 'photograph']);

class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

function parseArgs(argv) {
  const pos = [], opt = {};
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/i.exec(a);
    if (m) opt[m[1].toLowerCase().replace(/-/g, '_')] = m[2] === undefined ? true : m[2];
    else pos.push(a);
  }
  return { pos, opt };
}

export function checkDate(v, what = 'date') {
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`Invalid calendar date for ${what}: ${v} (use YYYY-MM-DD)`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(`Invalid calendar date for ${what}: ${v}`);
  return s;
}
const toCents = (v, what) => {
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) fail(`Invalid amount for ${what}: ${v}`);
  return Math.round(n * 100);
};
const toBps = (v, what) => { const n = Number(String(v).replace(/%/g, '')); if (!Number.isFinite(n) || n < 0 || n > 100) fail(`Invalid percentage for ${what}: ${v} (0 to 100)`); return Math.round(n * 100); };
const isoToday = async (db) => (await db.query('select current_date::text as d'))[0].d;
const share = (cents, bps) => Math.round((Number(cents) * Number(bps)) / 10000);

// Working days (Monday to Friday) after `from`. Public holidays are not removed; docs/compliance.md says so.
export function addWorkingDays(from, days) {
  const d = new Date(`${from}T00:00:00Z`);
  let n = 0;
  while (n < days) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return d.toISOString().slice(0, 10);
}
export const addDays = (from, days) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(days)); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : v);

// Resolve a record from what a person typed: exact ref, exact name, id prefix, then a partial match.
export async function resolve(db, entity, text) {
  const e = ENTITIES[entity] || fail(`Unknown record type: ${entity}`);
  const q = String(text ?? '').trim();
  if (!q) fail(`Say which ${entity}`);
  const label = e.name ? `ref || ' ' || coalesce(${e.name}, '')` : 'ref';
  const tries = [
    [`select id, ref, ${label} as label from ${e.table} where lower(ref) = lower($1)`, q],
    e.name && [`select id, ref, ${label} as label from ${e.table} where lower(${e.name}) = lower($1)`, q],
    /^[0-9a-f-]{4,36}$/i.test(q) && [`select id, ref, ${label} as label from ${e.table} where id::text like lower($1) || '%'`, q],
    [`select id, ref, ${label} as label from ${e.table} where ref ilike '%' || $1 || '%'${e.name ? ` or ${e.name} ilike '%' || $1 || '%'` : ''} order by ref limit 20`, q.replace(/[%_\\]/g, (c) => '\\' + c)],
  ].filter(Boolean);
  for (const [sql, p] of tries) {
    const rows = await db.query(sql, [p]);
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) fail(`Ambiguous ${entity} "${q}". Candidates:\n${rows.map((r) => `  ${r.ref}  ${String(r.label).slice(r.ref.length + 1, r.ref.length + 61)}  (${r.id.slice(0, 8)})`).join('\n')}`);
  }
  fail(`No ${entity} matches "${q}"`);
}

async function nextRef(db, entity) {
  const e = ENTITIES[entity];
  const rows = await db.query(`select ref from ${e.table} where ref ~ $1`, [`^${e.prefix}-[0-9]+$`]);
  const n = rows.reduce((m, r) => Math.max(m, Number(r.ref.split('-').at(-1))), entity === 'lot' ? 1000 : 100) + 1;
  return `${e.prefix}-${n}`;
}

async function toColumns(db, entity, opt) {
  const e = ENTITIES[entity];
  const cols = {};
  for (const [k0, v] of Object.entries(opt)) {
    if (['json', 'dry_run'].includes(k0)) continue;
    const k = ALIAS[k0] || (e.fields.includes(`${k0}_bps`) ? `${k0}_bps` : e.fields.includes(`${k0}_cents`) ? `${k0}_cents` : k0);
    if (!e.fields.includes(k)) fail(`Unknown ${entity} field: ${k0}. Fields: ${e.fields.map((f) => f.replace(/_id$|_cents$|_bps$/, '')).join(', ')}`);
    const empty = v === '' || v === 'none';
    if (FK[k]) cols[k] = empty ? null : (await resolve(db, FK[k], v)).id;
    else if (MONEY.test(k)) cols[k] = empty ? null : toCents(v, k0);
    else if (PCT.test(k)) cols[k] = empty ? null : toBps(v, k0);
    else if (DATES.test(k)) cols[k] = empty ? null : checkDate(v, k0);
    else if (BOOLS.has(k)) cols[k] = v === true || /^(yes|true|y|1)$/i.test(String(v));
    else if (INTS.has(k)) { if (empty) cols[k] = null; else { const n = Number(v); if (!Number.isInteger(n)) fail(`${k0} must be a whole number`); cols[k] = n; } }
    else cols[k] = v === true ? 'true' : String(v);
    if (k === 'country' || k === 'currency') cols[k] = String(cols[k]).toUpperCase();
  }
  return cols;
}

async function addRecord(db, entity, opt) {
  const e = ENTITIES[entity] || fail(`Unknown record type: ${entity}. Types: saleroom, client, consignment, sale, lot, bid`);
  if (['invoice', 'payment', 'settlement'].includes(entity)) fail(`${entity}s are created by ${entity === 'invoice' ? 'invoice <sale>' : entity === 'payment' ? 'pay <invoice>' : 'settle <sale>'}`);
  const cols = await toColumns(db, entity, opt);
  if (entity === 'consignment') {
    if (!cols.vendor_id) fail('A consignment needs --vendor');
    if (!cols.saleroom_id) { const rooms = await db.query('select id from salerooms'); if (rooms.length !== 1) fail('Say which saleroom: --saleroom='); cols.saleroom_id = rooms[0].id; }
    cols.received_on ??= await isoToday(db);
  }
  if (entity === 'lot' && !cols.consignment_id) fail('A lot needs --consignment');
  if (entity === 'sale' && (!cols.saleroom_id || !cols.sale_date)) {
    if (!cols.saleroom_id) { const rooms = await db.query('select id from salerooms'); if (rooms.length !== 1) fail('Say which saleroom: --saleroom='); cols.saleroom_id = rooms[0].id; }
    if (!cols.sale_date) fail('A sale needs --date=YYYY-MM-DD');
  }
  if (entity === 'bid' && (!cols.lot_id || !cols.bidder_id || !cols.max_cents)) fail('An absentee bid needs --lot, --bidder and --max');
  if (!cols.ref) { if (!e.prefix) fail(`A ${entity} needs --ref`); cols.ref = await nextRef(db, entity); }
  const keys = Object.keys(cols);
  const [row] = await db.query(`insert into ${e.table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, keys.map((k) => cols[k]));
  return row;
}

async function setRecord(db, entity, ref, opt) {
  const e = ENTITIES[entity] || fail(`Unknown record type: ${entity}`);
  if (['invoice', 'payment', 'settlement'].includes(entity)) fail(`${entity}s change through their own commands (pay, approve, mark-paid)`);
  const r = await resolve(db, entity, ref);
  const cols = await toColumns(db, entity, opt);
  if (!Object.keys(cols).length) fail('Nothing to change: give at least one --field=value');
  const keys = Object.keys(cols);
  const [row] = await db.query(`update ${e.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [r.id, ...keys.map((k) => cols[k])]);
  return row;
}

async function tx(db, fn) {
  await db.exec('BEGIN');
  try { const out = await fn(); await db.exec('COMMIT'); return out; }
  catch (err) { await db.exec('ROLLBACK'); throw err; }
}
export const setting = async (db, key) => Number((await db.query('select value from settings where key = $1', [key]))[0].value);
const saleRow = async (db, ref) => (await db.query(`select s.*, r.country, r.currency, coalesce(s.premium_bps, (select value from settings where key = 'default_premium_bps')) as premium
  from sales s join salerooms r on r.id = s.saleroom_id where s.id = $1`, [(await resolve(db, 'sale', ref)).id]))[0];

// ------------------------------------------------------------------ reads

const READS = {
  salerooms: `select ref, name, country, currency from salerooms order by ref`,
  sales: `select sale, name, sale_date, status, lots_offered, lots_sold, passed_in, sell_through_pct, hammer_cents, low_estimate_cents, high_estimate_cents, currency from sale_results order by sale_date`,
  clients: `select c.ref, c.name, c.country, c.gst_registered, c.gst_number, c.id_verified_on, c.bank_account_on_file as bank_on_file, c.is_registered_collector as registered_collector,
              (select count(*) from consignments x where x.vendor_id = c.id)::int as consignments, (select count(*) from lots l where l.buyer_id = c.id)::int as lots_bought, c.email
            from clients c order by c.ref`,
  consignments: `select c.ref, v.name as vendor, r.ref as room, c.received_on, c.agreement_signed_on, coalesce(c.commission_bps, (select value from settings where key = 'default_commission_bps')) as commission_bps,
                   c.lot_fee_cents, c.settlement_days, count(l.id)::int as lots,
                   count(l.id) filter (where l.status = 'sold')::int as sold, count(l.id) filter (where l.status in ('received', 'passed_in'))::int as waiting, r.currency
                 from consignments c join clients v on v.id = c.vendor_id join salerooms r on r.id = c.saleroom_id left join lots l on l.consignment_id = c.id
                 group by c.id, v.name, r.ref, r.currency order by c.ref`,
  invoices: `select invoice, sale, buyer, issued_on, due_on, total_cents, paid_cents, owing_cents, last_paid_on, currency from invoice_status order by issued_on, invoice`,
  settlements: `select st.ref, s.ref as sale, c.ref as consignment, v.name as vendor, st.status, st.lots_settled, st.lots_held, st.hammer_cents, st.commission_cents, st.fees_cents, st.gst_cents, st.royalty_cents, st.net_cents, st.due_on, st.paid_on, st.currency
                from settlements st join sales s on s.id = st.sale_id join consignments c on c.id = st.consignment_id join clients v on v.id = c.vendor_id order by s.sale_date, st.ref`,
  audit: `select at, entity, action, data->>'ref' as ref from audit_events order by id desc limit 25`,
};

async function lots(db, opt) {
  const where = [], p = [];
  if (opt.sale) { p.push((await resolve(db, 'sale', opt.sale)).id); where.push(`sale_id = $${p.length}`); }
  if (opt.status) { p.push(opt.status); where.push(`status = $${p.length}`); }
  if (opt.vendor) { p.push((await resolve(db, 'client', opt.vendor)).id); where.push(`vendor_id = $${p.length}`); }
  if (opt.consignment) { p.push((await resolve(db, 'consignment', opt.consignment)).id); where.push(`consignment_id = $${p.length}`); }
  return db.query(`select lot, sale, lot_number, title, artist, status, low_estimate_cents, high_estimate_cents, reserve_cents, hammer_cents, vendor, buyer, currency
    from lot_position ${where.length ? 'where ' + where.join(' and ') : ''} order by sale_date nulls last, lot_number nulls last, lot`, p);
}

// The catalogue for one sale, with the absentee book's top bid against each reserve.
async function catalogue(db, ref) {
  const s = await saleRow(db, ref);
  const rows = await db.query(`select lp.lot_number, lp.lot, lp.title, lp.artist, lp.low_estimate_cents, lp.high_estimate_cents, lp.reserve_cents,
      (select max(b.max_cents) from absentee_bids b where b.lot_id = lp.lot_id) as top_bid_cents,
      (select count(*) from absentee_bids b where b.lot_id = lp.lot_id)::int as bids, lp.status, lp.hammer_cents, lp.buyer, lp.currency
    from lot_position lp where lp.sale_id = $1 and lp.status <> 'withdrawn' order by lp.lot_number`, [s.id]);
  return { sale: [{ sale: s.ref, name: s.name, sale_date: iso(s.sale_date), status: s.status, premium_bps: s.premium, currency: s.currency }], lots: rows };
}

async function absentee(db, ref) {
  const s = await saleRow(db, ref);
  return db.query(`select l.lot_number, l.ref as lot, l.title, b.ref as bid, c.name as bidder, b.kind, b.max_cents, l.reserve_cents,
      case when l.reserve_cents is null then 'no reserve' when b.max_cents >= l.reserve_cents then 'covers reserve' else 'below reserve' end as against_reserve, b.placed_on, r.currency
    from absentee_bids b join lots l on l.id = b.lot_id join clients c on c.id = b.bidder_id join sales s on s.id = l.sale_id join salerooms r on r.id = s.saleroom_id
    where l.sale_id = $1 order by l.lot_number, b.max_cents desc`, [s.id]);
}

async function results(db, ref) {
  const s = await saleRow(db, ref);
  const [summary] = await db.query('select sale, name, sale_date, status, lots_offered, lots_sold, passed_in, sell_through_pct, hammer_cents, low_estimate_cents, high_estimate_cents, above_high, below_low, currency from sale_results where sale_id = $1', [s.id]);
  const top = await db.query(`select lot_number, lot, title, artist, low_estimate_cents, high_estimate_cents, hammer_cents, vs_low_cents, buyer, currency from lot_position where sale_id = $1 and status = 'sold' order by hammer_cents desc limit 10`, [s.id]);
  return { summary: [summary], top_lots: top };
}

async function passedIn(db) {
  const days = await setting(db, 'return_unsold_days');
  const rows = await db.query(`select lp.lot, lp.title, lp.vendor, lp.sale, lp.sale_date, lp.low_estimate_cents, lp.reserve_cents,
      (select max(b.max_cents) from absentee_bids b where b.lot_id = lp.lot_id) as best_bid_cents, current_date - lp.sale_date as days_since, lp.currency
    from lot_position lp where lp.status = 'passed_in' order by lp.sale_date`);
  return rows.map((r) => ({ ...r, next_step: r.days_since > days ? `return to vendor or re-offer (passed in ${r.days_since} days ago)` : 're-offer at a lower reserve, or sell after the sale at the reserve' }));
}

// Bought lots still in the saleroom, with storage charged after the free days.
async function storage(db) {
  const free = await setting(db, 'free_storage_days');
  const fee = await setting(db, 'storage_fee_cents');
  const rows = await db.query(`select lp.lot, lp.title, lp.buyer_ref, lp.buyer, lp.sale, lp.sale_date, current_date - lp.sale_date as days_since_sale, lp.location,
      coalesce(i.owing_cents, 0) as invoice_owing_cents, i.invoice, lp.currency
    from lot_position lp left join invoice_status i on i.sale_id = lp.sale_id and i.buyer_id = lp.buyer_id
    where lp.status = 'sold' and lp.collected_on is null order by lp.sale_date, lp.lot`);
  return rows.map((r) => ({ ...r, storage_days: Math.max(r.days_since_sale - free, 0), storage_cents: Math.max(r.days_since_sale - free, 0) * fee }));
}

async function invoices(db, opt) {
  const rows = await db.query(READS.invoices);
  let out = rows;
  if (opt.sale) { const s = await resolve(db, 'sale', opt.sale); out = out.filter((r) => r.sale === s.ref); }
  if (opt.unpaid) out = out.filter((r) => Number(r.owing_cents) > 0);
  return out;
}

async function overdue(db) {
  return db.query(`select i.invoice, i.buyer, c.phone, c.email, i.sale, i.due_on, current_date - i.due_on as days_overdue, i.total_cents, i.paid_cents, i.owing_cents, i.currency
    from invoice_status i join clients c on c.id = i.buyer_id where i.owing_cents > 0 and i.due_on < current_date order by i.due_on`);
}

async function invoiceCard(db, ref) {
  const inv = await resolve(db, 'invoice', ref);
  const [head] = await db.query('select * from invoice_status where invoice_id = $1', [inv.id]);
  const lotsOn = await db.query(`select l.lot_number, l.ref as lot, l.title, l.hammer_cents, r.currency from lots l join invoices i on i.sale_id = l.sale_id and i.buyer_id = l.buyer_id
    join sales s on s.id = i.sale_id join salerooms r on r.id = s.saleroom_id where i.id = $1 and l.status = 'sold' order by l.lot_number`, [inv.id]);
  const pays = await db.query('select ref, received_on, amount_cents, method from payments where invoice_id = $1 order by received_on', [inv.id]);
  return { invoice: [head], lots: lotsOn, payments: pays };
}

async function settlementCard(db, ref) {
  const st = await resolve(db, 'settlement', ref);
  const head = (await db.query(READS.settlements)).filter((r) => r.ref === st.ref);
  const lines = await db.query(`select l.lot_number, l.ref as lot, l.title, sl.hammer_cents, sl.commission_cents, sl.fees_cents, sl.royalty_cents, s.currency
    from settlement_lines sl join lots l on l.id = sl.lot_id join settlements s on s.id = sl.settlement_id where sl.settlement_id = $1 order by l.lot_number`, [st.id]);
  return { settlement: head, lines };
}

// Every qualifying resale with its report deadline under the country's rule.
async function royalties(db) {
  const rows = await db.query(`select rr.id, l.ref as lot, l.title, rr.artist, rr.sale_price_cents, rr.royalty_cents, rr.agency, l.sold_on, rr.report_due_on, rr.reported_on, rr.paid_on, r.currency
    from resale_royalties rr join lots l on l.id = rr.lot_id join consignments c on c.id = l.consignment_id join salerooms r on r.id = c.saleroom_id order by rr.report_due_on`);
  const today = await isoToday(db);
  return rows.map(({ id, ...r }) => ({ ...r, state: r.reported_on && r.paid_on ? 'done' : r.reported_on ? 'reported, not paid' : iso(r.report_due_on) < today ? `late by ${daysBetween(iso(r.report_due_on), today)} days` : `due in ${daysBetween(today, iso(r.report_due_on))} days` }));
}

async function taonga(db) {
  return db.query(`select lp.lot, lp.title, lp.sale, lp.sale_date, lp.status, l.museum_notified_on, nullif(l.examination_certificate, '') as certificate, lp.buyer,
      b.is_registered_collector as buyer_registered, lp.collected_on
    from lot_position lp join lots l on l.id = lp.lot_id left join clients b on b.id = lp.buyer_id where l.is_taonga_tuturu order by lp.sale_date nulls last, lp.lot`);
}

// ------------------------------------------------------------------ rules

// The checks against the rules in docs/compliance.md. Each finding names its rule.
export async function compliance(db) {
  const today = await isoToday(db);
  const out = [];
  for (const r of await royalties(db)) {
    if (r.state.startsWith('late')) out.push({ severity: 'breach', rule: 'Resale royalty', item: `${r.lot} ${r.artist}`, finding: `${money(r.royalty_cents, r.currency)} royalty on ${r.title}: report to ${r.agency} was due ${iso(r.report_due_on)}, ${r.state}` });
    else if (!r.reported_on) out.push({ severity: 'due', rule: 'Resale royalty', item: `${r.lot} ${r.artist}`, finding: `${money(r.royalty_cents, r.currency)} royalty on ${r.title}: report to ${r.agency} by ${iso(r.report_due_on)}` });
  }
  // A sold artwork that should have a royalty record and does not (the invoice run creates them).
  for (const r of await db.query(`select lp.lot, lp.title, lp.artist from lot_position lp join lots l on l.id = lp.lot_id
      where lp.status = 'sold' and lp.sale_id is not null and not exists (select 1 from resale_royalties rr where rr.lot_id = lp.lot_id)
      and exists (select 1 from invoices i where i.sale_id = lp.sale_id and i.buyer_id = lp.buyer_id)`)) {
    const q = await qualifies(db, r.lot);
    if (q.ok) out.push({ severity: 'breach', rule: 'Resale royalty', item: r.lot, finding: `${r.title} by ${r.artist} qualifies and has no royalty record` });
  }
  for (const t of await taonga(db)) {
    if (t.sale && t.status !== 'withdrawn' && (!t.museum_notified_on || !t.certificate) && t.status !== 'returned')
      out.push({ severity: t.status === 'sold' ? 'breach' : 'due', rule: 'Taonga tūturu', item: t.lot, finding: `${t.title} is in ${t.sale} ${!t.museum_notified_on ? 'and no authorised museum has been notified' : 'with no certificate of examination'}; it cannot be offered until the certificate is issued` });
    if (t.status === 'sold' && !t.buyer_registered)
      out.push({ severity: t.collected_on ? 'breach' : 'hold', rule: 'Taonga tūturu', item: t.lot, finding: `${t.title} was knocked down to ${t.buyer}, who is not a registered collector: ${t.collected_on ? 'it was handed over' : 'do not complete the sale or hand it over until they register'}` });
  }
  // NZ high-value dealers: cash of $10,000 or more on related payments.
  for (const r of await db.query(`select i.invoice_id, i.invoice, i.buyer, b.id_verified_on, j.cash_threshold_cents, i.currency,
        coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0)::bigint as cash_cents,
        bool_or(l.category = 'jewellery') as jewellery
      from invoice_status i join clients b on b.id = i.buyer_id join sales s on s.id = i.sale_id join salerooms r on r.id = s.saleroom_id join jurisdictions j on j.country = r.country
      left join payments p on p.invoice_id = i.invoice_id left join lots l on l.sale_id = i.sale_id and l.buyer_id = i.buyer_id
      where j.cash_threshold_cents is not null group by i.invoice_id, i.invoice, i.buyer, b.id_verified_on, j.cash_threshold_cents, i.currency`)) {
    if (Number(r.cash_cents) < Number(r.cash_threshold_cents)) continue;
    out.push(r.jewellery
      ? { severity: 'breach', rule: 'Cash, high-value goods', item: r.invoice, finding: `${money(r.cash_cents, r.currency)} cash from ${r.buyer} on an invoice with jewellery: cash of ${money(r.cash_threshold_cents, r.currency)} or more is prohibited for jewellery` }
      : { severity: 'check', rule: 'Cash, high-value dealer', item: r.invoice, finding: `${money(r.cash_cents, r.currency)} cash from ${r.buyer}: AML/CFT high-value dealer obligations apply${r.id_verified_on ? '' : ', and their identity is not verified'}` });
  }
  for (const r of await db.query(`select distinct c.ref, v.name, s.ref as sale from consignments c join clients v on v.id = c.vendor_id join lots l on l.consignment_id = c.id join sales s on s.id = l.sale_id
      where c.agreement_signed_on is null and l.status in ('catalogued', 'sold', 'passed_in') order by c.ref`))
    out.push({ severity: 'breach', rule: 'Consignment agreement', item: r.ref, finding: `${r.name}'s lots are in ${r.sale} and the consignment agreement is not signed` });
  for (const r of await db.query(`select st.ref, v.name, st.due_on, st.net_cents, st.currency from settlements st join consignments c on c.id = st.consignment_id join clients v on v.id = c.vendor_id
      where st.status <> 'paid' and st.due_on < current_date order by st.due_on`))
    out.push({ severity: 'breach', rule: 'Vendor settlement', item: r.ref, finding: `${money(r.net_cents, r.currency)} to ${r.name} was due ${iso(r.due_on)} under their consignment terms, ${daysBetween(iso(r.due_on), today)} days ago` });
  for (const r of await db.query(`select distinct v.ref, v.name from clients v join consignments c on c.vendor_id = v.id where v.gst_registered and v.gst_number = '' order by v.ref`))
    out.push({ severity: 'check', rule: 'GST', item: r.ref, finding: `${r.name} is GST-registered with no GST number recorded: settlement statements need it` });
  return out;
}

// Does a sold lot qualify for the artist resale royalty in its saleroom's country?
async function qualifies(db, lotRef) {
  const [l] = await db.query(`select l.*, v.name as vendor, r.country, j.* from lots l join consignments c on c.id = l.consignment_id join clients v on v.id = c.vendor_id
    join salerooms r on r.id = c.saleroom_id join jurisdictions j on j.country = r.country where l.ref = $1`, [lotRef]);
  if (!l || l.status !== 'sold') return { ok: false, why: 'not sold' };
  if (!ARTWORK.has(l.category)) return { ok: false, why: `${l.category} is not a visual artwork category here` };
  if (!l.artist.trim()) return { ok: false, why: 'artist unknown' };
  if (l.vendor.trim().toLowerCase() === l.artist.trim().toLowerCase()) return { ok: false, why: 'the artist is the vendor: a first sale, not a resale' };
  const year = Number(iso(l.sold_on).slice(0, 4));
  if (l.artist_died_year && year > Number(l.artist_died_year) + Number(l.resale_term_years)) return { ok: false, why: `the right ended ${l.resale_term_years} years after ${l.artist_died_year}` };
  if (Number(l.hammer_cents) < Number(l.resale_threshold_cents)) return { ok: false, why: `under the ${money(l.resale_threshold_cents)} threshold` };
  const due = l.resale_report_unit === 'working_days' ? addWorkingDays(iso(l.sold_on), l.resale_report_period) : addDays(iso(l.sold_on), l.resale_report_period);
  return { ok: true, lot: l, royalty_cents: share(l.hammer_cents, l.resale_royalty_bps), due };
}

export async function attention(db) {
  const today = await isoToday(db);
  const out = [];
  const add = (category, item, why) => out.push({ category, item, why });
  for (const r of await overdue(db)) add('Buyer overdue', `${r.invoice} ${r.buyer}`, `${money(r.owing_cents, r.currency)} owing, due ${iso(r.due_on)}, ${r.days_overdue} days overdue`);
  for (const r of await db.query(`select s.ref as sale, c.ref as consignment, v.name, count(l.id)::int as lots, s.sale_date + c.settlement_days as due_on
      from lots l join sales s on s.id = l.sale_id join consignments c on c.id = l.consignment_id join clients v on v.id = c.vendor_id
      join invoice_status i on i.sale_id = l.sale_id and i.buyer_id = l.buyer_id join clients b on b.id = l.buyer_id
      where l.status = 'sold' and i.owing_cents <= 0 and not (l.is_taonga_tuturu and not b.is_registered_collector) and not exists (select 1 from settlement_lines sl where sl.lot_id = l.id)
      group by s.ref, c.ref, v.name, s.sale_date, c.settlement_days order by due_on`))
    add('Settlement not run', `${r.sale} ${r.consignment}`, `${r.lots} paid lot${r.lots === 1 ? '' : 's'} for ${r.name}; settlement due ${iso(r.due_on)}${iso(r.due_on) < today ? `, ${daysBetween(iso(r.due_on), today)} days ago` : ''}`);
  for (const r of await db.query(`select st.ref, v.name, st.status, st.due_on, st.net_cents, st.currency, v.bank_account_on_file from settlements st join consignments c on c.id = st.consignment_id join clients v on v.id = c.vendor_id where st.status <> 'paid' order by st.due_on`))
    add(iso(r.due_on) < today ? 'Settlement overdue' : 'Settlement to pay', `${r.ref} ${r.name}`, `${money(r.net_cents, r.currency)} ${r.status}, due ${iso(r.due_on)}${r.bank_account_on_file ? '' : '; no bank account on file'}`);
  for (const r of await storage(db)) if (r.storage_days > 0) add('Uncollected', `${r.lot} ${r.title}`, `${r.buyer} bought it ${r.days_since_sale} days ago; ${money(r.storage_cents, r.currency)} storage so far${Number(r.invoice_owing_cents) > 0 ? ', and the invoice is unpaid' : ''}`);
  const days = await setting(db, 'return_unsold_days');
  for (const r of await passedIn(db)) if (r.days_since > days) add('Passed in', `${r.lot} ${r.title}`, `passed in at ${r.sale} ${r.days_since} days ago; re-offer or return to ${r.vendor}`);
  const quiet = await setting(db, 'quiet_consignment_days');
  for (const r of await db.query(`select lp.lot, lp.title, lp.vendor, current_date - lp.received_on as days from lot_position lp where lp.status = 'received' and current_date - lp.received_on > $1 order by lp.received_on`, [quiet]))
    add('Not catalogued', `${r.lot} ${r.title}`, `received from ${r.vendor} ${r.days} days ago and not in a sale`);
  const soon = await setting(db, 'sale_soon_days');
  for (const r of await db.query(`select lp.lot, lp.title, lp.sale, lp.sale_date, lp.reserve_cents, c.agreement_signed_on from lot_position lp join consignments c on c.id = lp.consignment_id
      where lp.status = 'catalogued' and lp.sale_date between current_date and current_date + $1::int order by lp.sale_date, lp.lot_number`, [soon])) {
    if (r.reserve_cents === null) add('No reserve', `${r.lot} ${r.title}`, `in ${r.sale} on ${iso(r.sale_date)} with no reserve agreed`);
  }
  for (const c of await compliance(db)) if ((c.severity !== 'check' || c.rule === 'Cash, high-value dealer') && c.rule !== 'Vendor settlement') add(c.rule, c.item, c.finding);
  for (const r of await db.query(`select v.ref, v.name from clients v where v.gst_registered and v.gst_number = '' and exists (select 1 from consignments c where c.vendor_id = v.id) order by v.ref`))
    add('Vendor details', `${r.ref} ${r.name}`, 'GST-registered and no GST number recorded');
  return out;
}

// ------------------------------------------------------------------ the saleroom

async function catalogueLot(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const s = await saleRow(db, opt.sale || fail('Say which sale: --sale=S-103'));
  const [cur] = await db.query('select status, sale_id from lots where id = $1', [l.id]);
  if (!['received', 'catalogued', 'passed_in'].includes(cur.status)) fail(`${l.ref} is ${cur.status}; only received, catalogued or passed-in lots go into a sale`);
  if (s.status === 'held' || s.status === 'closed') fail(`${s.ref} has already been held`);
  const n = opt.lot_number ? Number(opt.lot_number) : Number((await db.query('select coalesce(max(lot_number), 0) + 1 as n from lots where sale_id = $1', [s.id]))[0].n);
  if (!Number.isInteger(n) || n < 1) fail('--lot-number must be a whole number from 1');
  if (cur.status === 'passed_in') await db.query('delete from absentee_bids where lot_id = $1', [l.id]);
  return db.query(`update lots set sale_id = $2, lot_number = $3, status = 'catalogued', hammer_cents = null, buyer_id = null, sold_on = null where id = $1 returning ref, lot_number, status`, [l.id, s.id, n]);
}

async function hammer(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const [lot] = await db.query('select l.*, s.sale_date, s.status as sale_status from lots l left join sales s on s.id = l.sale_id where l.id = $1', [l.id]);
  if (!lot.sale_id) fail(`${l.ref} is not in a sale`);
  if (lot.status !== 'catalogued') fail(`${l.ref} is ${lot.status}`);
  if (lot.is_taonga_tuturu && !lot.examination_certificate) fail(`${l.ref} is taonga tūturu with no certificate of examination from an authorised museum. It cannot be sold until one is issued (notify-museum ${l.ref} --certificate=...).`);
  const price = toCents(opt.price ?? fail('Give the hammer price: --price=4200'), 'price');
  const buyer = await resolve(db, 'client', opt.buyer || fail('Say who bought it: --buyer=C-105 or a name'));
  const warnings = [];
  if (lot.reserve_cents !== null && price < Number(lot.reserve_cents)) {
    if (!opt.below_reserve) fail(`${money(price)} is below the ${money(lot.reserve_cents)} reserve. Record it only with the vendor's agreement: --below-reserve`);
    warnings.push('sold below reserve with the vendor\'s agreement');
  }
  const date = opt.date ? checkDate(opt.date) : iso(lot.sale_date);
  const [b] = await db.query('select is_registered_collector from clients where id = $1', [buyer.id]);
  if (lot.is_taonga_tuturu && !b.is_registered_collector) warnings.push(`${buyer.label.slice(buyer.ref.length + 1)} is not a registered collector: the sale cannot be completed or the taonga handed over until they register`);
  const [row] = await db.query(`update lots set status = 'sold', hammer_cents = $2, buyer_id = $3, sold_on = $4 where id = $1 returning ref, status, hammer_cents, sold_on`, [l.id, price, buyer.id, date]);
  return { ...row, buyer: buyer.ref, warnings };
}

async function passLot(db, lotRef, status) {
  const l = await resolve(db, 'lot', lotRef);
  const [cur] = await db.query('select status from lots where id = $1', [l.id]);
  if (status === 'passed_in' && cur.status !== 'catalogued') fail(`${l.ref} is ${cur.status}; only a catalogued lot is passed in`);
  if (status === 'withdrawn' && !['received', 'catalogued'].includes(cur.status)) fail(`${l.ref} is ${cur.status} and cannot be withdrawn`);
  return db.query(`update lots set status = $2 where id = $1 returning ref, status`, [l.id, status]);
}

async function returnLot(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const [cur] = await db.query('select status from lots where id = $1', [l.id]);
  if (!['received', 'passed_in', 'withdrawn'].includes(cur.status)) fail(`${l.ref} is ${cur.status}; only unsold lots go back to the vendor`);
  return db.query(`update lots set status = 'returned', returned_on = $2 where id = $1 returning ref, status, returned_on`, [l.id, opt.date ? checkDate(opt.date) : await isoToday(db)]);
}

async function placeBid(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const [cur] = await db.query('select status from lots where id = $1', [l.id]);
  if (cur.status !== 'catalogued') fail(`${l.ref} is ${cur.status}; absentee bids go on catalogued lots`);
  const bidder = await resolve(db, 'client', opt.bidder || fail('Say who is bidding: --bidder='));
  const max = toCents(opt.max ?? fail('Give the top bid: --max=4200'), 'max');
  const kind = opt.kind || 'absentee';
  return db.query(`insert into absentee_bids (ref, lot_id, bidder_id, max_cents, kind, placed_on) values ($1, $2, $3, $4, $5, $6)
    on conflict (lot_id, bidder_id, kind) do update set max_cents = excluded.max_cents, placed_on = excluded.placed_on returning ref, max_cents, kind`,
  [await nextRef(db, 'bid'), l.id, bidder.id, max, kind, opt.date ? checkDate(opt.date) : await isoToday(db)]);
}

// Buyer invoices for a held sale, and the resale royalty record for every qualifying lot.
async function invoiceSale(db, ref, opt) {
  const s = await saleRow(db, ref);
  if (s.status === 'planned' || s.status === 'catalogued') {
    if (iso(s.sale_date) > await isoToday(db)) fail(`${s.ref} has not been held yet (${iso(s.sale_date)})`);
  }
  const unresolved = await db.query(`select ref from lots where sale_id = $1 and status = 'catalogued' order by lot_number`, [s.id]);
  if (unresolved.length) fail(`Record a result for every lot first (hammer, pass or withdraw): ${unresolved.map((r) => r.ref).join(', ')}`);
  const [j] = await db.query('select * from jurisdictions where country = $1', [s.country]);
  const payDays = await setting(db, 'buyer_pay_days');
  const royaltyToBuyer = (await setting(db, 'royalty_charged_to_buyer')) === 1;
  const buyers = await db.query(`select l.buyer_id, c.ref, c.name, sum(l.hammer_cents)::bigint as hammer, count(*)::int as lots from lots l join clients c on c.id = l.buyer_id
    where l.sale_id = $1 and l.status = 'sold' group by l.buyer_id, c.ref, c.name order by c.ref`, [s.id]);
  const created = [], kept = [], royaltiesOut = [];
  const royaltyByBuyer = {};
  for (const l of await db.query(`select ref, buyer_id from lots where sale_id = $1 and status = 'sold' order by lot_number`, [s.id])) {
    const q = await qualifies(db, l.ref);
    if (!q.ok) continue;
    royaltiesOut.push({ lot: l.ref, artist: q.lot.artist, sale_price_cents: q.lot.hammer_cents, royalty_cents: q.royalty_cents, report_due_on: q.due, agency: j.resale_agency, currency: s.currency });
    royaltyByBuyer[l.buyer_id] = (royaltyByBuyer[l.buyer_id] || 0) + q.royalty_cents;
    if (!opt.dry_run) await db.query(`insert into resale_royalties (lot_id, artist, sale_price_cents, royalty_cents, agency, report_due_on) select id, $2, $3, $4, $5, $6 from lots where ref = $1 on conflict (lot_id) do nothing`,
      [l.ref, q.lot.artist, q.lot.hammer_cents, q.royalty_cents, j.resale_agency, q.due]);
  }
  for (const b of buyers) {
    const premium = share(b.hammer, s.premium);
    const gst = share(premium, j.gst_bps);
    const royalty = royaltyToBuyer ? royaltyByBuyer[b.buyer_id] || 0 : 0;
    const row = { invoice: `INV-${s.ref}-${b.ref}`, buyer: b.name, lots: b.lots, hammer_cents: b.hammer, premium_cents: premium, gst_cents: gst, royalty_cents: royalty, total_cents: Number(b.hammer) + premium + gst + royalty, currency: s.currency };
    const [exists] = await db.query('select ref from invoices where sale_id = $1 and buyer_id = $2', [s.id, b.buyer_id]);
    if (exists) { kept.push(row); continue; }
    if (!opt.dry_run) await db.query(`insert into invoices (ref, sale_id, buyer_id, issued_on, due_on, hammer_cents, premium_cents, gst_cents, total_cents, currency) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [row.invoice, s.id, b.buyer_id, iso(s.sale_date), addDays(iso(s.sale_date), payDays), b.hammer, premium, gst + royalty, row.total_cents, s.currency]);
    created.push(row);
  }
  if (!opt.dry_run && s.status !== 'closed') await db.query(`update sales set status = 'held' where id = $1`, [s.id]);
  return { sale: s.ref, created, kept, royalties: royaltiesOut, dry_run: Boolean(opt.dry_run) };
}

async function pay(db, ref, opt) {
  const inv = await resolve(db, 'invoice', ref);
  const [st] = await db.query('select owing_cents, currency from invoice_status where invoice_id = $1', [inv.id]);
  const amount = opt.amount ? toCents(opt.amount, 'amount') : Number(st.owing_cents);
  if (amount <= 0) fail(`${inv.ref} has nothing owing`);
  const method = opt.method || 'bank';
  if (!['bank', 'card', 'cash', 'other'].includes(method)) fail('--method is bank, card, cash or other');
  const [p] = await db.query(`insert into payments (ref, invoice_id, received_on, amount_cents, method) values ($1, $2, $3, $4, $5) returning ref, received_on, amount_cents, method`,
    [await nextRef(db, 'payment'), inv.id, opt.date ? checkDate(opt.date) : await isoToday(db), amount, method]);
  const [after] = await db.query('select owing_cents from invoice_status where invoice_id = $1', [inv.id]);
  return { ...p, invoice: inv.ref, owing_cents: after.owing_cents, currency: st.currency };
}

// A buyer collects a lot. Storage past the free days goes on their invoice and must be paid first;
// a taonga tūturu goes only to a registered collector.
async function collect(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const [lot] = await db.query(`select l.*, s.sale_date, b.is_registered_collector, b.name as buyer from lots l join sales s on s.id = l.sale_id join clients b on b.id = l.buyer_id where l.id = $1`, [l.id]).then((r) => r.length ? r : fail(`${l.ref} has not been sold`));
  if (lot.collected_on) fail(`${l.ref} was collected on ${iso(lot.collected_on)}`);
  if (lot.is_taonga_tuturu && !lot.is_registered_collector) fail(`${l.ref} is taonga tūturu and ${lot.buyer} is not a registered collector. It cannot be handed over until they register.`);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  const [inv] = await db.query('select * from invoice_status where sale_id = $1 and buyer_id = $2', [lot.sale_id, lot.buyer_id]);
  if (!inv) fail(`No invoice yet for ${lot.buyer} in this sale: run invoice <sale> first`);
  const free = await setting(db, 'free_storage_days');
  const fee = await setting(db, 'storage_fee_cents');
  const storageDays = Math.max(daysBetween(iso(lot.sale_date), date) - free, 0);
  const charge = storageDays * fee;
  const charged = (await db.query(`select count(*)::int as n from audit_events where entity = 'lots' and action = 'STORAGE' and row_id = $1`, [l.id]))[0].n > 0;
  if (charge > 0 && !charged) {
    await db.query('update invoices set storage_cents = storage_cents + $2, total_cents = total_cents + $2 where id = $1', [inv.invoice_id, charge]);
    await db.query(`insert into audit_events (entity, action, row_id, data) values ('lots', 'STORAGE', $1, $2)`, [l.id, JSON.stringify({ ref: l.ref, days: storageDays, cents: charge })]);
  }
  const [after] = await db.query('select owing_cents, currency from invoice_status where invoice_id = $1', [inv.invoice_id]);
  if (Number(after.owing_cents) > 0) return { lot: l.ref, collected: false, invoice: inv.invoice, owing_cents: after.owing_cents, storage_cents: charge, currency: after.currency, why: `${money(after.owing_cents, after.currency)} owing on ${inv.invoice}${charge && !charged ? `, including ${money(charge, after.currency)} storage for ${storageDays} days` : ''}. Take payment, then collect.` };
  await db.query('update lots set collected_on = $2 where id = $1', [l.id, date]);
  return { lot: l.ref, collected: true, collected_on: date };
}

// Vendor settlements for a sale: every sold lot whose buyer has paid in full, per consignment.
async function settle(db, ref, opt) {
  const s = await saleRow(db, ref);
  const [j] = await db.query('select * from jurisdictions where country = $1', [s.country]);
  const dflt = await setting(db, 'default_commission_bps');
  const royaltyToBuyer = (await setting(db, 'royalty_charged_to_buyer')) === 1;
  if (!opt.dry_run) await db.query(`delete from settlements where sale_id = $1 and status = 'draft'`, [s.id]);
  const rows = await db.query(`select l.id, l.ref, l.hammer_cents, l.consignment_id, c.ref as consignment, coalesce(c.commission_bps, $2) as commission_bps, c.lot_fee_cents, c.settlement_days, v.name as vendor,
      coalesce(i.owing_cents, 1) <= 0 and not (l.is_taonga_tuturu and not b.is_registered_collector) as paid, rr.royalty_cents
    from lots l join consignments c on c.id = l.consignment_id join clients v on v.id = c.vendor_id join clients b on b.id = l.buyer_id
    left join invoice_status i on i.sale_id = l.sale_id and i.buyer_id = l.buyer_id left join resale_royalties rr on rr.lot_id = l.id
    where l.sale_id = $1 and l.status = 'sold' and not exists (select 1 from settlement_lines sl join settlements st on st.id = sl.settlement_id where sl.lot_id = l.id and st.status <> 'draft')
    order by c.ref, l.lot_number`, [s.id, dflt]);
  const byCons = new Map();
  for (const r of rows) { if (!byCons.has(r.consignment_id)) byCons.set(r.consignment_id, []); byCons.get(r.consignment_id).push(r); }
  const created = [];
  for (const [cid, list] of byCons) {
    const ready = list.filter((r) => r.paid);
    const held = list.length - ready.length;
    if (!ready.length) { created.push({ consignment: list[0].consignment, vendor: list[0].vendor, lots_settled: 0, lots_held: held, note: 'no buyer has paid yet' }); continue; }
    const lines = ready.map((r) => ({ lot_id: r.id, hammer: Number(r.hammer_cents), commission: share(r.hammer_cents, r.commission_bps), fees: Number(r.lot_fee_cents), royalty: royaltyToBuyer ? 0 : Number(r.royalty_cents || 0) }));
    const sum = (k) => lines.reduce((a, x) => a + x[k], 0);
    const gst = share(sum('commission') + sum('fees'), j.gst_bps);
    const net = sum('hammer') - sum('commission') - sum('fees') - gst - sum('royalty');
    const n = (await db.query(`select count(*)::int as n from settlements where sale_id = $1 and consignment_id = $2`, [s.id, cid]))[0].n;
    const stRef = `ST-${s.ref}-${list[0].consignment}${n ? `-${n + 1}` : ''}`;
    const out = { ref: stRef, consignment: list[0].consignment, vendor: list[0].vendor, lots_settled: ready.length, lots_held: held, hammer_cents: sum('hammer'), commission_cents: sum('commission'), fees_cents: sum('fees'), gst_cents: gst, royalty_cents: sum('royalty'), net_cents: net, due_on: addDays(iso(s.sale_date), list[0].settlement_days), currency: s.currency };
    if (!opt.dry_run) {
      const [st] = await db.query(`insert into settlements (ref, sale_id, consignment_id, hammer_cents, commission_cents, fees_cents, gst_cents, royalty_cents, net_cents, lots_settled, lots_held, due_on, currency)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`, [stRef, s.id, cid, out.hammer_cents, out.commission_cents, out.fees_cents, gst, out.royalty_cents, net, ready.length, held, out.due_on, s.currency]);
      for (const x of lines) await db.query('insert into settlement_lines (settlement_id, lot_id, hammer_cents, commission_cents, fees_cents, royalty_cents) values ($1, $2, $3, $4, $5, $6)', [st.id, x.lot_id, x.hammer, x.commission, x.fees, x.royalty]);
    }
    created.push(out);
  }
  return { sale: s.ref, settlements: created, dry_run: Boolean(opt.dry_run) };
}

// Approve or pay one settlement, or every settlement in a sale.
async function moveSettlements(db, ref, from, to, opt) {
  let ids;
  const [byRef] = await db.query('select id from settlements where lower(ref) = lower($1)', [String(ref || '')]);
  if (byRef) ids = [byRef.id];
  else { const s = await resolve(db, 'sale', ref); ids = (await db.query('select id from settlements where sale_id = $1 and status = $2', [s.id, from])).map((r) => r.id); }
  const out = [];
  for (const id of ids) {
    const [st] = await db.query('select s.ref, s.status, v.bank_account_on_file, v.name from settlements s join consignments c on c.id = s.consignment_id join clients v on v.id = c.vendor_id where s.id = $1', [id]);
    if (st.status !== from) fail(`${st.ref} is ${st.status}, not ${from}`);
    if (to === 'paid' && !st.bank_account_on_file) fail(`${st.ref}: no bank account on file for ${st.name}. Record it (set client ... --bank=yes) before paying.`);
    const sets = to === 'paid' ? ', paid_on = $3' : '';
    const params = to === 'paid' ? [id, to, opt.date ? checkDate(opt.date) : await isoToday(db)] : [id, to];
    out.push(...await db.query(`update settlements set status = $2${sets} where id = $1 returning ref, status, paid_on`, params));
  }
  if (!out.length) fail(`No ${from} settlements for ${ref}`);
  return out;
}

async function reportRoyalty(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  const rows = await db.query(`update resale_royalties set reported_on = coalesce(reported_on, $2), paid_on = case when $3 then coalesce(paid_on, $2) else paid_on end where lot_id = $1 returning artist, royalty_cents, reported_on, paid_on`, [l.id, date, Boolean(opt.paid)]);
  if (!rows.length) fail(`${l.ref} has no resale royalty record`);
  return rows;
}

async function notifyMuseum(db, lotRef, opt) {
  const l = await resolve(db, 'lot', lotRef);
  const [cur] = await db.query('select is_taonga_tuturu from lots where id = $1', [l.id]);
  if (!cur.is_taonga_tuturu) fail(`${l.ref} is not recorded as taonga tūturu`);
  return db.query(`update lots set museum_notified_on = coalesce($2, museum_notified_on, current_date), examination_certificate = coalesce($3, examination_certificate) where id = $1 returning ref, museum_notified_on, examination_certificate`,
    [l.id, opt.date ? checkDate(opt.date) : null, opt.certificate ? String(opt.certificate) : null]);
}

// ------------------------------------------------------------------ moving across

const COLS = {
  vendor: ['Consignor', 'Consignor Name', 'Seller', 'Seller Name', 'Vendor', 'Vendor Name', 'Name'],
  vendor_code: ['Consignor #', 'Consignor No', 'Consignor Number', 'Seller #', 'Vendor Code', 'Code'],
  email: ['Email', 'E-mail', 'Email Address'],
  phone: ['Phone', 'Phone Number', 'Mobile', 'Cell'],
  title: ['Title', 'Lead', 'Description', 'Item', 'Lot Title'],
  artist: ['Artist', 'Maker', 'Artist/Maker'],
  category: ['Category', 'Type'],
  low: ['Low Estimate', 'Low Est', 'Estimate Low', 'Low'],
  high: ['High Estimate', 'High Est', 'Estimate High', 'High'],
  reserve: ['Reserve', 'Reserve Price'],
  received: ['Received', 'Date Received', 'Receipt Date'],
  inventory: ['Inventory #', 'Inventory No', 'Item #', 'Stock #', 'Inventory'],
  commission: ['Commission', 'Commission %', 'Commission Rate', 'Rate'],
};
const CATEGORY_WORDS = [['painting', /paint|oil|watercolou?r|acrylic|canvas/i], ['print', /print|etching|lino|lithograph|screenprint/i], ['sculpture', /sculpt|bronze/i], ['photograph', /photo/i],
  ['jewellery', /jewel|ring|brooch|necklace|watch/i], ['furniture', /furnit|chair|table|desk|cabinet|chest/i], ['ceramics', /ceramic|porcelain|pottery|stoneware/i], ['books', /book|manuscript/i],
  ['wine', /wine/i], ['collectables', /collect|coin|stamp|toy/i]];

function readMapped(file, mappingFile) {
  const rows = parseCsv(fs.readFileSync(path.resolve(file || fail('Give --file=<export.csv>')), 'utf8'));
  const mapping = mappingFile ? JSON.parse(fs.readFileSync(path.resolve(mappingFile), 'utf8')) : {};
  const get = (row, key) => (mapping[key] ? pick(row, mapping[key]) : pick(row, ...(COLS[key] || [key])));
  return { rows, get };
}

// import auction-flex --kind=consignors|lots: Auction Flex's consignor list and inventory, exported to CSV.
async function importAuctionFlex(db, opt) {
  const kind = opt.kind || fail('Say what the file holds: --kind=consignors or --kind=lots');
  const { rows, get } = readMapped(opt.file, opt.mapping);
  const room = opt.saleroom ? (await resolve(db, 'saleroom', opt.saleroom)) : (await db.query('select id, ref from salerooms order by ref limit 1'))[0] || fail('Add a saleroom first');
  const out = { kind, rows: rows.length, created: 0, skipped: 0, warnings: [] };
  const work = async () => {
    for (const [i, r] of rows.entries()) {
      const name = get(r, 'vendor').trim();
      if (!name) { out.warnings.push(`row ${i + 2}: no consignor name, skipped`); out.skipped++; continue; }
      const code = get(r, 'vendor_code').trim();
      let [client] = await db.query('select id, ref from clients where lower(name) = lower($1) or ($2 <> \'\' and note = $3) limit 1', [name, code, `auction-flex:${code}`]);
      if (!client) {
        [client] = await db.query(`insert into clients (ref, name, email, phone, country, note) values ($1, $2, $3, $4, (select country from salerooms where id = $5), $6) returning id, ref`,
          [await nextRef(db, 'client'), name, get(r, 'email'), get(r, 'phone'), room.id, code ? `auction-flex:${code}` : '']);
        if (kind === 'consignors') out.created++;
      } else if (kind === 'consignors') out.skipped++;
      if (kind !== 'lots') continue;
      const title = get(r, 'title').trim();
      if (!title) { out.warnings.push(`row ${i + 2}: no title, skipped`); out.skipped++; continue; }
      const inv = get(r, 'inventory').trim();
      if (inv && (await db.query('select 1 from lots where ref = $1', [`AF-${inv}`])).length) { out.skipped++; continue; }
      const received = get(r, 'received') ? checkDate(get(r, 'received'), `row ${i + 2} received`) : await isoToday(db);
      let [cons] = await db.query('select id from consignments where vendor_id = $1 and saleroom_id = $2 and received_on = $3', [client.id, room.id, received]);
      if (!cons) {
        const comm = get(r, 'commission');
        [cons] = await db.query(`insert into consignments (ref, vendor_id, saleroom_id, received_on, commission_bps, note) values ($1, $2, $3, $4, $5, 'imported from Auction Flex: agreement date not in the export') returning id`,
          [await nextRef(db, 'consignment'), client.id, room.id, received, comm ? toBps(comm, `row ${i + 2} commission`) : null]);
      }
      const cents = (k) => (get(r, k) ? toCents(get(r, k), `row ${i + 2} ${k}`) : null);
      const catText = get(r, 'category') || title;
      const category = CATEGORY_WORDS.find(([, re]) => re.test(catText))?.[0] || 'general';
      await db.query(`insert into lots (ref, consignment_id, title, category, artist, low_estimate_cents, high_estimate_cents, reserve_cents) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [inv ? `AF-${inv}` : await nextRef(db, 'lot'), cons.id, title, category, get(r, 'artist'), cents('low'), cents('high'), cents('reserve')]);
      out.created++;
    }
  };
  if (opt.dry_run) { await db.exec('BEGIN'); try { await work(); } finally { await db.exec('ROLLBACK'); } out.dry_run = true; }
  else await tx(db, work);
  return out;
}

const TABLES = ['salerooms', 'clients', 'consignments', 'sales', 'lots', 'absentee_bids', 'invoices', 'payments', 'settlements', 'settlement_lines', 'resale_royalties', 'audit_events', 'settings', 'jurisdictions'];
const csvCell = (v) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function exportAll(db, opt) {
  const dir = path.resolve(opt.out || path.join(process.env.OUTPUT_DIR || REPO_ROOT, 'exports', new Date().toISOString().slice(0, 10)));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const snap = { exported_at: new Date().toISOString(), tables: {} };
  const counts = {};
  for (const t of TABLES) {
    const rows = await db.query(`select * from ${t}`);
    snap.tables[t] = rows; counts[t] = rows.length;
    const cols = rows.length ? Object.keys(rows[0]) : [];
    fs.writeFileSync(path.join(dir, `${t}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  }
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap, null, 1), { flag: 'wx', mode: 0o600 });
  return { dir, counts };
}

// ------------------------------------------------------------------ drafts (never sent)

function writeDraft(name, lines) {
  const dir = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${name}.md`);
  fs.writeFileSync(file, ['> DRAFT: written by Auction House for Claude Code. Read it, change it, a person sends it.', '', ...lines, ''].join('\n'), { mode: 0o600 });
  return { file };
}
const mdTable = (rows, cols) => rows.length ? [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)] : ['Nothing to report.'];

async function draftVendorReport(db, ref) {
  const c = await resolve(db, 'consignment', ref);
  const [v] = await db.query('select v.name, r.currency from consignments c join clients v on v.id = c.vendor_id join salerooms r on r.id = c.saleroom_id where c.id = $1', [c.id]);
  const rows = (await lots(db, { consignment: c.ref })).map((r) => ({ ...r, estimate: r.low_estimate_cents ? `${money(r.low_estimate_cents, r.currency)} to ${money(r.high_estimate_cents, r.currency)}` : '', result: r.status === 'sold' ? `sold ${money(r.hammer_cents, r.currency)}` : r.status.replace('_', ' ') }));
  const sts = (await db.query(READS.settlements)).filter((s) => s.consignment === c.ref);
  return writeDraft(`vendor-report-${c.ref}`, [
    `# Your results: consignment ${c.ref}`, '', `Dear ${v.name},`, '', 'Here is where each of your lots stands.', '',
    ...mdTable(rows, ['lot', 'title', 'sale', 'estimate', 'result']), '',
    ...(sts.length ? ['## Settlement', ...mdTable(sts.map((s) => ({ ...s, net: money(s.net_cents, s.currency) })), ['ref', 'sale', 'status', 'net', 'due_on'])] : ['Your settlement follows once buyers have paid.']), '',
    ...(rows.some((r) => r.status === 'passed_in') ? ['For lots that did not sell, we can offer them again in the next sale at a revised reserve, or arrange for you to collect them. Let us know which you prefer.'] : []),
  ]);
}

async function draftPaymentReminder(db, ref) {
  const { invoice: [i], lots: ls } = await invoiceCard(db, ref);
  return writeDraft(`payment-reminder-${i.invoice}`, [
    `# Invoice ${i.invoice}: payment due`, '', `Dear ${i.buyer},`, '',
    `Thank you for your purchases at ${i.sale}. Invoice ${i.invoice} for ${money(i.total_cents, i.currency)} was due on ${iso(i.due_on)} and ${money(i.owing_cents, i.currency)} is still owing.`, '',
    ...mdTable(ls.map((l) => ({ ...l, hammer: money(l.hammer_cents, l.currency) })), ['lot_number', 'title', 'hammer']), '',
    'Our bank details are on the invoice. Once payment is received your lots are ready to collect.',
  ]);
}

async function draftCollectionNotice(db, ref) {
  const buyer = await resolve(db, 'client', ref);
  const rows = (await storage(db)).filter((r) => r.buyer_ref === buyer.ref);
  if (!rows.length) fail(`${buyer.ref} has no lots waiting to be collected`);
  const fee = await setting(db, 'storage_fee_cents');
  return writeDraft(`collection-notice-${buyer.ref}`, [
    '# Your lots are ready to collect', '', `Dear ${buyer.label.slice(buyer.ref.length + 1)},`, '',
    'These lots are still with us:', '', ...mdTable(rows.map((r) => ({ ...r, storage: money(r.storage_cents, r.currency) })), ['lot', 'title', 'sale', 'days_since_sale', 'storage']), '',
    `Storage is charged at ${money(fee, rows[0].currency)} a lot per day after the free period. Please arrange collection or delivery this week.`,
  ]);
}

export async function weeklyReview(db) {
  const today = await isoToday(db);
  return {
    attention: await attention(db),
    upcoming_sales: (await db.query(READS.sales)).filter((s) => iso(s.sale_date) >= today),
    recent_results: (await db.query(READS.sales)).filter((s) => iso(s.sale_date) < today && iso(s.sale_date) >= addDays(today, -45)),
    money_owed_to_us: await overdue(db),
    settlements_to_pay: (await db.query(READS.settlements)).filter((s) => s.status !== 'paid'),
  };
}

async function draftWeeklyReview(db) {
  const w = await weeklyReview(db);
  return writeDraft('weekly-review', [
    '# Monday review', '', '## Needs attention', ...mdTable(w.attention, ['category', 'item', 'why']), '',
    '## Coming up', ...mdTable(w.upcoming_sales, ['sale', 'name', 'sale_date', 'lots_offered']), '',
    '## Recent results', ...mdTable(w.recent_results.map((s) => ({ ...s, hammer: money(s.hammer_cents, s.currency) })), ['sale', 'name', 'lots_sold', 'sell_through_pct', 'hammer']), '',
    '## Buyers overdue', ...mdTable(w.money_owed_to_us.map((r) => ({ ...r, owing: money(r.owing_cents, r.currency) })), ['invoice', 'buyer', 'owing', 'days_overdue']), '',
    '## Vendor settlements to pay', ...mdTable(w.settlements_to_pay.map((r) => ({ ...r, net: money(r.net_cents, r.currency) })), ['ref', 'vendor', 'status', 'net', 'due_on']),
  ]);
}

// ------------------------------------------------------------------ router

const HELP = `Auction House for Claude Code

Reads:   sales | catalogue <sale> | absentee <sale> | results <sale> | lots [--sale= --status= --vendor= --consignment=]
         consignments | clients | salerooms | passed-in | storage | invoices [--sale= --unpaid] | invoice <ref> | overdue
         settlements | settlement <ref> | royalties | taonga | compliance | attention | weekly-review | card <type> <name> | audit
Writes:  add <type> --field=value ...   set <type> <name> --field=value ...
         catalogue-lot <lot> --sale= [--lot-number=]   bid <lot> --bidder= --max= [--kind=phone]
         hammer <lot> --price= --buyer= [--date= --below-reserve]   pass <lot>   withdraw <lot>   return <lot> [--date=]
         invoice <sale> [--dry-run]   pay <invoice> [--amount= --method=bank|card|cash|other --date=]   collect <lot> [--date=]
         settle <sale> [--dry-run]   approve <settlement|sale>   mark-paid <settlement|sale> [--date=]
         report-royalty <lot> [--date= --paid]   notify-museum <lot> [--date= --certificate=]
Moving:  import auction-flex --kind=consignors|lots --file=<export.csv> [--mapping=<map.json> --saleroom= --dry-run]
         export [--out=<dir>]
Drafts:  draft-vendor-report <consignment> | draft-payment-reminder <invoice> | draft-collection-notice <buyer> | draft-weekly-review
         (written to drafts/, never sent)
Types:   ${Object.keys(ENTITIES).join(', ')}
Add --json to any command for machine output. Money in dollars (--price=4200), percentages as percentages (--commission=15).`;

export async function execute(db, argv) {
  const { pos, opt } = parseArgs(argv);
  const [cmd, a, b] = pos;
  switch (cmd) {
    case undefined: case 'help': return { help: HELP };
    case 'sales': case 'clients': case 'consignments': case 'salerooms': case 'settlements': case 'audit': return db.query(READS[cmd]);
    case 'catalogue': return catalogue(db, a);
    case 'absentee': return absentee(db, a);
    case 'results': return results(db, a);
    case 'lots': return lots(db, opt);
    case 'passed-in': return passedIn(db);
    case 'storage': return storage(db);
    case 'invoices': return invoices(db, opt);
    case 'invoice':
      if (a && (await db.query('select 1 from invoices where lower(ref) = lower($1)', [a])).length) return invoiceCard(db, a);
      return tx(db, () => invoiceSale(db, a, opt));
    case 'overdue': return overdue(db);
    case 'settlement': return settlementCard(db, a);
    case 'royalties': return royalties(db);
    case 'taonga': return taonga(db);
    case 'compliance': return compliance(db);
    case 'attention': return attention(db);
    case 'weekly-review': return weeklyReview(db);
    case 'card': { const e = ENTITIES[a] || fail(`Unknown record type: ${a}`); const r = await resolve(db, a, b); return db.query(`select * from ${e.table} where id = $1`, [r.id]); }
    case 'add': return [await tx(db, () => addRecord(db, a, opt))];
    case 'set': return [await tx(db, () => setRecord(db, a, b, opt))];
    case 'catalogue-lot': return tx(db, () => catalogueLot(db, a, opt));
    case 'bid': return tx(db, () => placeBid(db, a, opt));
    case 'hammer': return tx(db, () => hammer(db, a, opt));
    case 'pass': return tx(db, () => passLot(db, a, 'passed_in'));
    case 'withdraw': return tx(db, () => passLot(db, a, 'withdrawn'));
    case 'return': return tx(db, () => returnLot(db, a, opt));
    case 'pay': return tx(db, () => pay(db, a, opt));
    case 'collect': return tx(db, () => collect(db, a, opt));
    case 'settle': return tx(db, () => settle(db, a, opt));
    case 'approve': return tx(db, () => moveSettlements(db, a, 'draft', 'approved', opt));
    case 'mark-paid': return tx(db, () => moveSettlements(db, a, 'approved', 'paid', opt));
    case 'report-royalty': return tx(db, () => reportRoyalty(db, a, opt));
    case 'notify-museum': return tx(db, () => notifyMuseum(db, a, opt));
    case 'import':
      if (a === 'auction-flex' || a === 'csv') return importAuctionFlex(db, opt);
      return fail('Import source: auction-flex (or csv, the same reader)');
    case 'export': return exportAll(db, opt);
    case 'draft-vendor-report': return draftVendorReport(db, a);
    case 'draft-payment-reminder': return draftPaymentReminder(db, a);
    case 'draft-collection-notice': return draftCollectionNotice(db, a);
    case 'draft-weekly-review': return draftWeeklyReview(db);
    default: fail(`Unknown command: ${cmd}\n\n${HELP}`);
  }
}

// ------------------------------------------------------------------ printing

function columnsFor(rows) {
  return Object.keys(rows[0]).filter((k) => k !== 'id' && !/_id$/.test(k) && k !== 'currency' && k !== 'warnings').map((k) => ({
    key: k, label: k.replace(/_cents$/, '').replace(/_bps$/, ' %').replace(/_/g, ' '),
    align: /_cents$|_bps$|lots|days|pct|bids|number|sold|passed|above|below|held|settled|offered/.test(k) ? 'right' : 'left', width: 70,
    format: /_cents$/.test(k) ? (v, r) => (v === null || v === undefined ? '' : money(v, r.currency || 'NZD'))
      : /_bps$/.test(k) ? (v) => (v === null || v === undefined ? '' : `${(Number(v) / 100).toFixed(Number(v) % 100 ? 1 : 0)}%`)
      : (v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' && v !== null ? JSON.stringify(v) : v),
  }));
}
function print(out) {
  if (out?.help) return console.log(out.help);
  if (Array.isArray(out)) return console.log(out.length ? table(out, columnsFor(out)) : '  (none)');
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') { console.log(heading(k.replace(/_/g, ' '))); console.log(table(v, columnsFor(v))); }
    else if (Array.isArray(v)) { console.log(heading(k.replace(/_/g, ' '))); console.log(v.length ? v.map((x) => `  ${x}`).join('\n') : '  (none)'); }
    else console.log(`${k}: ${/_cents$/.test(k) ? money(v, out.currency || 'NZD') : typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const db = await getDb();
  try {
    const out = await execute(db, argv);
    if (json) console.log(JSON.stringify(out, null, 2)); else print(out);
  } catch (err) {
    console.error(err instanceof UserError ? err.message : `Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
