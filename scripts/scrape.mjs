#!/usr/bin/env node
// Putrajaya Line incident scraper: news RSS -> (LLM | keyword) extraction -> data/*.json
// Usage: node scripts/scrape.mjs [--dry] [--fixture path.xml]
// Env:   GROQ_API_KEY (optional; without it a keyword extractor is used)
//        GROQ_MODEL   (default llama-3.3-70b-versatile)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INCIDENTS = resolve(ROOT, 'data/incidents.json');
const ACTIVE = resolve(ROOT, 'data/active.json');

const STATIONS = ['Kuchai', 'Serdang Jaya', 'UPM', 'Taman Equine', 'Putra Permai', '16 Sierra', 'Cyberjaya Utara', 'Cyberjaya City Centre', 'Putrajaya Sentral'];
const CAUSES = ['theft', 'power', 'signal', 'debris', 'unknown'];
const FEEDS = [
  'https://news.google.com/rss/search?q=%22MRT+Putrajaya%22+(disruption+OR+delay+OR+gangguan)&hl=en-MY&gl=MY&ceid=MY:en',
  'https://news.google.com/rss/search?q=%22Laluan+Putrajaya%22+MRT+(gangguan+OR+terjejas)&hl=ms-MY&gl=MY&ceid=MY:ms',
  'https://paultan.org/feed/'
];
// An article must mention the line AND a disruption word to reach extraction.
const LINE_RE = /putrajaya\s+(mrt\s+)?line|mrt\s+putrajaya|laluan\s+(mrt\s+)?putrajaya|kwasa\s+damansara.*putrajaya/i;
const DISRUPT_RE = /disrupt|delay|gangguan|terjejas|lewat|cable|kabel|power\s+(fault|outage|loss)|signal|breakdown|stalled|shuttle|turn(ed)?\s*back|manual/i;
// Record starts here; older coverage predates the dashboard's scope.
const MIN_DATE = process.env.MIN_DATE || '2025-07-01';
const STRONG_RE = /disrupt|gangguan|terjejas|stalled|breakdown|shuttle|turn(ed)?\s*back/i;
// Court, arrest and policy follow-ups are not service disruptions.
const FOLLOWUP_RE = /diberkas|ditahan|suspek|arrest|remand|charged|court|mahkamah|dituduh|jailed|penjara/i;
const RESOLVED_RE = /back to normal|resum(e|ed|es)|restored|pulih|beroperasi seperti biasa|normal service/i;

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const fixtureIdx = args.indexOf('--fixture');
const FIXTURE = fixtureIdx >= 0 ? args[fixtureIdx + 1] : null;

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#8211;|&#8212;/g, '-').replace(/&amp;/g, '&');
const strip = (s) => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, b]) => {
    const pub = new Date(strip(tag(b, 'pubDate')));
    const src = strip(tag(b, 'source'));
    let title = strip(tag(b, 'title'));
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
    return {
      title,
      link: strip(tag(b, 'link')),
      sn: src || (strip(tag(b, 'link')).match(/\/\/(?:www\.)?([^/]+)/) || [, 'News'])[1],
      pub: isNaN(pub) ? null : pub,
      text: strip(tag(b, 'description')) + ' ' + strip(tag(b, 'content:encoded'))
    };
  }).filter((a) => a.link && a.pub);
}

// Malaysia is UTC+8, no DST.
const myt = (d) => new Date(d.getTime() + 8 * 3600e3);
const mytDate = (d) => myt(d).toISOString().slice(0, 10);
const mytTime = (d) => myt(d).toISOString().slice(11, 16);

function keywordExtract(a) {
  const t = `${a.title}. ${a.text}`;
  const lc = t.toLowerCase();
  let cause = 'unknown';
  if (/cable\s+theft|theft|kabel.*(curi|dicuri)|dicuri/.test(lc)) cause = 'theft';
  else if (/power\s+(fault|outage|loss|disruption|supply)|bekalan kuasa|elektrik/.test(lc)) cause = 'power';
  else if (/signal/.test(lc)) cause = 'signal';
  else if (/debris|object on (the )?track|puing/.test(lc)) cause = 'debris';
  const stations = STATIONS.filter((s) => lc.includes(s.toLowerCase()));
  const relevant = !FOLLOWUP_RE.test(a.title) && (cause !== 'unknown' || stations.length > 0 || STRONG_RE.test(t));
  return { relevant, cause, stations, resolved: RESOLVED_RE.test(t), summary: a.title };
}

