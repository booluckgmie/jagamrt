#!/usr/bin/env node
// Pulls Malaysian open data into data/*.json so the PWA works offline and without CORS concerns.
//   data/stations.json  <- data.gov.my GTFS Static, Prasarana rapid-rail-kl (stations, line membership)
//   data/headways.json  <- same feed, frequencies.txt (scheduled headway by line, day type, time window)
//   data/ridership.json <- data.gov.my catalogue `ridership_headline` (daily rail ridership)
// Usage: node scripts/build-open-data.mjs [--dry]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const API = 'https://api.data.gov.my';
const RIDERSHIP_FROM = process.env.RIDERSHIP_FROM || '2025-01-01';
const RIDERSHIP_KEYS = ['rail_mrt_pjy', 'rail_mrt_kajang', 'rail_lrt_kj', 'rail_lrt_ampang', 'rail_lrt_shah_alam', 'rail_monorail'];

function csv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

async function gtfs() {
  const res = await fetch(`${API}/gtfs-static/prasarana?category=rapid-rail-kl`);
  if (!res.ok) throw new Error(`GTFS ${res.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'gtfs-'));
  const zip = join(dir, 'rail.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const read = (f) => csv(execFileSync('unzip', ['-p', zip, f], { maxBuffer: 64 << 20 }).toString('utf8'));
  const routes = read('routes.txt'), stops = read('stops.txt'), times = read('stop_times.txt'), freqs = read('frequencies.txt');

  const stopById = new Map(stops.map((s) => [s.stop_id, s]));
  const lines = routes.filter((r) => r.status !== 'invalid').map((r) => {
    const short = r.route_short_name;
    const seq = new Map(); // stop_id -> earliest stop_sequence on direction 0
    for (const t of times) if (t.route_id === short && t.direction_id === '0') {
      const n = Number(t.stop_sequence); if (!seq.has(t.stop_id) || n < seq.get(t.stop_id)) seq.set(t.stop_id, n);
    }
    const ids = [...seq.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const list = (ids.length ? ids : stops.filter((s) => s.route_id === r.route_id).map((s) => s.stop_id))
      .map((id) => stopById.get(id)).filter((s) => s && isFinite(+s.stop_lat) && isFinite(+s.stop_lon))
      .map((s) => ({ id: s.stop_id, name: s.stop_name, lat: +s.stop_lat, lng: +s.stop_lon }));
    return { id: short, name: r.route_long_name, desc: r.route_desc, category: r.category, color: '#' + r.route_color.replace('#', ''), stations: list };
  }).filter((l) => l.stations.length);

  const headways = {};
  for (const f of freqs) {
    const [line, mode, dir] = f.trip_id.split('_');
    ((headways[line] ??= {})[mode] ??= []).push([mins(f.start_time), mins(f.end_time), Number(f.headway_secs), Number(dir)]);
  }
  return { lines, headways };
}

async function ridership() {
  const url = `${API}/data-catalogue?id=ridership_headline&date_start=${RIDERSHIP_FROM}@date&limit=2000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ridership ${res.status}`);
  const rows = (await res.json()).sort((a, b) => a.date.localeCompare(b.date));
  const series = rows.map((r) => ({ d: r.date, ...Object.fromEntries(RIDERSHIP_KEYS.map((k) => [k.replace('rail_', ''), r[k] ?? null])) }));
  return { latest: rows.at(-1)?.date ?? null, keys: RIDERSHIP_KEYS.map((k) => k.replace('rail_', '')), series };
}

// One top-level key per line, so `updated` sits alone and the workflow's diff can ignore just that line.
const lines = (o) => '{\n' + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n';

const out = { stations: null, headways: null, ridership: null };
const updated = new Date().toISOString();
const tasks = [
  ['stations+headways', async () => { const g = await gtfs(); out.stations = { updated, source: 'data.gov.my GTFS Static (Prasarana rapid-rail-kl)', lines: g.lines }; out.headways = { updated, source: 'data.gov.my GTFS Static frequencies.txt', lines: g.headways }; }],
  ['ridership', async () => { out.ridership = { updated, source: 'data.gov.my catalogue: ridership_headline (Prasarana)', ...(await ridership()) }; }]
];
let failed = 0;
for (const [name, fn] of tasks) {
  try { await fn(); console.log(`ok: ${name}`); } catch (e) { failed++; console.error(`failed: ${name} (${e.message}); keeping previous file`); }
}
console.log(out.stations ? `${out.stations.lines.length} lines, ${out.stations.lines.reduce((n, l) => n + l.stations.length, 0)} station entries` : 'no stations');
console.log(out.ridership ? `ridership ${out.ridership.series.length} days, latest ${out.ridership.latest}` : 'no ridership');
if (!DRY) {
  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  for (const [k, f] of [['stations', 'stations.json'], ['headways', 'headways.json'], ['ridership', 'ridership.json']])
    if (out[k]) await writeFile(resolve(ROOT, 'data', f), lines(out[k]));
}
if (failed === tasks.length) process.exit(1);
