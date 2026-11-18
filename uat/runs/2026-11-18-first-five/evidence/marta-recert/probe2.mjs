// Recertify probe (marta recert): more ways of writing the same fact, through the BUILT dist/watch/anchors.js.
import path from "node:path"; import { pathToFileURL } from "node:url";
const { networkLiterals, extractLiterals, reduceToText } = await import(pathToFileURL(path.join(process.argv[2], "dist/watch/anchors.js")).href);
const net = (i) => JSON.stringify({ tools: [{ name: "a", instructions: i }] });
const P = "The double room costs €89 per night.", T = "Check-in is from 15:00.", T2 = "Check-in is from 12:00.", F = "Call +44 1632 960418.";
const cases = [
  ["money", "'€ 89' (space)", P, "<td>€ 89</td>", "<td>€ 95</td>"],
  ["money", "'89€'", P, "<td>89€</td>", "<td>95€</td>"],
  ["money", "'89,- €'", P, "<td>89,- €</td>", "<td>95,- €</td>"],
  ["money", "'EUR89'", P, "<td>EUR89</td>", "<td>EUR95</td>"],
  ["money", "'Euro 89'", P, "<td>Euro 89</td>", "<td>Euro 95</td>"],
  ["money", "'89 Euro'", P, "<td>89 Euro</td>", "<td>95 Euro</td>"],
  ["money", "'<sup>€</sup>89'", P, "<td><sup>€</sup>89</td>", "<td><sup>€</sup>95</td>"],
  ["money", "'€89pp'", P, "<td>€89pp</td>", "<td>€95pp</td>"],
  ["money", "'€89–€109 by season'", P, "<td>€89–€109</td>", "<td>€95–€109</td>"],
  ["money", "'from €89 to €109'", P, "<p>from €89 to €109</p>", "<p>from €95 to €109</p>"],
  ["money", "'€&nbsp;89'", P, "<td>€&nbsp;89</td>", "<td>€&nbsp;95</td>"],
  ["money", "'&#8364;89'", P, "<td>&#8364;89</td>", "<td>&#8364;95</td>"],
  ["money", "'eighty-nine euros'", P, "<p>eighty-nine euros</p>", "<p>ninety-five euros</p>"],
  ["money", "'<del>€89</del> €79' (offer)", P, "<td>€89</td>", "<td><del>€89</del> €79</td>"],
  ["money", "booking form <option>Double – €89</option>", P, "<select><option>Double – €89</option></select>", "<select><option>Double – €95</option></select>"],
  ["money", "price only in JSON-LD", P, "<script type=\"application/ld+json\">{\"price\":\"89\",\"priceCurrency\":\"EUR\"}</script>", "<script type=\"application/ld+json\">{\"price\":\"95\",\"priceCurrency\":\"EUR\"}</script>"],
  ["money", "price only in an image alt", P, "<img alt=\"Double €89\" src=x>", "<img alt=\"Double €95\" src=x>"],
  ["time", "'3 o'clock'", T, "<p>from 3 o'clock</p>", "<p>from 4 o'clock</p>"],
  ["time", "'from 3' (no unit)", T, "<p>Check-in from 3</p>", "<p>Check-in from 4</p>"],
  ["time", "'3-6pm' range", T, "<p>Check-in 3-6pm</p>", "<p>Check-in 4-6pm</p>"],
  ["time", "'15 Uhr'", T, "<p>ab 15 Uhr</p>", "<p>ab 16 Uhr</p>"],
  ["time", "'noon' (network 12:00)", T2, "<p>from noon</p>", "<p>from 1pm</p>"],
  ["time", "'15.00' bare in a table cell", T, "<tr><td>Check-in</td><td>15.00</td></tr>", "<tr><td>Check-in</td><td>16.00</td></tr>"],
  ["time", "'1500 hrs'", T, "<p>Check-in 1500 hrs</p>", "<p>Check-in 1600 hrs</p>"],
  ["phone", "'01632 96 04 18'", F, "<p>01632 96 04 18</p>", "<p>01632 96 04 19</p>"],
  ["phone", "'+44 (0) 1632 960 418'", F, "<p>+44 (0) 1632 960 418</p>", "<p>+44 (0) 1632 960 419</p>"],
  ["phone", "'01632-960-418'", F, "<p>01632-960-418</p>", "<p>01632-960-419</p>"],
  ["phone", "'(01632) 960418'", F, "<p>(01632) 960418</p>", "<p>(01632) 960419</p>"],
  ["phone", "'Tel 01632960418'", F, "<p>Tel 01632960418</p>", "<p>Tel 01632960419</p>"],
];
for (const [g, label, instr, before, after] of cases) {
  const nl = networkLiterals(net(instr)), pb = extractLiterals(reduceToText(before)), pa = extractLiterals(reduceToText(after));
  const anchored = nl.filter((l) => pb.includes(l)), gone = anchored.filter((l) => !pa.includes(l));
  const v = anchored.length === 0 ? "NOT ANCHORED (init names it as not on the page)" : gone.length ? "anchored; change counted" : "anchored; change NOT counted (false all-clear)";
  console.log(`${g.padEnd(6)} ${v.padEnd(50)} ${label}\n       network ${JSON.stringify(nl)} page ${JSON.stringify(pb)} after ${JSON.stringify(pa)}`);
}
