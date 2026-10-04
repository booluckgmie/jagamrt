// Open-data features: station finder, scheduled headways and ridership, from data/*.json
// (built by scripts/build-open-data.mjs from data.gov.my GTFS Static + catalogue).
(function () {
  var D = { stations: null, headways: null, ridership: null };
  var lineFilter = 'ALL';
  var NAME_KEEP = /^(UPM|KL|KLCC|LRT|MRT|USJ\d*|KTM|PWTC|TBS|IOI|UKM|UIA|SS\d+|BRT|PJ|UTM|KLIA)$/;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pretty(n) { return String(n).split(/(\s+|-|\/)/).map(function (w) { return NAME_KEEP.test(w) || !/[A-Z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase(); }).join(''); }
  function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }); }

  function dist(a, b, c, d) {
    var R = 6371000, rad = Math.PI / 180, dLat = (c - a) * rad, dLon = (d - b) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km'; }

  // Station lookup: name (upper) -> [{line, station}]
  function lookup(name) {
    var q = String(name || '').trim().toUpperCase(), hits = [];
    if (!q || !D.stations) return hits;
    D.stations.lines.forEach(function (l) { l.stations.forEach(function (s) { if (s.name.toUpperCase() === q) hits.push({ line: l, station: s }); }); });
    return hits;
  }

  // Scheduled headway right now (Malaysia time), from GTFS frequencies.
  function headwayNow(lineId) {
    var H = D.headways && D.headways.lines[lineId];
    if (!H) return null;
    var t = new Date(Date.now() + 8 * 3600e3), dow = t.getUTCDay();
    var mode = dow === 0 ? 'Sun' : dow === 6 ? 'Sat' : 'MonFri', now = t.getUTCHours() * 60 + t.getUTCMinutes();
    var w = (H[mode] || []).filter(function (x) { return now >= x[0] && now < x[1]; }).map(function (x) { return x[2] / 60; });
    if (!w.length) return 'outside scheduled service hours';
    var lo = Math.round(Math.min.apply(null, w)), hi = Math.round(Math.max.apply(null, w));
    return 'scheduled every ' + (lo === hi ? lo : lo + '–' + hi) + ' min now';
  }

  function activeLineId() {
    var a = window.JagaDisruption && window.JagaDisruption.active();
    return a && /putrajaya/i.test(a.line) ? 'PYL' : null;
  }

  function badges(lines) {
    return lines.map(function (l) { return '<span class="od-line" style="background:' + esc(l.color) + (/^#?(FFCD00|ffcd00)$/.test(l.color) ? ';color:#1f2937' : '') + '">' + esc(l.id) + '</span>'; }).join('');
  }

  // ---------- Stations tab ----------
  function renderStations() {
    var box = $('stationsList');
    if (!D.stations) { if (window.loadDefaultStations) window.loadDefaultStations(); return; }
    if (!$('odSearch')) {
      box.innerHTML = '<input type="search" id="odSearch" placeholder="Search ' + D.stations.lines.reduce(function (n, l) { return n + l.stations.length; }, 0) + ' stations" style="margin-bottom:10px">' +
        '<div id="odChips" style="margin-bottom:10px"></div><div id="odList"></div>' +
        '<p class="dr-sub" style="margin-top:10px">Source: ' + esc(D.stations.source) + ', updated ' + esc(D.stations.updated.slice(0, 10)) + '.</p>';
      $('odSearch').addEventListener('input', drawList);
      $('odChips').addEventListener('click', function (e) {
        var b = e.target.closest('[data-line]'); if (!b) return;
        lineFilter = b.getAttribute('data-line'); drawChips(); drawList();
      });
    }
    drawChips(); drawList();
  }
  function drawChips() {
    $('odChips').innerHTML = [{ id: 'ALL', name: 'All lines' }].concat(D.stations.lines).map(function (l) {
      return '<button type="button" class="dr-chip" data-line="' + esc(l.id) + '" style="cursor:pointer;' + (l.id === lineFilter ? 'background:#eff6ff;border-color:#2563eb;color:#2563eb' : 'background:#fff') + '" title="' + esc(l.name || '') + '">' + esc(l.id === 'ALL' ? 'All' : l.id) + '</button>';
    }).join('');
  }
  function drawList() {
    var q = $('odSearch').value.trim().toUpperCase(), seen = {}, rows = [];
    D.stations.lines.forEach(function (l) {
      if (lineFilter !== 'ALL' && l.id !== lineFilter) return;
      l.stations.forEach(function (s) {
        if (q && s.name.toUpperCase().indexOf(q) === -1) return;
        var k = s.name + '|' + s.lat.toFixed(3) + '|' + s.lng.toFixed(3);
        if (seen[k]) { seen[k].lines.push(l); return; }
        rows.push(seen[k] = { s: s, lines: [l] });
      });
    });
    var more = rows.length > 60;
    $('odList').innerHTML = rows.slice(0, 60).map(function (r) {
      return '<div class="station-item"><div><div class="station-name">' + badges(r.lines) + ' ' + esc(pretty(r.s.name)) + '</div><div class="station-coords">' + r.s.lat.toFixed(4) + ', ' + r.s.lng.toFixed(4) + '</div></div>' +
        '<button class="btn btn-small btn-primary od-pick" style="width:auto" data-name="' + esc(pretty(r.s.name)) + '" data-lat="' + r.s.lat + '" data-lng="' + r.s.lng + '">Select</button></div>';
    }).join('') + (more ? '<p class="dr-sub">Showing 60 of ' + rows.length + '. Type to narrow the list.</p>' : '') + (rows.length ? '' : '<p class="dr-sub">No station matches.</p>');
  }
  function pick(btn) {
    if (typeof window.selectStation === 'function') window.selectStation(btn.getAttribute('data-name'), +btn.getAttribute('data-lat'), +btn.getAttribute('data-lng'));
    destInfo();
  }

  // ---------- Setup tab: line + scheduled headway for the chosen destination ----------
  function destInfo() {
    var box = $('odInfo'), hits = lookup($('stationName').value);
    if (!box) return;
    if (!hits.length) { box.className = 'hidden'; box.innerHTML = ''; return; }
    box.className = 'info-box'; box.style.marginBottom = '16px';
    box.innerHTML = hits.map(function (h) {
      return badges([h.line]) + ' <strong>' + esc(h.line.name) + '</strong>: ' + esc(headwayNow(h.line.id) || 'no schedule') + '.';
    }).join('<br>') + '<br><span style="opacity:.8">Timetable data, not live positions.</span>';
  }

  // ---------- Tracking tab: nearest stations ----------
  function nearby() {
    var out = $('odNearOut'), btn = $('odNearBtn');
    if (!navigator.geolocation) { out.innerHTML = '<p class="dr-sub">This browser has no location support.</p>'; return; }
    btn.disabled = true; out.innerHTML = '<p class="dr-sub"><span class="loader"></span> Getting your location…</p>';
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false;
      var la = pos.coords.latitude, lo = pos.coords.longitude, seen = {}, rows = [];
      D.stations.lines.forEach(function (l) {
        l.stations.forEach(function (s) {
          var k = s.name + '|' + s.lat.toFixed(3);
          if (seen[k]) { seen[k].lines.push(l); return; }
          rows.push(seen[k] = { s: s, lines: [l], d: dist(la, lo, s.lat, s.lng) });
        });
      });
      rows.sort(function (a, b) { return a.d - b.d; });
      var bad = activeLineId();
      out.innerHTML = rows.slice(0, 5).map(function (r) {
        var flagged = bad && r.lines.some(function (l) { return l.id === bad; });
        return '<div class="station-item"><div><div class="station-name">' + badges(r.lines) + ' ' + esc(pretty(r.s.name)) + '</div>' +
          '<div class="station-coords">' + fmtDist(r.d) + ' away · ' + esc(headwayNow(r.lines[0].id) || '') + '</div>' +
          (flagged ? '<div class="station-coords" style="color:#92400e">⚠️ Putrajaya Line disrupted, check Disruptions tab</div>' : '') + '</div>' +
          '<button class="btn btn-small btn-primary od-pick" style="width:auto" data-name="' + esc(pretty(r.s.name)) + '" data-lat="' + r.s.lat + '" data-lng="' + r.s.lng + '">Set</button></div>';
      }).join('') + '<p class="dr-sub">Location accuracy ±' + Math.round(pos.coords.accuracy) + ' m.</p>';
    }, function (err) {
      btn.disabled = false;
      out.innerHTML = '<p class="dr-sub">Could not get your location (' + esc(err.message || 'denied') + '). Allow location access and try again.</p>';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  // ---------- Disruptions tab: ridership ----------
  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); var n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
  function renderRidership() {
    var box = $('drRidership'); if (!box || !D.ridership) return;
    var S = D.ridership.series.filter(function (r) { return r.mrt_pjy != null; });
    if (!S.length) { box.innerHTML = '<p class="dr-sub">No ridership data.</p>'; return; }
    var idx = {}; S.forEach(function (r, i) { idx[r.d] = i; });
    var recent = S.slice(-56), max = Math.max.apply(null, recent.map(function (r) { return r.mrt_pjy; }));
    var bars = recent.map(function (r) {
      return '<i title="' + r.d + ': ' + r.mrt_pjy.toLocaleString('en-GB') + ' riders" style="flex:1;min-width:2px;background:#2563eb;height:' + Math.max(2, r.mrt_pjy / max * 100) + '%"></i>';
    }).join('');
    var last = S[S.length - 1], inc = (window.JagaDisruption ? window.JagaDisruption.incidents() : []), rows = [];
    inc.forEach(function (e) {
      var i = idx[e.date]; if (i == null) return;
      var base = [];
      for (var k = i - 1; k >= 0 && base.length < 4; k--) {
        if (new Date(S[k].d + 'T00:00:00Z').getUTCDay() === new Date(e.date + 'T00:00:00Z').getUTCDay()) base.push(S[k].mrt_pjy);
      }
      if (base.length < 3) return;
      var m = median(base), pct = (S[i].mrt_pjy - m) / m * 100;
      rows.push('<div class="dr-row" style="grid-template-columns:100px 1fr 70px"><span>' + esc(new Date(e.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })) + '</span><span>' +
        S[i].mrt_pjy.toLocaleString('en-GB') + ' riders <small class="dr-sub">vs ' + Math.round(m).toLocaleString('en-GB') + ' typical</small></span><span class="dr-n" style="width:auto;color:' + (pct < -5 ? '#c8421e' : '#6b7280') + '">' + (pct > 0 ? '+' : '') + pct.toFixed(0) + '%</span></div>');
    });
    box.innerHTML = '<p class="dr-sub">Putrajaya Line daily riders, last 56 days of published data (to ' + esc(last.d) + '). Prasarana publishes with a lag of several weeks, so recent incidents have no figure yet.</p>' +
      '<div style="display:flex;align-items:flex-end;gap:1px;height:70px;margin:8px 0">' + bars + '</div>' +
      (rows.length ? '<p class="dr-sub" style="margin-top:14px">Ridership on incident days vs the median of the previous four same weekdays:</p>' + rows.join('') +
        '<p class="dr-sub">Holidays, weather and other events move ridership too, so a dip is a hint, not proof.</p>' : '') +
      '<p class="dr-sub">Source: ' + esc(D.ridership.source) + '.</p>';
  }

  function init() {
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.od-pick'); if (b) pick(b); });
    var nb = $('odNearBtn'); if (nb) nb.onclick = nearby;
    window.renderStations = renderStations;
    var sn = $('stationName'); if (sn) sn.addEventListener('input', destInfo);
    document.addEventListener('jagamrt:incidents', renderRidership);
    Promise.all(['stations', 'headways', 'ridership'].map(function (k) { return get('data/' + k + '.json').catch(function () { return null; }); })).then(function (r) {
      D.stations = r[0]; D.headways = r[1]; D.ridership = r[2];
      if (D.stations) {
        renderStations();
        if (window.JagaDisruption) window.JagaDisruption.setLineStations('PYL', (D.stations.lines.filter(function (l) { return l.id === 'PYL'; })[0] || { stations: [] }).stations.map(function (s) { return s.name; }));
        if ($('odNearBtn')) $('odNearBtn').disabled = false;
      } else if ($('odNearOut')) $('odNearOut').innerHTML = '<p class="dr-sub">Station data is unavailable right now.</p>';
      destInfo(); renderRidership();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
