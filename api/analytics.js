'use strict';
/**
 * GET /api/analytics -> aggregated Vercel Web Analytics for this project (page views, visitors, top pages, countries, devices, referrers).
 * Vercel only serves these numbers to an authenticated caller, so the browser never sees the token: set VERCEL_ANALYTICS_TOKEN
 * (a Vercel access token that can read this project) in the project's environment variables. Without it the endpoint answers
 * { connected: false, reason } and the dashboard shows setup steps instead of numbers. Only aggregates are returned, no visitor-level data.
 * Optional: VERCEL_ANALYTICS_PROJECT_ID (default: VERCEL_PROJECT_ID), VERCEL_ANALYTICS_TEAM_ID (default: the project's team), ANALYTICS_DAYS (default 30, max 90).
 */
const API = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate';
const DIMS = [['pages', 'requestPath'], ['countries', 'country'], ['devices', 'deviceType'], ['referrers', 'referrerHostname'], ['browsers', 'browserName']];

function readRows(json, dim) {
  const rows = Array.isArray(json) ? json : (json && (json.data || json.rows || json.results)) || [];
  return rows.map(r => ({
    key: String(r.key ?? r[dim] ?? r.name ?? r.label ?? ''),
    views: Number(r.total ?? r.count ?? r.pageviews ?? r.views ?? r.visits ?? 0) || 0,
    visitors: Number(r.devices ?? r.visitors ?? r.uniques ?? 0) || 0,
  })).filter(r => r.key !== '');
}
async function query(by, o) {
  const u = new URL(API);
  u.searchParams.set('projectId', o.projectId);
  if (o.teamId) u.searchParams.set('teamId', o.teamId);
  for (const b of by) u.searchParams.append('by', b);
  u.searchParams.set('since', new Date(o.since).toISOString()); u.searchParams.set('until', new Date(o.until).toISOString());
  u.searchParams.set('limit', '10');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { authorization: `Bearer ${o.token}`, accept: 'application/json' } });
    if (!r.ok) throw new Error(`Vercel API ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
function send(res, code, body, cache) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cache || 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');
  res.end(JSON.stringify(body));
}
module.exports = async function handler(req, res, deps) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end(); }
  const env = process.env, token = env.VERCEL_ANALYTICS_TOKEN, projectId = env.VERCEL_ANALYTICS_PROJECT_ID || env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return send(res, 200, { connected: false, reason: !token ? 'no_token' : 'no_project' }, 'public, max-age=0, s-maxage=60');
  const days = Math.min(90, Math.max(7, parseInt(env.ANALYTICS_DAYS, 10) || 30)), now = (deps && deps.now) || Date.now();
  const o = { token, projectId, teamId: env.VERCEL_ANALYTICS_TEAM_ID || env.VERCEL_TEAM_ID, until: now, since: now - days * 864e5 };
  const run = (deps && deps.query) || query;
  try {
    const [daily, ...rest] = await Promise.all([run(['day'], o), ...DIMS.map(([, d]) => run([d], o))]);
    const out = { connected: true, days, since: new Date(o.since).toISOString().slice(0, 10), until: new Date(o.until).toISOString().slice(0, 10), daily: readRows(daily, 'day') };
    DIMS.forEach(([name, d], i) => { out[name] = readRows(rest[i], d); });
    out.totals = { views: out.daily.reduce((a, r) => a + r.views, 0), visitors: out.daily.reduce((a, r) => a + r.visitors, 0) };
    return send(res, 200, out);
  } catch (e) {
    return send(res, 200, { connected: false, reason: 'api_error', detail: String(e && e.message || e).slice(0, 120) }, 'public, max-age=0, s-maxage=30');
  }
};
module.exports.readRows = readRows;
