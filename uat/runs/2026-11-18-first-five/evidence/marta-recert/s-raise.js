const tag = process.env.TAG || 'laptop';
await goto(BASE_URL + '#/drift');
await waitFor('#drift-target');
await fill('#drift-target', 'http://127.0.0.1:4100/');
await click('#drift-run');
await waitUntil(() => /Drift read|could not/i.test(document.querySelector('#drift-status')?.textContent || ''), { label: 'drift status settles', timeout: 60000 });
await waitUntil(() => (document.querySelector('#drift-result')?.textContent || '').length > 20, { label: 'drift result rendered', timeout: 30000 });
await snap(`rc-10-raise-drift-${tag}`);
const st = await page.locator('#drift-status').innerText();
const res = await page.locator('#drift-result').innerText();
note('driftStatus', st); note('driftResult', res);
expectMatch('rooms.html finding says a stated fact is no longer on it', res, /\d+ of \d+ facts[^.]*no longer on it[^.]*/);
expectMatch('it says the network still states it, and the kind', res, /network still states it \(\d+ prices?\)/);
expectMatch('the reading names the price with a currency (95 or 89)', res, /€\s?(89|95)\b|\b(89|95)\s?€|EUR\s?(89|95)/);
expectMatch('no 64-character hash in the default view', res.replace(/[0-9a-f]{64}/g,'<HEX64>'), /^(?![\s\S]*<HEX64>)[\s\S]*$/);
note('hexCount', (res.match(/[0-9a-f]{6,}…?[0-9a-f]*/g)||[]).slice(0,6));
expectMatch('a next step is named for the reader (forward / ask / re-lock)', res, /\b(forward|send this|ask (your|the) (developer|web)|re-?lock|whoever maintains)\b/i);
const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
note('scrollWidth', sw);
expect('no sideways scroll', sw[0] <= sw[1], { sw });
if (tag === 'laptop') {
  const tool = await page.evaluate(async () => { const m = await import('/desk.js'); return await m.App.page.readDrift({ target: 'http://127.0.0.1:4100/' }, { caller: 'assistant' }); });
  note('toolResult', tool);
  const tj = JSON.stringify(tool);
  expectMatch('tool result carries the stale-fact sentence', tj, /no longer on it, and the network still states it \(1 price\)/);
  expectMatch('tool result carries what the lock watches (sources/kinds watched)', tj, /"(watched|watches|sources|coverage|facts)"\s*:/);
  // deep link
  await goto(BASE_URL + '#/drift?target=http://127.0.0.1:4100/');
  await page.waitForTimeout(800);
  const dl = await page.evaluate(() => ({ hash: location.hash, driftVisible: !document.querySelector('#drift')?.hidden, value: document.querySelector('#drift-target')?.value }));
  note('deepLink', dl);
  await snap('rc-11-deeplink');
  expect('deep link opens drift with the address filled in', dl.driftVisible && dl.value === 'http://127.0.0.1:4100/', dl);
}
