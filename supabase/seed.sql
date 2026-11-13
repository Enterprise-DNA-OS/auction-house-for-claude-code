-- Demo data: an auction house with a saleroom in Auckland and one in Sydney. Twelve clients, seven
-- consignments, four sales (two held in Auckland, one coming up, one held in Sydney) and the usual
-- loose ends: a buyer who has not paid, lots nobody has collected, a lot passed in and never sent
-- back, lots sitting in the store uncatalogued, an artist resale royalty not reported in time, a
-- taonga tūturu knocked down to a buyer who is not a registered collector, another in the next sale
-- with no museum notice, cash over the limit for jewellery, an unsigned consignment agreement, a lot
-- with no reserve, and a GST-registered vendor with no GST number. Every name here is invented.
-- Dates are relative to today so the demo always has something to say. scripts/seed.mjs then
-- records the hammer results, invoices, payments and settlements through the CLI.
do $$ begin
if exists (select 1 from salerooms where ref = 'AKL') then return; end if;
if exists (select 1 from salerooms) then raise exception 'Demo seed requires an empty database'; end if;

insert into salerooms (ref, name, country, currency) values
 ('AKL', 'Harbour and Hill Auctions, Auckland', 'NZ', 'NZD'),
 ('SYD', 'Harbour and Hill Auctions, Sydney', 'AU', 'AUD');

insert into clients (ref, name, email, phone, country, gst_registered, gst_number, id_verified_on, bank_account_on_file, is_registered_collector, note) values
 ('C-101', 'Margaret Hollis', 'margaret@example.com', '021 555 0101', 'NZ', false, '', current_date - 400, true, false, 'Long-time vendor, paintings and furniture'),
 ('C-102', 'Estate of Robert Cole', 'executor.cole@example.com', '09 555 0102', 'NZ', false, '', current_date - 60, true, false, 'Executor: Anne Cole'),
 ('C-103', 'Peter Vance', 'peter@example.com', '027 555 0103', 'NZ', true, '', current_date - 90, false, false, ''),
 ('C-104', 'Kauri Gallery Ltd', 'accounts@kauri.example.com', '09 555 0104', 'NZ', true, '123-456-789', current_date - 700, true, false, 'Dealer'),
 ('C-105', 'James Whitford', 'james@example.com', '021 555 0105', 'NZ', false, '', current_date - 300, true, true, 'Registered collector'),
 ('C-106', 'Sina Faleolo', 'sina@example.com', '022 555 0106', 'NZ', false, '', null, false, false, ''),
 ('C-107', 'Daniel Ruiz', 'daniel@example.com', '0412 555 107', 'AU', false, '', current_date - 200, false, false, ''),
 ('C-108', 'Helen Park', 'helen@example.com', '021 555 0108', 'NZ', false, '', null, false, false, ''),
 ('C-109', 'Tom Ashby', 'tom@example.com', '027 555 0109', 'NZ', false, '', current_date - 30, false, false, ''),
 ('C-110', 'Olivia Grant', 'olivia@example.com', '0413 555 110', 'AU', false, '', current_date - 150, true, false, ''),
 ('C-111', 'Leon Marsh', 'leon@example.com', '0414 555 111', 'AU', false, '', current_date - 150, false, false, ''),
 ('C-112', 'Rachel Moana', 'rachel@example.com', '021 555 0112', 'NZ', false, '', null, true, false, 'Artist selling her own work');

insert into consignments (ref, vendor_id, saleroom_id, received_on, agreement_signed_on, commission_bps, lot_fee_cents, settlement_days, note)
select x.ref, (select id from clients where ref = x.vendor), (select id from salerooms where ref = x.room), current_date + x.received, current_date + x.signed, x.commission, x.fee, x.days, x.note
from (values
 ('CN-101', 'C-101', 'AKL', -70, -70, 1500, 2500, 21, ''),
 ('CN-102', 'C-103', 'AKL', -60, -58, 1250, 2500, 21, ''),
 ('CN-103', 'C-102', 'AKL', -50, -49, 1500, 2500, 28, 'Estate: taonga, jewellery, furniture'),
 ('CN-104', 'C-104', 'AKL', -30, -30, 1000, 0, 14, 'Dealer rate'),
 ('CN-105', 'C-112', 'AKL', -20, null, 1500, 2500, 21, 'Agreement sent, not back'),
 ('CN-106', 'C-110', 'SYD', -130, -130, 1500, 3000, 21, ''),
 ('CN-107', 'C-101', 'AKL', -85, -85, 1500, 2500, 21, 'Second consignment')
) as x(ref, vendor, room, received, signed, commission, fee, days, note);

insert into sales (ref, name, saleroom_id, sale_date, premium_bps, status)
select x.ref, x.name, (select id from salerooms where ref = x.room), current_date + x.d, x.premium, x.status
from (values
 ('S-101', 'Spring Art Sale', 'AKL', -40, 2000, 'catalogued'),
 ('S-102', 'Decorative Arts and Taonga', 'AKL', -12, 2200, 'catalogued'),
 ('S-103', 'Summer Art Sale', 'AKL', 10, 2000, 'catalogued'),
 ('S-201', 'Works on Paper and Photographs', 'SYD', -110, 2200, 'catalogued')
) as x(ref, name, room, d, premium, status);

insert into lots (ref, consignment_id, sale_id, lot_number, title, category, artist, artist_died_year, low_estimate_cents, high_estimate_cents, reserve_cents, status, is_taonga_tuturu, museum_notified_on, examination_certificate, location)
select x.ref, (select id from consignments where ref = x.cons), (select id from sales where ref = x.sale), x.n, x.title, x.cat, x.artist, x.died,
       x.low * 100, x.high * 100, x.reserve * 100, x.status, x.taonga, current_date + x.notified, x.cert, x.loc
