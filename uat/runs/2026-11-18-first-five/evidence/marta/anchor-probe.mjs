#!/usr/bin/env node
// UAT probe (marta-hollis L2, run 2026-11-18-first-five). NOT the product. Calls the BUILT product functions the watch and
// the Desk use (dist/watch/anchors.js: networkLiterals, extractLiterals, reduceToText) on one network sentence and many
// ways a real page writes the same fact, and says for each: is the fact anchored (the network's literal is found on the
// page), and does changing the page's value make the watch count it gone (the only thing an anchor is for).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const { networkLiterals, extractLiterals, reduceToText } = await import(pathToFileURL(path.join(REPO, "dist", "watch", "anchors.js")).href);

const net = (instr) => JSON.stringify({ tools: [{ name: "a", instructions: instr }] });
const cases = [
  // [group, label, network instruction, page html (fact as the network states it), page html (the value changed)]
  ["money", "fixture table: Room | Sleeps | Price, '€89 per night'", "The double room costs €89 per night.", "<tr><td>Double room</td><td>2</td><td>€89 per night</td></tr>", "<tr><td>Double room</td><td>2</td><td>€95 per night</td></tr>"],
  ["money", "table with the price column first: Room | Price | Sleeps", "The double room costs €89 per night.", "<tr><td>Double room</td><td>€89 per night</td><td>2</td></tr>", "<tr><td>Double room</td><td>€95 per night</td><td>2</td></tr>"],
  ["money", "prose: 'sleeps 2: €89'", "The double room costs €89 per night.", "<p>Double room, sleeps 2: €89 per night.</p>", "<p>Double room, sleeps 2: €95 per night.</p>"],
  ["money", "prose without a number before: 'Double room €89'", "The double room costs €89 per night.", "<p>Double room €89 per night</p>", "<p>Double room €95 per night</p>"],
  ["money", "table: Room no. | Price ('Room 4 | €89')", "Room 4 costs €89 per night.", "<tr><td>Room 4</td><td>€89</td></tr>", "<tr><td>Room 4</td><td>€95</td></tr>"],
  ["money", "table: Season | Price ('Summer 2027 | €89')", "In summer the double room costs €89 per night.", "<tr><td>Summer 2027</td><td>€89</td></tr>", "<tr><td>Summer 2027</td><td>€95</td></tr>"],
  ["money", "table: Nights | Price ('7 nights | €560')", "A week costs €560.", "<tr><td>7</td><td>€560</td></tr>", "<tr><td>7</td><td>€600</td></tr>"],
  ["money", "table: Price | Size m² ('€89 | 120')", "The double room costs €89 per night.", "<tr><td>Double room</td><td>€89</td><td>120</td></tr>", "<tr><td>Double room</td><td>€95</td><td>120</td></tr>"],
  ["money", "suffix symbol: '89 €'", "The double room costs €89 per night.", "<p>Double room: 89 € per night</p>", "<p>Double room: 95 € per night</p>"],
  ["money", "suffix symbol after 'Sleeps' cell: '2 | 89 €'", "The double room costs €89 per night.", "<tr><td>Double room</td><td>2</td><td>89 €</td></tr>", "<tr><td>Double room</td><td>2</td><td>95 €</td></tr>"],
  ["money", "decimals: '€89.00'", "The double room costs €89 per night.", "<p>Double room €89.00</p>", "<p>Double room €95.00</p>"],
  ["money", "continental: '89,00 €'", "The double room costs €89 per night.", "<p>Doppelzimmer 89,00 €</p>", "<p>Doppelzimmer 95,00 €</p>"],
  ["money", "ISO before: 'EUR 89'", "The double room costs €89 per night.", "<p>Double room EUR 89</p>", "<p>Double room EUR 95</p>"],
  ["money", "word: '89 euros'", "The double room costs €89 per night.", "<p>Double room 89 euros a night</p>", "<p>Double room 95 euros a night</p>"],
  ["money", "both in words: network '89 euros', page '89 euros'", "The double room costs 89 euros a night.", "<p>Double room 89 euros a night</p>", "<p>Double room 95 euros a night</p>"],
  ["money", "'from €89' with '/night'", "The double room costs €89 per night.", "<p>Double rooms from €89/night</p>", "<p>Double rooms from €95/night</p>"],
  ["money", "entity: '&euro;89'", "The double room costs €89 per night.", "<p>Double room &euro;89</p>", "<p>Double room &euro;95</p>"],
  ["money", "pounds table with Sleeps: '2 | £89'", "The double room costs £89 per night.", "<tr><td>Double</td><td>2</td><td>£89</td></tr>", "<tr><td>Double</td><td>2</td><td>£95</td></tr>"],
  ["money", "dollars, adults column: '2 adults | $89'", "The double room costs $89 per night.", "<tr><td>Double</td><td>2 adults</td><td>$89</td></tr>", "<tr><td>Double</td><td>2 adults</td><td>$95</td></tr>"],
  ["money", "split markup: '<span>€</span><span>89</span>'", "The double room costs €89 per night.", "<p>Double room <span class=cur>€</span><span class=amt>89</span></p>", "<p>Double room <span class=cur>€</span><span class=amt>95</span></p>"],
  ["time", "24h '15:00'", "Check-in is from 15:00.", "<p>Check-in from 15:00</p>", "<p>Check-in from 16:00</p>"],
  ["time", "12h '3pm'", "Check-in is from 15:00.", "<p>Check-in from 3pm</p>", "<p>Check-in from 4pm</p>"],
  ["time", "12h '3 p.m.'", "Check-in is from 15:00.", "<p>Check-in from 3 p.m.</p>", "<p>Check-in from 4 p.m.</p>"],
  ["time", "dot '15.00' (UK/EU)", "Check-in is from 15:00.", "<p>Check-in from 15.00</p>", "<p>Check-in from 16.00</p>"],
  ["time", "dot 12h '10.30am'", "Check-out is by 10:30.", "<p>Check-out by 10.30am</p>", "<p>Check-out by 11.00am</p>"],
  ["time", "range '15:00–20:00'", "Check-in is from 15:00.", "<p>Check-in 15:00–20:00</p>", "<p>Check-in 16:00–20:00</p>"],
  ["time", "French '15h'", "Check-in is from 15:00.", "<p>Arrivée à partir de 15h</p>", "<p>Arrivée à partir de 16h</p>"],
  ["time", "table: Check-in | 15:00", "Check-in is from 15:00.", "<tr><td>Check-in</td><td>15:00</td></tr>", "<tr><td>Check-in</td><td>16:00</td></tr>"],
  ["phone", "international, as the network: '+44 1632 960418'", "Call +44 1632 960418.", "<p>Call +44 1632 960418</p>", "<p>Call +44 1632 960419</p>"],
  ["phone", "national: '01632 960418'", "Call +44 1632 960418.", "<p>Call 01632 960418</p>", "<p>Call 01632 960419</p>"],
  ["phone", "'+44 (0)1632 960418'", "Call +44 1632 960418.", "<p>Call +44 (0)1632 960418</p>", "<p>Call +44 (0)1632 960419</p>"],
  ["phone", "hyphenated: '+44-1632-960418'", "Call +44 1632 960418.", "<p>Call +44-1632-960418</p>", "<p>Call +44-1632-960419</p>"],
  ["phone", "only in a tel: link (text says 'Call us')", "Call +44 1632 960418.", "<p><a href=\"tel:+441632960418\">Call us</a></p>", "<p><a href=\"tel:+441632960419\">Call us</a></p>"],
  ["email", "plain", "Write to stay@larchhouse.example.", "<p>stay@larchhouse.example</p>", "<p>book@larchhouse.example</p>"],
  ["email", "only in a mailto: link (text says 'E-mail us')", "Write to stay@larchhouse.example.", "<p><a href=\"mailto:stay@larchhouse.example\">E-mail us</a></p>", "<p><a href=\"mailto:book@larchhouse.example\">E-mail us</a></p>"],
  ["percent", "'10%' after a number cell", "Children get 10% off.", "<tr><td>Children</td><td>3</td><td>10%</td></tr>", "<tr><td>Children</td><td>3</td><td>15%</td></tr>"],
];

const rows = [];
for (const [group, label, instr, before, after] of cases) {
  const nl = networkLiterals(net(instr));
  const pb = extractLiterals(reduceToText(before));
  const pa = extractLiterals(reduceToText(after));
  const anchored = nl.filter((l) => pb.includes(l));
  const goneAfter = anchored.filter((l) => !pa.includes(l));
  const verdict = anchored.length === 0 ? "NOT ANCHORED (a change is invisible as a fact)" : goneAfter.length > 0 ? "anchored; the change is counted" : "anchored; the change is NOT counted";
  rows.push({ group, label, network: nl, pageBefore: pb, anchored, verdict });
}
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
else for (const r of rows) process.stdout.write(`${r.group.padEnd(7)} ${r.verdict.padEnd(46)} ${r.label}\n        network ${JSON.stringify(r.network)}  page ${JSON.stringify(r.pageBefore)}\n`);
