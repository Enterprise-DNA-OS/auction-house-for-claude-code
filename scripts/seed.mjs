#!/usr/bin/env node
// Loads the demo data (supabase/seed.sql), then records what happened at the three sales already
// held through the CLI: hammer results, buyer invoices, payments, collections, vendor settlements and
// royalty reports, so the demo has a history. A second run does nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { execute } from './auction.mjs';

export async function seed(db) {
  await db.exec('BEGIN');
  try {
    await db.exec(readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
  if ((await db.query('select count(*)::int as n from invoices'))[0].n) return;
  const day = async (offset) => (await db.query(`select (current_date + $1::int)::text as d`, [offset]))[0].d;
  const run = (...args) => execute(db, args);

  // Sydney, 110 days ago: everything paid, collected and settled; one royalty reported, one not.
  await run('hammer', 'L-5001', '--price=4600', '--buyer=C-107');
  await run('hammer', 'L-5002', '--price=1200', '--buyer=C-111');
  await run('hammer', 'L-5003', '--price=900', '--buyer=C-111');
  await run('invoice', 'S-201');
  await run('pay', 'INV-S-201-C-107', '--method=bank', `--date=${await day(-108)}`);
  await run('pay', 'INV-S-201-C-111', '--method=card', `--date=${await day(-107)}`);
  for (const l of ['L-5001', 'L-5002', 'L-5003']) await run('collect', l, `--date=${await day(-105)}`);
  await run('settle', 'S-201');
  await run('approve', 'S-201');
  await run('mark-paid', 'S-201', `--date=${await day(-90)}`);
  await run('report-royalty', 'L-5002', `--date=${await day(-80)}`, '--paid');
  await db.query(`update sales set status = 'closed' where ref = 'S-201'`);

  // Auckland, 40 days ago: one lot passed in and never sent back; one vendor with no bank account.
  await run('hammer', 'L-1001', '--price=7200', '--buyer=C-105');
  await run('hammer', 'L-1002', '--price=2200', '--buyer=C-108');
  await run('pass', 'L-1003');
  await run('hammer', 'L-1004', '--price=9500', '--buyer=C-106');
  await run('hammer', 'L-1005', '--price=650', '--buyer=C-108');
  await run('invoice', 'S-101');
  await run('pay', 'INV-S-101-C-105', '--method=bank', `--date=${await day(-38)}`);
  await run('pay', 'INV-S-101-C-106', '--method=bank', `--date=${await day(-36)}`);
  await run('pay', 'INV-S-101-C-108', '--method=card', `--date=${await day(-37)}`);
  for (const l of ['L-1001', 'L-1002', 'L-1004', 'L-1005']) await run('collect', l, `--date=${await day(-35)}`);
  await run('settle', 'S-101');
  await run('approve', 'ST-S-101-CN-101');
  await run('mark-paid', 'ST-S-101-CN-101', `--date=${await day(-20)}`);
  await run('approve', 'ST-S-101-CN-102');
  await run('report-royalty', 'L-1001', `--date=${await day(-25)}`, '--paid');
  await db.query(`update sales set status = 'closed' where ref = 'S-101'`);

  // Auckland, 12 days ago: one buyer unpaid, jewellery paid in cash, a taonga to a buyer who is not
  // a registered collector, a desk nobody has collected, nothing settled yet.
  await run('hammer', 'L-2001', '--price=8000', '--buyer=C-106');
  await run('hammer', 'L-2002', '--price=11000', '--buyer=C-108');
  await run('hammer', 'L-2003', '--price=15000', '--buyer=C-105');
  await run('hammer', 'L-2004', '--price=2000', '--buyer=C-109');
  await run('hammer', 'L-2005', '--price=1800', '--buyer=C-105');
  await run('pass', 'L-2006');
  await run('invoice', 'S-102');
  await run('pay', 'INV-S-102-C-105', '--method=bank', `--date=${await day(-10)}`);
  await run('pay', 'INV-S-102-C-108', '--method=cash', `--date=${await day(-11)}`);
  await run('pay', 'INV-S-102-C-106', '--method=bank', `--date=${await day(-9)}`);
  await run('collect', 'L-2003', `--date=${await day(-8)}`);
  await run('collect', 'L-2002', `--date=${await day(-11)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    if (db.mode === 'postgres' && !process.argv.includes('--demo-database')) {
      throw new Error('Shared database seed requires --demo-database. Use only an empty disposable demo database.');
    }
    await seed(db);
    console.log(`seed: demo data ready (${db.mode})`);
  } finally {
    await db.close();
  }
}
