#!/usr/bin/env node
// npm test: a temporary embedded database (or TEST_DATABASE_URL), the migration, the demo data, every
// command, the saleroom arithmetic and the rules that keep the records honest. Runs on Windows and
// Linux. Prints PASS or exits 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { execute, addWorkingDays, addDays } from './auction.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'auction-house-test-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(scratch, 'db');
process.env.OUTPUT_DIR = path.join(scratch, 'output');
const db = await getDb();
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} ${name}`); };
const run = (...args) => execute(db, args);
const bad = (args, re) => assert.rejects(() => run(...args), re);
const q = (sql, p) => db.query(sql, p);
const fixture = (name) => path.join(REPO_ROOT, 'tests', 'fixtures', name);
const n = (v) => Number(v);
let closed = false;
try {
  if (db.mode === 'postgres') {
    if (!/test/i.test(new URL(process.env.TEST_DATABASE_URL).pathname)) throw new Error('TEST_DATABASE_URL must name a disposable database with "test" in its name: the test wipes it.');
    await db.exec('drop schema public cascade; create schema public;');
  }

  await test('migration and seed are repeatable', async () => {
    assert.equal((await migrate(db)).ran.length, 1);
    assert.equal((await migrate(db)).ran.length, 0);
    await seed(db); await seed(db);
    assert.equal((await run('sales')).length, 4);
    assert.equal((await run('lots')).length, 20);
    assert.equal((await run('invoices')).length, 9);
    assert.equal((await run('settlements')).length, 3);
  });

  await test('every read command returns records', async () => {
    for (const c of ['sales', 'clients', 'consignments', 'salerooms', 'settlements', 'lots', 'passed-in', 'storage', 'invoices', 'overdue', 'royalties', 'taonga', 'compliance', 'attention', 'audit'])
      assert(Array.isArray(await run(c)), c);
    assert.equal((await run('catalogue', 'S-103')).lots.length, 4);
    assert.equal((await run('absentee', 'Summer Art Sale')).length, 5);
    assert.equal((await run('results', 'S-102')).summary[0].lots_sold, 5);
    assert.equal((await run('invoice', 'INV-S-102-C-108')).payments.length, 1);
    assert.equal((await run('settlement', 'ST-S-101-CN-102')).lines.length, 2);
    assert.match((await run('help')).help, /import auction-flex/);
    const w = await run('weekly-review');
    assert.deepEqual(w.attention, await run('attention'));
    assert.equal(w.upcoming_sales.length, 1);
  });

  await test('the demo surfaces every kind of loose end', async () => {
    const a = await run('attention');
    for (const c of ['Buyer overdue', 'Settlement not run', 'Settlement overdue', 'Uncollected', 'Passed in', 'Not catalogued', 'No reserve', 'Resale royalty', 'Taonga tūturu', 'Cash, high-value goods', 'Consignment agreement', 'Vendor details'])
      assert(a.some((x) => x.category === c), c);
    assert(a.some((x) => x.category === 'Buyer overdue' && x.item.startsWith('INV-S-102-C-109')));
    assert(a.some((x) => x.category === 'Settlement not run' && x.item === 'S-102 CN-103' && /2 paid lots/.test(x.why)), 'the taonga sold to an unregistered buyer is not settled');
    const c = await run('compliance');
    assert(c.some((x) => x.rule === 'Resale royalty' && x.severity === 'breach' && x.item.startsWith('L-5001')), 'the Australian royalty is late after 90 days');
    assert(c.some((x) => x.rule === 'Taonga tūturu' && x.item === 'L-3002' && /no authorised museum/.test(x.finding)));
    assert(c.some((x) => x.rule === 'Taonga tūturu' && x.item === 'L-2001' && x.severity === 'hold'));
  });

  await test('buyer invoices: hammer, premium, GST on the premium, by country', async () => {
    const [nz] = await q(`select * from invoices where ref = 'INV-S-102-C-108'`);
    assert.equal(n(nz.hammer_cents), 1100000);
    assert.equal(n(nz.premium_cents), 242000);
    assert.equal(n(nz.gst_cents), 36300);
    assert.equal(n(nz.total_cents), 1378300);
    const [au] = await q(`select * from invoices where ref = 'INV-S-201-C-107'`);
    assert.equal(n(au.gst_cents), Math.round(460000 * 0.22 * 0.10));
    const [d] = await q(`select (s.sale_date + 3)::text as due, i.due_on::text as got from invoices i join sales s on s.id = i.sale_id where i.ref = 'INV-S-102-C-108'`);
    assert.equal(d.got, d.due);
  });

  await test('vendor settlements: commission, lot fees, GST on both, royalty deducted, net', async () => {
    const [st] = await q(`select * from settlements where ref = 'ST-S-101-CN-102'`);
    assert.equal(n(st.hammer_cents), 1015000);
    assert.equal(n(st.commission_cents), 118750 + 8125);
    assert.equal(n(st.fees_cents), 5000);
    assert.equal(n(st.gst_cents), Math.round((118750 + 8125 + 5000) * 0.15));
    assert.equal(n(st.royalty_cents), 47500);
    assert.equal(n(st.net_cents), 1015000 - 126875 - 5000 - n(st.gst_cents) - 47500);
    await bad(['mark-paid', 'ST-S-101-CN-102'], /no bank account on file/);
  });

  await test('artist resale royalty: rate, threshold, term, first sales and deadlines', async () => {
    const r = await run('royalties');
    const by = Object.fromEntries(r.map((x) => [x.lot, x]));
    assert.equal(n(by['L-1001'].royalty_cents), 36000);
    assert.equal(n(by['L-2004'].royalty_cents), 10000, 'exactly NZ$2,000 qualifies');
    assert(!by['L-1005'], 'ceramics under the threshold do not qualify');
    assert(!by['L-1002'], 'NZ right ends 50 years after the artist dies');
    assert.equal(n(by['L-5002'].royalty_cents), 6000, 'AU right runs 70 years and the threshold is A$1,000');
    assert(!by['L-5003'], 'artist unknown');
    const [s] = await q(`select sold_on::text as d from lots where ref = 'L-1004'`);
    assert.equal(String(by['L-1004'].report_due_on instanceof Date ? by['L-1004'].report_due_on.toISOString().slice(0, 10) : by['L-1004'].report_due_on).slice(0, 10), addWorkingDays(s.d, 60));
    assert.equal(addWorkingDays('2026-11-13', 1), '2026-11-16');
    assert.equal(addDays('2026-07-26', 90), '2026-10-24');
  });

  await test('a sale from catalogue to settlement', async () => {
    await bad(['hammer', 'L-3002', '--price=16000', '--buyer=C-105'], /certificate of examination/);
    await run('notify-museum', 'L-3002', '--certificate=AIM-2026-201');
    assert(!(await run('compliance')).some((x) => x.item === 'L-3002'));
    await q(`update sales set sale_date = current_date - 1 where ref = 'S-103'`);
    await bad(['hammer', 'L-3001', '--price=2000', '--buyer=C-105'], /below the \$2,800 reserve/);
    await run('hammer', 'L-3001', '--price=4200', '--buyer=James Whitford');
    const h = await run('hammer', 'L-3002', '--price=16000', '--buyer=C-108');
    assert.match(h.warnings.join(' '), /not a registered collector/);
    await run('hammer', 'L-3003', '--price=6800', '--buyer=C-109');
    await bad(['invoice', 'S-103'], /Record a result for every lot first/);
    await run('pass', 'L-3004');
    const dry = await run('invoice', 'S-103', '--dry-run');
    assert.equal(dry.created.length, 3);
    assert.equal((await q(`select count(*)::int as n from invoices i join sales s on s.id = i.sale_id where s.ref = 'S-103'`))[0].n, 0, 'dry run writes nothing');
    const inv = await run('invoice', 'S-103');
    assert.equal(inv.created.length, 3);
    assert.deepEqual(inv.royalties.map((x) => x.lot), ['L-3003'], 'the artist selling her own work is a first sale, not a resale');
    assert.equal((await run('invoice', 'S-103')).kept.length, 3, 'a second run keeps the invoices');
    const [s103] = await q(`select status from sales where ref = 'S-103'`);
    assert.equal(s103.status, 'held');
    await run('pay', 'INV-S-103-C-105', '--method=bank');
    await run('pay', 'INV-S-103-C-108', '--method=bank');
    const stl = await run('settle', 'S-103');
    const cn105 = stl.settlements.find((x) => x.consignment === 'CN-105');
    assert.equal(cn105.lots_settled, 1);
    assert.equal(stl.settlements.find((x) => x.consignment === 'CN-103').lots_settled, 0, 'taonga to an unregistered buyer is held');
    assert.equal(stl.settlements.find((x) => x.consignment === 'CN-104').lots_held, 1, 'unpaid lot is held');
    await bad(['collect', 'L-3002'], /not a registered collector/);
    await run('set', 'client', 'C-108', '--registered-collector=yes');
    const again = await run('settle', 'S-103');
    assert.equal(again.settlements.find((x) => x.consignment === 'CN-103').lots_settled, 1, 'draft settlements re-run');
    await run('approve', 'S-103');
    await bad(['approve', 'S-103'], /No draft settlements/);
    const paid = await run('mark-paid', 'ST-S-103-CN-105');
    assert.equal(paid[0].status, 'paid');
    assert.equal((await run('collect', 'L-3001')).collected, true);
  });

  await test('storage goes on the invoice and is paid before collection', async () => {
    const c = await run('collect', 'L-2005');
    assert.equal(c.collected, false);
    assert.equal(n(c.storage_cents), 5000);
    const again = await run('collect', 'L-2005');
    assert.equal(n(again.owing_cents), 5000, 'storage is charged once');
    await run('pay', 'INV-S-102-C-105', '--method=card');
    assert.equal((await run('collect', 'L-2005')).collected, true);
    await bad(['collect', 'L-2005'], /was collected/);
  });

  await test('cash rules for New Zealand high-value dealers', async () => {
    await run('pay', 'INV-S-102-C-109', '--amount=1000', '--method=cash');
    assert(!(await run('compliance')).some((x) => x.item === 'INV-S-102-C-109'), 'under $10,000 is fine');
    const c = await run('compliance');
    assert(c.some((x) => x.item === 'INV-S-102-C-108' && x.severity === 'breach' && /prohibited for jewellery/.test(x.finding)));
    await q(`update lots set category = 'general' where ref = 'L-2002'`);
    const c2 = await run('compliance');
    assert(c2.some((x) => x.item === 'INV-S-102-C-108' && x.severity === 'check' && /identity is not verified/.test(x.finding)));
    await q(`update lots set category = 'jewellery' where ref = 'L-2002'`);
  });

  await test('records: add, set, resolve, bids, re-offer and return', async () => {
    const [cl] = await run('add', 'client', '--name=Aria Patel', '--email=aria@example.com');
    assert.equal(cl.ref, 'C-113');
    const [cn] = await run('add', 'consignment', '--vendor=Aria', '--saleroom=AKL', '--commission=12.5');
    assert.equal(n(cn.commission_bps), 1250);
    const [lot] = await run('add', 'lot', `--consignment=${cn.ref}`, '--title=Lustre jug', '--category=ceramics', '--low=300', '--high=500', '--reserve=250');
    assert.equal(n(lot.reserve_cents), 25000);
    const [s] = await run('add', 'sale', '--name=Winter Sale', '--saleroom=AKL', `--date=${addDays(new Date().toISOString().slice(0, 10), 40)}`);
    const cat = await run('catalogue-lot', lot.ref, `--sale=${s.ref}`);
    assert.equal(cat[0].lot_number, 1);
    await run('bid', lot.ref, '--bidder=C-105', '--max=400');
    await run('bid', lot.ref, '--bidder=C-105', '--max=450');
    assert.equal((await run('absentee', s.ref)).length, 1, 'a second bid from the same bidder replaces the first');
    await run('catalogue-lot', 'L-1003', `--sale=${s.ref}`);
    assert.equal((await q(`select lot_number from lots where ref = 'L-1003'`))[0].lot_number, 2);
    await run('return', 'L-2006');
    assert.equal((await q(`select status from lots where ref = 'L-2006'`))[0].status, 'returned');
    await bad(['return', 'L-1001'], /only unsold lots/);
    await bad(['add', 'lot', '--title=x'], /needs --consignment/);
    await bad(['add', 'invoice'], /created by invoice/);
    await bad(['set', 'lot', 'L-4001', '--low=abc'], /Invalid amount/);
    await bad(['add', 'sale', '--name=Bad', '--saleroom=AKL', '--date=2026-02-30'], /Invalid calendar date/);
    await bad(['hammer', 'L-4001', '--price=10', '--buyer=C-105'], /not in a sale/);
    const r = await run('report-royalty', 'L-5001', '--paid');
    assert(r[0].reported_on && r[0].paid_on);
    assert(!(await run('compliance')).some((x) => x.item.startsWith('L-5001')));
  });

  await test('import from Auction Flex: dry run, real run, repeat run', async () => {
    const before = (await run('lots')).length;
    const dry = await run('import', 'auction-flex', '--kind=lots', `--file=${fixture('inventory-synthetic.csv')}`, '--dry-run');
    assert.equal(dry.created, 3);
    assert.equal(dry.warnings.length, 1);
    assert.equal((await run('lots')).length, before, 'dry run writes nothing');
    const c = await run('import', 'auction-flex', '--kind=consignors', `--file=${fixture('consignors-synthetic.csv')}`);
    assert.equal(c.created, 2);
    assert.equal(c.skipped, 1, 'Margaret Hollis is already a client');
    const l = await run('import', 'auction-flex', '--kind=lots', `--file=${fixture('inventory-synthetic.csv')}`);
    assert.equal(l.created, 3);
    const [w] = await q(`select category, low_estimate_cents, reserve_cents from lots where ref = 'AF-9001'`);
    assert.equal(w.category, 'painting');
    assert.equal(n(w.low_estimate_cents), 250000);
    assert.equal((await run('import', 'auction-flex', '--kind=lots', `--file=${fixture('inventory-synthetic.csv')}`)).created, 0, 'a repeat import adds nothing');
    assert.equal((await q(`select count(*)::int as n from clients where name = 'Graham Tasker'`))[0].n, 1);
  });

  await test('export and drafts write files and send nothing', async () => {
    const e = await run('export', `--out=${path.join(scratch, 'export')}`);
    assert(e.counts.lots >= 23);
    assert(fs.existsSync(path.join(scratch, 'export', 'snapshot.json')));
    for (const [cmd, arg] of [['draft-vendor-report', 'CN-101'], ['draft-payment-reminder', 'INV-S-102-C-109'], ['draft-collection-notice', 'C-106'], ['draft-weekly-review']]) {
      const d = await run(...[cmd, arg].filter(Boolean));
      const text = fs.readFileSync(d.file, 'utf8');
      assert.match(text, /^> DRAFT/, cmd);
      assert(!/—/.test(text), `${cmd} has no em dash`);
    }
  });

  await test('the audit trail records every change', async () => {
    const a = await run('audit');
    assert(a.length > 0);
    assert((await q(`select count(*)::int as n from audit_events where entity = 'lots' and action = 'UPDATE'`))[0].n > 10);
  });

  // Documents escape what they print.
  await q(`update lots set title = '<script>alert(1)</script> jug' where ref = 'L-3001'`);
  await db.close(); closed = true;

  await test('the CLI exits 1 with candidates on an ambiguous name', async () => {
    const p = spawnSync(process.execPath, ['scripts/auction.mjs', 'card', 'lot', 'oil on', '--json'], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /Ambiguous lot[\s\S]*L-10/);
  });

  await test('every view and document renders, escaped', async () => {
    for (const name of ['view', 'docs']) {
      const p = spawnSync(process.execPath, [`scripts/${name}.mjs`], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
      assert.equal(p.status, 0, p.stderr);
    }
    for (const v of ['week', 'sales', 'money', 'obligations']) assert(fs.existsSync(path.join(process.env.OUTPUT_DIR, 'views', `${v}.html`)), v);
    const dir = path.join(process.env.OUTPUT_DIR, 'docs-out');
    assert(fs.readdirSync(path.join(dir, 'buyer-invoice')).length >= 12);
    assert(fs.readdirSync(path.join(dir, 'vendor-settlement')).length >= 4);
    assert(fs.readdirSync(path.join(dir, 'consignment-receipt')).length >= 8);
    const html = fs.readdirSync(path.join(dir, 'buyer-invoice')).map((f) => fs.readFileSync(path.join(dir, 'buyer-invoice', f), 'utf8')).join('');
    assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>alert'));
  });

  console.log(`PASS: ${checks} end-to-end checks on an isolated ${process.env.TEST_DATABASE_URL ? 'Postgres' : 'embedded'} database.`);
} finally {
  if (!closed) await db.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