async function llmExtract(a, key) {
  const system = 'You extract MRT Putrajaya Line disruption facts from Malaysian news. Reply with JSON only.';
  const user = `Article title: ${a.title}\nPublished: ${a.pub.toISOString()}\nText: ${a.text.slice(0, 3000)}\n\n` +
    `Return JSON: {"relevant": boolean (true only if this reports a current/recent service disruption on the MRT Putrajaya Line; false for arrests, court cases, policy or opening-date news), ` +
    `"cause": one of ${JSON.stringify(CAUSES)}, "stations": array of station names from ${JSON.stringify(STATIONS)} that are the fault point or edge of the faulty section, ` +
    `"resolved": boolean (service back to normal), "summary": one factual sentence under 200 chars about turnbacks, shuttles, frequency or restoration; do not guess}`;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const out = JSON.parse((await res.json()).choices[0].message.content);
  return {
    relevant: !!out.relevant,
    cause: CAUSES.includes(out.cause) ? out.cause : 'unknown',
    stations: (Array.isArray(out.stations) ? out.stations : []).filter((s) => STATIONS.includes(s)),
    resolved: !!out.resolved,
    summary: String(out.summary || a.title).slice(0, 240)
  };
}

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const rank = (c) => CAUSES.indexOf(c) === 4 ? 99 : CAUSES.indexOf(c); // prefer any stated cause

async function main() {
  const store = await readJson(INCIDENTS, { updated: null, seen: [], incidents: [] });
  const seen = new Set(store.seen);
  const key = process.env.GROQ_API_KEY;

  let articles = [];
  if (FIXTURE) articles = parseRss(await readFile(FIXTURE, 'utf8'));
  else for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'jagamrt-scraper/1.0' } });
      if (!r.ok) throw new Error(r.status);
      articles.push(...parseRss(await r.text()));
    } catch (e) { console.error(`feed failed: ${url} (${e.message})`); }
  }

  const fresh = articles.filter((a) => !seen.has(a.link) && mytDate(a.pub) >= MIN_DATE && LINE_RE.test(`${a.title} ${a.text}`) && DISRUPT_RE.test(`${a.title} ${a.text}`));
  console.log(`${articles.length} articles, ${fresh.length} new candidates, extractor: ${key ? 'groq' : 'keyword'}`);

  const byDate = new Map(store.incidents.map((i) => [i.date, i]));
  const resolvedDates = new Set(store.incidents.filter((i) => i.resolved).map((i) => i.date));
  let added = 0, merged = 0;

  for (const a of fresh.sort((x, y) => x.pub - y.pub)) {
    let x;
    try { x = key ? await llmExtract(a, key) : keywordExtract(a); }
    catch (e) { console.error(`extract failed, using keywords: ${a.title} (${e.message})`); x = keywordExtract(a); }
    seen.add(a.link);
    if (!x.relevant) continue;

    const date = mytDate(a.pub);
    // Follow-up coverage often lands the next day; fold it into the same event.
    const cur = [0, 1, 2].map((n) => byDate.get(mytDate(new Date(a.pub.getTime() - n * 86400e3)))).find(Boolean);
    // A "back to normal" story only closes an incident we already have.
    if (x.resolved && !cur) continue;
    if (!cur) {
      byDate.set(date, {
        id: 's-' + date, date, time: null, morning: mytTime(a.pub) < '12:00',
        cause: x.cause, stations: x.stations, title: a.title.slice(0, 120), note: x.summary,
        src: a.link, sn: a.sn, resolved: x.resolved, auto: true, firstSeen: a.pub.toISOString()
      });
      added++;
    } else if (cur.auto) { // enrich an auto-created record from a later article
      if (rank(x.cause) < rank(cur.cause)) cur.cause = x.cause;
      cur.stations = [...new Set([...cur.stations, ...x.stations])];
      if (x.resolved) cur.resolved = true;
      if (x.summary.length > cur.note.length) cur.note = x.summary;
      merged++;
    } // hand-curated records are never overwritten
  }

  const incidents = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const next = { updated: new Date().toISOString(), seen: [...seen].slice(-2000), incidents };

  // Active = an auto-detected, unresolved incident dated today (MYT).
  const today = mytDate(new Date());
  const act = incidents.find((i) => i.date === today && !i.resolved && !resolvedDates.has(today));
  const active = act ? {
    line: 'Putrajaya Line', since: act.date, summary: act.note, stations: act.stations.length ? act.stations : [],
    src: act.src, sn: act.sn
  } : null;

  console.log(`added ${added}, merged ${merged}, active: ${active ? active.summary : 'none'}`);
  if (DRY) return console.log(JSON.stringify({ incidents: incidents.filter((i) => i.auto), active }, null, 2));
  await mkdir(dirname(INCIDENTS), { recursive: true });
  await writeFile(INCIDENTS, JSON.stringify(next, null, 2) + '\n');
  await writeFile(ACTIVE, JSON.stringify({ updated: next.updated, active }, null, 2) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