from (values
 ('L-1001', 'CN-101', 'S-101', 1, 'Rangitoto from Takapuna, oil on board', 'painting', 'Eleanor Marsh', null::int, 4000, 6000, 3500, 'catalogued', false, null::int, '', 'Store A1'),
 ('L-1002', 'CN-101', 'S-101', 2, 'Harbour Study No. 3, etching', 'print', 'Colin Pryor', 1968, 1500, 2500, 1200, 'catalogued', false, null, '', 'Store A1'),
 ('L-1003', 'CN-101', 'S-101', 3, 'Kauri chest of drawers', 'furniture', '', null, 1200, 1800, 1000, 'catalogued', false, null, '', 'Store C4'),
 ('L-1004', 'CN-102', 'S-101', 4, 'Evening, Lake Pukaki, oil on canvas', 'painting', 'Grace Whitby', null, 8000, 12000, 7000, 'catalogued', false, null, '', 'Store A2'),
 ('L-1005', 'CN-102', 'S-101', 5, 'Studio stoneware bowl', 'ceramics', 'M. Ferris', null, 600, 900, 500, 'catalogued', false, null, '', 'Store B1'),
 ('L-2001', 'CN-103', 'S-102', 1, 'Hei tiki, pounamu', 'taonga', '', null, 6000, 9000, 5000, 'catalogued', true, -45, 'AIM-2026-114', 'Safe 1'),
 ('L-2002', 'CN-103', 'S-102', 2, 'Diamond solitaire ring, 1.2 carat', 'jewellery', '', null, 9000, 12000, 8000, 'catalogued', false, null, '', 'Safe 1'),
 ('L-2003', 'CN-104', 'S-102', 3, 'Two Figures, Otaki, oil on canvas', 'painting', 'Henry Lowe', null, 12000, 16000, 11000, 'catalogued', false, null, '', 'Store A2'),
 ('L-2004', 'CN-104', 'S-102', 4, 'Tui on Flax, bronze', 'sculpture', 'Ana Kerr', null, 2500, 3500, 1800, 'catalogued', false, null, '', 'Store B2'),
 ('L-2005', 'CN-103', 'S-102', 5, 'Victorian walnut writing desk', 'furniture', '', null, 1500, 2500, 1200, 'catalogued', false, null, '', 'Store C1'),
 ('L-2006', 'CN-103', 'S-102', 6, 'Silver tea service, four pieces', 'general', '', null, 1800, 2400, 1600, 'catalogued', false, null, '', 'Store B3'),
 ('L-3001', 'CN-105', 'S-103', 1, 'Matiu Island, Morning, acrylic', 'painting', 'Rachel Moana', null, 3000, 5000, 2800, 'catalogued', false, null, '', 'Store A3'),
 ('L-3002', 'CN-103', 'S-103', 2, 'Wahaika, carved whalebone', 'taonga', '', null, 15000, 20000, 14000, 'catalogued', true, null, '', 'Safe 2'),
 ('L-3003', 'CN-104', 'S-103', 3, 'Pohutukawa Coast, oil on board', 'painting', 'Henry Lowe', null, 5000, 7000, null, 'catalogued', false, null, '', 'Store A3'),
 ('L-3004', 'CN-101', 'S-103', 4, 'Kiwi, linocut', 'print', 'Jo Tamati', null, 800, 1200, 700, 'catalogued', false, null, '', 'Store A1'),
 ('L-4001', 'CN-107', null, null, 'Art deco mantel clock', 'collectables', '', null, 400, 600, null, 'received', false, null, '', 'Store D2'),
 ('L-4002', 'CN-107', null, null, 'Pair of Chinese export vases', 'ceramics', '', null, 2000, 3000, null, 'received', false, null, '', 'Store D2'),
 ('L-5001', 'CN-106', 'S-201', 1, 'Bondi, Late Light, watercolour', 'painting', 'Peter Hale', null, 3000, 5000, 2500, 'catalogued', false, null, '', 'SYD Rack 1'),
 ('L-5002', 'CN-106', 'S-201', 2, 'Botany Bay, etching', 'print', 'Walter Finch', 1990, 900, 1400, 800, 'catalogued', false, null, '', 'SYD Rack 1'),
 ('L-5003', 'CN-106', 'S-201', 3, 'Harbour Bridge, 1932, silver gelatin print', 'photograph', '', null, 700, 1000, 600, 'catalogued', false, null, '', 'SYD Rack 2')
) as x(ref, cons, sale, n, title, cat, artist, died, low, high, reserve, status, taonga, notified, cert, loc);

insert into absentee_bids (ref, lot_id, bidder_id, max_cents, kind, placed_on)
select x.ref, (select id from lots where ref = x.lot), (select id from clients where ref = x.bidder), x.max * 100, x.kind, current_date + x.d
from (values
 ('AB-101', 'L-3001', 'C-105', 4200, 'absentee', -3),
 ('AB-102', 'L-3003', 'C-108', 6500, 'absentee', -2),
 ('AB-103', 'L-3003', 'C-109', 7000, 'phone', -1),
 ('AB-104', 'L-3004', 'C-106', 650, 'absentee', -1),
 ('AB-105', 'L-3004', 'C-105', 900, 'absentee', 0)
) as x(ref, lot, bidder, max, kind, d);
end $$;
