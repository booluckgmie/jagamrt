// Putrajaya Line disruption record + pre-tracking warning.
// Hand-built from news and Rapid KL notices; not an official incident log.
(function () {
  var CAUSES = {
    theft: { n: 'Cable theft', c: '#c8421e' },
    power: { n: 'Power fault', c: '#1f5fad' },
    signal: { n: 'Signalling fault', c: '#7a4fb5' },
    debris: { n: 'Track debris', c: '#2e8b6a' },
    unknown: { n: 'Not stated', c: '#7c8794' }
  };
  var STATIONS = ['Kuchai', 'Serdang Jaya', 'UPM', 'Taman Equine', 'Putra Permai', '16 Sierra', 'Cyberjaya Utara', 'Cyberjaya City Centre', 'Putrajaya Sentral'];
  var CURATED = [
    { id: 'a1', date: '2025-07-29', time: '05:42', cause: 'debris', stations: ['UPM', 'Taman Equine'], title: 'Stalled train, debris on track', note: 'Train stalled between UPM and Taman Equine. Kwasa Damansara trains ended at UPM; shuttle trains and feeder buses ran.', src: 'https://www.scoop.my/news/265937/putrajaya-mrt-line-faces-delays-due-to-debris-on-track-blocking-movement/', sn: 'Scoop' },
    { id: 'a2', date: '2025-09-23', time: '05:54', cause: 'power', stations: ['Taman Equine', '16 Sierra'], title: 'Power fault, six stations closed', note: 'Power loss between Taman Equine and 16 Sierra hit lighting, escalators, lifts and gates. Six stations from Taman Equine to Putrajaya Sentral closed and reopened at 6am the next day.', src: 'https://api.nst.com.my/news/nation/2025/09/1279945/six-mrt-putrajaya-line-stations-resume-operations-after-power', sn: 'NST' },
    { id: 'a3', date: '2025-10-25', time: '06:21', cause: 'theft', stations: ['Kuchai'], title: 'Fibre optic cable theft, signalling down', note: 'Whole line ran manually at 20 to 30 minute gaps. First alert 6:21am, theft named as the cause at 1:36pm. Police found no CCTV at the site. Repairs ran into 26 Oct.', src: 'https://www.malaymail.com/news/malaysia/2025/10/25/mrt-putrajaya-disruption-police-say-probing-cable-theft-trespass-reported-and-cable-pile-found/195898', sn: 'Malay Mail' },
    { id: 'a4', date: '2025-12-16', time: null, cause: 'signal', stations: ['UPM', 'Taman Equine'], title: 'Signalling fault', note: 'Signalling disruption between UPM and Taman Equine. Trains turned back at UPM with shuttles beyond.', src: 'https://myrapid.com.my/%F0%9F%93%A2kemas-kini-laluan-mrt-putrajaya-mrt-putrajaya-line-update/', sn: 'MyRapid' },
    { id: 'a5', date: '2026-04-06', time: null, cause: 'unknown', stations: ['UPM', 'Taman Equine'], title: 'Manual driving, cause not stated', note: 'Trains driven manually between UPM and Taman Equine during repairs. Update posted at 11:26am.', src: 'https://paultan.org/2026/04/06/mrt-putrajaya-line-facing-delays-trains-from-kwasa-turning-back-at-upm-shuttle-trains-buses-deployed/', sn: 'paultan.org' },
    { id: 'a6', date: '2026-08-12', time: null, morning: true, cause: 'power', stations: ['Taman Equine', 'Putrajaya Sentral'], title: 'Power outage, no trains past Taman Equine', note: 'No trains between Taman Equine and Putrajaya Sentral. Normal service returned at 4:29pm.', src: 'https://paultan.org/2026/08/12/mrt-putrajaya-line-back-to-normal-at-4-29-pm-power-restored-free-shuttle-buses-continue-to-run-till-10pm/', sn: 'paultan.org' },
    { id: 'a7', date: '2026-10-04', time: null, morning: true, cause: 'theft', stations: ['Taman Equine'], title: 'Cable theft, power lost', note: 'Theft near Taman Equine cut power. Kwasa Damansara trains ended at UPM; shuttle trains ran 16 Sierra to Putrajaya Sentral.', src: 'https://www.freemalaysiatoday.com/category/nation/2026/10/04/cable-theft-disrupts-services-on-putrajaya-mrt-line', sn: 'FMT' }
  ];

  // Active disruption comes from data/active.json (written by scripts/scrape.mjs).
  var ACTIVE = null;
  var UPDATED = null;

  var BASE = CURATED;
  var AUTO = [];
  var LINE_STATIONS = [];
  var KEY = 'pjl_extra_v1';
  var extra = [];
  try { var s = localStorage.getItem(KEY); if (s) extra = JSON.parse(s) || []; } catch (e) { extra = []; }

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function utc(d) { return new Date(d + 'T00:00:00Z'); }
  function fmt(d) { return utc(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function days(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  // Scraped records are dropped when a hand-curated one sits within a day of them.
  function autoNew() {
    return AUTO.filter(function (a) { return !CURATED.some(function (c) { return Math.abs(days(c.date, a.date)) <= 1; }); });
  }
  function all() { return BASE.concat(autoNew(), extra).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }); }
  function bar(pct, color) { return '<span class="dr-bar"><i style="width:' + pct + '%;background:' + color + '"></i></span>'; }

  function render() {
    var D = all(), N = D.length;

    // Active banner
    $('drActive').innerHTML = ACTIVE
      ? '<div class="banner warn"><strong>⚠️ ' + esc(ACTIVE.line) + ' disrupted</strong> (since ' + fmt(ACTIVE.since) + ')<br>' + esc(ACTIVE.summary) + ' <a href="' + esc(ACTIVE.src) + '" target="_blank" rel="noopener">' + esc(ACTIVE.sn) + '</a></div>'
      : '<div class="banner ok"><strong>✅ No active disruption found</strong><br>Based on the last news scan' + (UPDATED ? ' (' + new Date(UPDATED).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) + ')' : '') + '. This is not a live train feed, so check Rapid KL if in doubt.</div>';

    // Station counts
    var cnt = {}; STATIONS.forEach(function (s) { cnt[s] = 0; });
    D.forEach(function (e) { (e.stations || []).forEach(function (s) { if (cnt[s] != null) cnt[s]++; }); });
    var max = Math.max.apply(null, STATIONS.map(function (s) { return cnt[s]; })) || 1;
    var top = STATIONS.slice().sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
    $('drLead').textContent = N + ' disruptions logged from ' + fmt(D[0].date) + ' to ' + fmt(D[N - 1].date) + '. ' + top + ' is named in ' + cnt[top] + ' of them.' + (UPDATED ? ' Auto-scan last ran ' + new Date(UPDATED).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) + '.' : '');
    $('drStations').innerHTML = STATIONS.map(function (s) {
      return '<div class="dr-row"><span>' + esc(s) + '</span>' + bar(cnt[s] / max * 100, '#c8421e') + '<span class="dr-n">' + cnt[s] + '</span></div>';
    }).join('');

    // Start times
    var times = D.filter(function (e) { return e.time; }).map(function (e) { return e.time; }).sort();
    var morning = D.filter(function (e) { return !e.time && e.morning; }).length;
    var f = '';
    if (times.length) f += '<li>' + times.length + ' records have a start time, all between ' + times[0] + ' and ' + times[times.length - 1] + ', around first service.</li>';
    if (morning) f += '<li>' + morning + ' more were reported only as "this morning".</li>';
    $('drTimes').innerHTML = f;

    // Causes
    var cc = {}; Object.keys(CAUSES).forEach(function (k) { cc[k] = 0; });
    D.forEach(function (e) { cc[e.cause] = (cc[e.cause] || 0) + 1; });
    var cm = Math.max.apply(null, Object.keys(cc).map(function (k) { return cc[k]; })) || 1;
    $('drCauses').innerHTML = Object.keys(CAUSES).filter(function (k) { return cc[k] > 0; }).sort(function (a, b) { return cc[b] - cc[a]; }).map(function (k) {
      return '<div class="dr-row"><span>' + CAUSES[k].n + '</span>' + bar(cc[k] / cm * 100, CAUSES[k].c) + '<span class="dr-n">' + cc[k] + '</span></div>';
    }).join('');

    // Gaps and base-rate outlook
    var gaps = []; for (var i = 1; i < N; i++) gaps.push(days(D[i - 1].date, D[i].date));
    if (gaps.length < 3) {
      $('drOutlook').innerHTML = '<p class="dr-sub">Add at least four incidents to estimate this.</p>';
    } else {
      var mean = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
      var mn = Math.min.apply(null, gaps), mx = Math.max.apply(null, gaps);
      var p = function (hz, g) { return 1 - Math.exp(-hz / g); };
      $('drOutlook').innerHTML =
        '<p class="dr-sub">Gaps between incidents: ' + gaps.join(', ') + ' days (average ' + Math.round(mean) + '). A plain base rate that treats incidents as random and independent; the record is incomplete, so the real chance is likely higher.</p>' +
        [7, 30, 60, 90].map(function (hz) {
          return '<div class="dr-row dr-out"><span>Next ' + hz + ' days</span>' + bar(p(hz, mean) * 100, '#c8421e') + '<span class="dr-n">' + Math.round(p(hz, mean) * 100) + '% <small>(' + Math.round(p(hz, mx) * 100) + '–' + Math.round(p(hz, mn) * 100) + ')</small></span></div>';
        }).join('');
    }

    // Log
    $('drLog').innerHTML = D.slice().reverse().map(function (e) {
      var c = CAUSES[e.cause] || CAUSES.unknown;
      var when = e.time ? ' at ' + e.time : (e.morning ? ' in the morning' : '');
      return '<div class="dr-log"><div><strong>' + fmt(e.date) + esc(when) + '</strong> <span class="dr-tag" style="background:' + c.c + '">' + c.n + '</span></div>' +
        '<div class="dr-title">' + esc(e.title) + '</div><div class="dr-note">' + esc(e.note) + '</div>' +
        (e.src ? '<a class="dr-note" href="' + esc(e.src) + '" target="_blank" rel="noopener">' + esc(e.sn || 'Source') + '</a>' + (e.auto ? ' <span class="dr-note" style="display:inline">· auto-detected</span>' : '') : '<div class="dr-note">Added by you</div>') + '</div>';
    }).join('');

    document.dispatchEvent(new Event('jagamrt:incidents'));
    $('drCsv').value = ['date,time,cause,stations,title'].concat(D.map(function (e) {
      return [e.date, e.time || '', e.cause, '"' + (e.stations || []).join('; ') + '"', '"' + String(e.title).replace(/"/g, '""') + '"'].join(',');
    })).join('\n');
  }

  // Warning text for a destination, or null when its line is not flagged.
  // Exact names only (case-insensitive), so partial typing never warns.
  function warningFor(stationName) {
    var name = String(stationName || '').trim().toLowerCase();
    if (!ACTIVE || !name) return null;
    var key = STATIONS.concat(LINE_STATIONS).filter(function (s) { return s.toLowerCase() === name; })[0];
    if (!key) return null;
    var near = (ACTIVE.stations || []).some(function (x) { return x.toLowerCase() === key.toLowerCase(); });
    return { line: ACTIVE.line, atFault: near, summary: ACTIVE.summary, src: ACTIVE.src, sn: ACTIVE.sn, since: ACTIVE.since };
  }

  function init() {
    // station form
    $('drStationPick').innerHTML = STATIONS.map(function (s) { return '<label class="dr-chip"><input type="checkbox" value="' + esc(s) + '"> ' + esc(s) + '</label>'; }).join('');
    $('drDate').value = new Date().toISOString().slice(0, 10);
    $('drAdd').onclick = function () {
      var d = $('drDate').value; if (!d) { $('drDate').focus(); return; }
      var st = [].slice.call(document.querySelectorAll('#drStationPick input:checked')).map(function (x) { return x.value; });
      var cause = $('drCause').value;
      extra.push({ id: 'x' + Date.now(), date: d, time: $('drTime').value || null, cause: cause, stations: st, title: CAUSES[cause].n + (st.length ? ' near ' + st[0] : ''), note: $('drNote').value.trim() || 'Added manually.' });
      try { localStorage.setItem(KEY, JSON.stringify(extra)); } catch (e) {}
      $('drNote').value = '';
      [].forEach.call(document.querySelectorAll('#drStationPick input'), function (x) { x.checked = false; });
      render();
    };
    $('drCsvBtn').onclick = function () { $('drCsv').classList.toggle('hidden'); };
    $('drReset').onclick = function () { extra = []; try { localStorage.removeItem(KEY); } catch (e) {} render(); };
    render();
    loadScraped();
  }

  // Scraper output is optional: the page works from CURATED alone if these fail.
  function loadScraped() {
    var get = function (u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }); };
    Promise.all([get('data/incidents.json').catch(function () { return null; }), get('data/active.json').catch(function () { return null; })]).then(function (r) {
      if (r[0]) { AUTO = (r[0].incidents || []).filter(function (i) { return i && i.date && i.cause; }); UPDATED = r[0].updated || null; }
      if (r[1] && r[1].active) {
        ACTIVE = r[1].active;
        // Prefer the hand-written summary when a curated record covers the same day.
        var cur = CURATED.filter(function (c) { return c.date === ACTIVE.since; })[0];
        if (cur) { ACTIVE.summary = cur.note; ACTIVE.stations = cur.stations; ACTIVE.src = cur.src; ACTIVE.sn = cur.sn; }
      }
      render();
    });
  }

  window.JagaDisruption = {
    active: function () { return ACTIVE; },
    incidents: function () { return all(); },
    warningFor: warningFor,
    updated: function () { return UPDATED; },
    setLineStations: function (line, names) { if (/^PYL$/.test(line)) { LINE_STATIONS = names || []; } }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
