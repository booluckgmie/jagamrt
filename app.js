// JAGAMRT app: trip flow (pick -> check -> alarm), station browser, door-side info.
// Data: data/stations.json, headways.json, doors.json (built by scripts/); disruption state from disruptions.js.
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var KEEP = /^(UPM|KL|KLCC|LRT|MRT|USJ\d*|KTM|PWTC|TBS|IOI|UKM|UIA|SS\d+|BRT|PJ|UTM|KLIA)$/;
  var pretty = function (n) { return String(n).split(/(\s+|-|\/)/).map(function (w) { return KEEP.test(w) || !/[A-Z]/.test(w) || /[a-z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase(); }).join(''); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function dist(a, b, c, d) {
    var R = 6371000, r = Math.PI / 180, dLat = (c - a) * r, dLon = (d - b) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  var fmtDist = function (m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km'; };
  var clean = function (n) { return String(n).replace(/\s+-\s+.*$/, ''); };   // drop sponsor suffixes ("- UOB", "- REDONE")
  var RADII = [300, 500, 1000, 2000];

  /* ---------- state ---------- */
  var DATA = { stations: null, headways: null, doors: null };
  var STATIONS = [];                       // merged by name; interchanges list several lines
  var settings = Object.assign({ radius: 500, sound: true, vibrate: true, volume: 80, wake: true }, store.get('jagamrt_settings', {}));
  var trip = store.get('jagamrt_trip', null);   // { name, lat, lng, lineId, dir }
  var recents = store.get('jagamrt_recents', []);
  var myDoors = store.get('jagamrt_doors_v1', {});
  var track = null;                        // live tracking session
  var tab = 'trip', lineFilter = 'ALL', sheetStation = null, map = null, audio = null, alarmTimer = null, wakeLock = null;

  /* ---------- data ---------- */
  function buildStations() {
    STATIONS = [];
    if (!DATA.stations) return;
    DATA.stations.lines.forEach(function (line) {
      line.stations.forEach(function (s) {
        s = Object.assign({}, s, { name: clean(s.name) });
        var hit = STATIONS.filter(function (x) { return x.upper === s.name.toUpperCase() && dist(x.lat, x.lng, s.lat, s.lng) < 600; })[0];
        if (hit) { if (hit.lines.indexOf(line) === -1) hit.lines.push(line); }
        else STATIONS.push({ name: pretty(s.name), upper: s.name.toUpperCase(), lat: s.lat, lng: s.lng, lines: [line] });
      });
    });
  }
  var lineById = function (id) { return DATA.stations && DATA.stations.lines.filter(function (l) { return l.id === id; })[0]; };
  var stationByName = function (n) { n = String(n || '').toUpperCase(); return STATIONS.filter(function (s) { return s.upper === n; })[0]; };
  function terminal(line, dir) { var st = line.stations; return pretty(clean(st[dir === 'A' ? st.length - 1 : 0].name)); }
  // Direction A heads toward the last station in the line's list, B toward the first. A terminal only has one way in.
  function dirsFor(line, upper) {
    var i = -1; line.stations.forEach(function (s, k) { if (clean(s.name).toUpperCase() === upper) i = k; });
    if (i === line.stations.length - 1) return ['A'];
    if (i === 0) return ['B'];
    return ['A', 'B'];
  }
  function badge(line) { return '<span class="badge' + (/^#?ffcd00$/i.test(line.color) ? ' light' : '') + '" style="background:' + esc(line.color) + '">' + esc(line.id) + '</span>'; }
  var badges = function (lines) { return lines.map(badge).join(' '); };

  function headway(lineId) {
    var H = DATA.headways && DATA.headways.lines[lineId];
    if (!H) return null;
    var t = new Date(Date.now() + 8 * 3600e3), dow = t.getUTCDay();
    var mode = dow === 0 ? 'Sun' : dow === 6 ? 'Sat' : 'MonFri', now = t.getUTCHours() * 60 + t.getUTCMinutes();
    var w = (H[mode] || []).filter(function (x) { return now >= x[0] && now < x[1]; }).map(function (x) { return x[2] / 60; });
    if (!w.length) return 'Outside scheduled service hours';
    var lo = Math.round(Math.min.apply(null, w)), hi = Math.round(Math.max.apply(null, w));
    return 'Trains scheduled every ' + (lo === hi ? lo : lo + '–' + hi) + ' min right now';
  }

  /* ---------- door side ---------- */
  var SIDE = { L: ['◀', 'left'], R: ['▶', 'right'], B: ['◀▶', 'both sides'] };
  var doorKey = function (lineId, upper, dir) { return lineId + '|' + upper + '|' + dir; };
  function doorInfo(key) {
    var shared = DATA.doors && DATA.doors.entries && DATA.doors.entries[key];
    if (shared && SIDE[shared.side]) return { side: shared.side, who: 'verified', note: shared.note };
    if (SIDE[myDoors[key]]) return { side: myDoors[key], who: 'you' };
    return null;
  }
  function doorsPanel(line, upper, dir, big, compact) {
    var key = doorKey(line.id, upper, dir), info = doorInfo(key), head;
    if (info) {
      head = '<div class="doors' + (big ? ' big' : '') + '"><div class="arrow" aria-hidden="true">' + SIDE[info.side][0] + '</div><div><div class="t">Doors open on the ' + SIDE[info.side][1] + '</div>' +
        '<div class="s">' + (info.who === 'verified' ? 'Verified' : 'Saved by you on this device') + ' · as you face the front of the train</div></div></div>';
    } else {
      head = '<div class="doors unknown' + (compact ? ' compact' : '') + '"><div class="arrow" aria-hidden="true">?</div><div><div class="t">Door side not confirmed yet</div>' +
        (compact ? '' : '<div class="s">No open data exists for this. After you ride, tell us which side opened:</div>') + '</div></div>';
    }
    if (big || (info && info.who === 'verified')) return head;
    var pressed = function (v) { return info && info.side === v ? ' style="border-color:var(--brand);background:var(--brand-soft);color:var(--brand)"' : ''; };
    return head + '<div class="confirm" data-key="' + esc(key) + '"><button type="button" data-door="L"' + pressed('L') + '>◀ Left</button><button type="button" data-door="R"' + pressed('R') + '>Right ▶</button><button type="button" data-door="B"' + pressed('B') + '>Both</button>' +
      (info ? '<button type="button" data-door="clear" aria-label="Clear">✕</button>' : '') + '</div>';
  }
  function saveDoor(key, v) {
    if (v === 'clear') delete myDoors[key]; else myDoors[key] = v;
    store.set('jagamrt_doors_v1', myDoors);
    refresh();
  }

  /* ---------- navigation ---------- */
  function setTab(name) {
    tab = name;
    ['trip', 'stations', 'status'].forEach(function (t) { $('screen-' + t).classList.toggle('active', t === name); });
    [].forEach.call(document.querySelectorAll('.tab'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    window.scrollTo(0, 0);
    if (name === 'trip' && map) map.invalidateSize();
  }
  function refresh() {
    if (sheetStation) renderSheet();
    if (!track) renderTrip(); else renderTrackDoors();
  }

  /* ---------- trip: pick ---------- */
  function renderTrip() {
    if (track) return renderTracking();
    if (trip && trip.name) return renderReady();
    renderPick();
  }
  function item(i, meta) {
    var s = STATIONS[i];
    return '<button type="button" class="item" data-st="' + i + '"><div class="main"><div class="name">' + badges(s.lines) + ' ' + esc(s.name) + '</div><div class="meta">' + esc(meta || s.lines.map(function (l) { return l.name; }).join(' · ')) + '</div></div><span class="go">›</span></button>';
  }
  function renderPick() {
    var rec = recents.map(function (n) { return stationByName(n); }).filter(Boolean);
    $('tripBody').innerHTML =
      '<h1 class="h1">Where are you getting off?</h1>' +
      '<input type="search" id="tripSearch" placeholder="Search a station, e.g. Taman Equine" autocomplete="off" aria-label="Destination station"' + (DATA.stations ? '' : ' disabled') + '>' +
      '<div id="tripResults" class="card hidden" style="padding:4px 14px;margin-top:10px"></div>' +
      '<div id="tripExtras" class="stack" style="margin-top:14px">' +
        (rec.length ? '<div><div class="eyebrow" style="margin-bottom:6px">Recent</div><div class="chips">' + rec.map(function (s) { return '<button type="button" class="chip" data-st="' + STATIONS.indexOf(s) + '">' + esc(s.name) + '</button>'; }).join('') + '</div></div>' : '') +
        '<button type="button" class="btn btn-ghost" id="nearBtn"' + (DATA.stations ? '' : ' disabled') + '>📍 Stations near me</button>' +
        (typeof L !== 'undefined' ? '<button type="button" class="btn btn-ghost" id="mapPickBtn">🗺️ Pick a spot on the map</button>' : '') +
        '<div id="mapWrap" class="hidden"><p class="sub">Tap the map where you want to be woken.</p><div id="map"></div></div>' +
        (DATA.stations ? '' : '<p class="banner warn">Station list could not load. You can still pick a spot on the map.</p>') +
        '<div class="card"><div class="card-title">How it works</div><ol class="steps">' +
          '<li><b>1</b><span>Pick the station where you get off.</span></li>' +
          '<li><b>2</b><span>Press <em>Start alarm</em> and keep this page open.</span></li>' +
          '<li><b>3</b><span>Rest. We ring and vibrate before you arrive, and show which side the doors open when it is known.</span></li></ol></div>' +
      '</div>';
  }
  function search(q) {
    var box = $('tripResults'), extras = $('tripExtras');
    q = q.trim().toUpperCase();
    if (!q) { box.classList.add('hidden'); extras.classList.remove('hidden'); return; }
    var hits = [];
    STATIONS.forEach(function (s, i) { var k = s.upper.indexOf(q); if (k !== -1) hits.push({ i: i, rank: k === 0 ? 0 : 1 }); });
    hits.sort(function (a, b) { return a.rank - b.rank; });
    extras.classList.add('hidden'); box.classList.remove('hidden');
    box.innerHTML = hits.length ? '<ul class="list">' + hits.slice(0, 8).map(function (h) { return '<li>' + item(h.i) + '</li>'; }).join('') + '</ul>' : '<p class="sub" style="padding:14px 0">No station matches “' + esc(q.toLowerCase()) + '”.</p>';
  }
  function nearMe() {
    var btn = $('nearBtn'), box = $('tripResults');
    if (!navigator.geolocation) { alert('This browser has no location support.'); return; }
    btn.disabled = true; btn.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(function (p) {
      var la = p.coords.latitude, lo = p.coords.longitude;
      var rows = STATIONS.map(function (s, i) { return { i: i, d: dist(la, lo, s.lat, s.lng) }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
      $('tripExtras').classList.add('hidden'); box.classList.remove('hidden');
      box.innerHTML = '<div class="eyebrow" style="padding-top:12px">Near you</div><ul class="list">' + rows.map(function (r) { return '<li>' + item(r.i, fmtDist(r.d) + ' away · ' + STATIONS[r.i].lines.map(function (l) { return l.name; }).join(' · ')) + '</li>'; }).join('') + '</ul>' +
        '<button type="button" class="link" id="nearBack">← Back</button>';
    }, function (e) {
      btn.disabled = false; btn.textContent = '📍 Stations near me';
      alert(e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : 'Could not get your location. Try again.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  function chooseStation(s, lineId) {
    var line = lineId ? lineById(lineId) : s.lines[0];
    var dirs = line ? dirsFor(line, s.upper) : [];
    trip = { name: s.name, lat: s.lat, lng: s.lng, lineId: line ? line.id : null, dir: dirs[0] || 'A' };
    store.set('jagamrt_trip', trip);
    recents = [s.name].concat(recents.filter(function (n) { return n !== s.name; })).slice(0, 5);
    store.set('jagamrt_recents', recents);
    renderTrip();
  }

  /* ---------- trip: ready ---------- */
  function warnBanner(name, compact) {
    var w = window.JagaDisruption && window.JagaDisruption.warningFor(name);
    if (!w) return '';
    return '<div class="banner warn" role="status"><strong>⚠️ ' + esc(w.line) + ' is disrupted.</strong> ' + (w.atFault ? esc(name) + ' is at the fault. ' : '') + (compact ? '' : esc(w.summary) + ' ') +
      '<a href="#" data-go="status">See status</a></div>';
  }
  function renderReady() {
    var s = stationByName(trip.name), line = trip.lineId && lineById(trip.lineId);
    var dirs = line && s ? dirsFor(line, s.upper) : [];
    if (dirs.length && dirs.indexOf(trip.dir) === -1) trip.dir = dirs[0];
    var seg = function (attr, items, cur) { return items.map(function (it) { return '<button type="button" ' + attr + '="' + esc(it[0]) + '" aria-pressed="' + (String(it[0]) === String(cur)) + '">' + it[1] + '</button>'; }).join(''); };
    var toggle = function (k, label) { return '<div class="row between"><span>' + label + '</span><div class="seg" style="flex:none;width:150px" data-set="' + k + '">' + seg('data-v', [['1', 'On'], ['0', 'Off']], settings[k] ? '1' : '0') + '</div></div>'; };
    $('tripBody').innerHTML =
      warnBanner(trip.name, true) +
      '<div class="card stack" style="margin-top:' + (warnBanner(trip.name, true) ? '12px' : '0') + '">' +
        '<div class="dest-head"><div><div class="eyebrow">Destination</div><h2>' + esc(trip.name) + '</h2>' +
          '<div class="sub">' + (line ? badge(line) + ' ' + esc(line.name) : 'Custom spot') + '</div></div><button type="button" class="link" id="changeDest">Change</button></div>' +
        (s && s.lines.length > 1 ? '<div class="field"><label>Line</label><div class="seg" id="lineSeg">' + seg('data-line', s.lines.map(function (l) { return [l.id, esc(l.id)]; }), trip.lineId) + '</div></div>' : '') +
        (line && dirs.length > 1 ? '<div class="field"><label>Travelling toward</label><div class="seg" id="dirSeg">' + seg('data-dir', dirs.map(function (d) { return [d, esc(terminal(line, d))]; }), trip.dir) + '</div></div>' : '') +
        (line ? '<div class="field"><label>Door side</label>' + doorsPanel(line, s.upper, trip.dir, false) + '</div>' : '') +
        '<div class="field"><label>Wake me when I’m within</label><div class="seg" id="radiusSeg">' + seg('data-r', RADII.map(function (r) { return [r, r < 1000 ? r + ' m' : r / 1000 + ' km']; }), settings.radius) + '</div></div>' +
        (line && headway(line.id) ? '<p class="sub">⏱ ' + esc(headway(line.id)) + '. Timetable, not live positions.</p>' : '') +
      '</div>' +
      '<div class="cta"><button type="button" class="btn btn-xl" id="startBtn">🔔 Start alarm</button></div>' +
      '<div class="card"><details><summary>Alert settings</summary>'+
        '<div class="stack" style="padding:6px 0 10px">' + toggle('sound', 'Sound') + toggle('vibrate', 'Vibration') + toggle('wake', 'Keep screen on') +
          '<div class="field"><label for="vol">Volume</label><input type="range" id="vol" min="10" max="100" value="' + settings.volume + '"></div></div>' +
        '<button type="button" class="btn btn-ghost" id="testBtn">Test the alarm</button></details></div>' +
      '<div class="card" style="margin-top:14px"><details><summary>🗺️ Show on map</summary><div id="map"></div></details></div>';
    var mapDet = $('map') && $('map').closest('details');
    if (mapDet) mapDet.addEventListener('toggle', function () { if (mapDet.open) initMap(true); });
  }

  /* ---------- map ---------- */
  function initMap(showTrip, onTap) {
    if (typeof L === 'undefined' || !$('map')) return;
    if (map) { map.remove(); map = null; }
    var c = trip && showTrip ? [trip.lat, trip.lng] : [3.139, 101.687];
    map = L.map('map').setView(c, trip && showTrip ? 15 : 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    if (trip && showTrip) {
      L.marker(c).addTo(map);
      L.circle(c, { radius: settings.radius, color: '#2563eb', fillOpacity: .12 }).addTo(map);
    }
    if (onTap) map.on('click', function (e) { onTap(e.latlng); });
    setTimeout(function () { map && map.invalidateSize(); }, 150);
  }

  /* ---------- tracking ---------- */
  function startTracking() {
    if (!navigator.geolocation) { alert('This browser has no location support.'); return; }
    primeAudio();
    if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) {} }
    track = { startDist: null, fired: false, dist: null, acc: null, error: null, id: null };
    track.id = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 });
    holdScreen();
    renderTracking();
  }
  function stopTracking() {
    if (track && track.id != null) navigator.geolocation.clearWatch(track.id);
    track = null; releaseScreen(); stopAlarm();
    renderTrip();
  }
  function onFix(p) {
    if (!track) return;
    var d = dist(p.coords.latitude, p.coords.longitude, trip.lat, trip.lng);
    track.dist = d; track.acc = p.coords.accuracy; track.error = null;
    if (track.startDist == null) track.startDist = d;
    if (d <= settings.radius && !track.fired) { track.fired = true; fireAlarm(d); }
    else if (d > settings.radius * 1.3) track.fired = false;   // re-arm if we move away again
    updateTrackUI();
  }
  function onGeoError(e) {
    if (!track) return;
    if (e.code === 1) { track.error = 'Location is blocked. Allow location for this site in your browser settings, then start again.'; var id = track.id; navigator.geolocation.clearWatch(id); track.id = null; }
    else track.error = 'Waiting for a GPS signal… this can take a moment, especially underground.';
    updateTrackUI();
  }
  function renderTracking() {
    $('tripBody').innerHTML =
      '<div class="card track"><div class="eyebrow">Alarm on</div><h2 class="h2" style="margin-top:2px">' + esc(trip.name) + '</h2>' +
        '<div class="bigdist" id="tDist" aria-live="polite">…</div><div class="sub" id="tSub">Finding your location…</div>' +
        '<div class="progress" role="progressbar" aria-label="Progress to alarm point"><i id="tBar"></i></div>' +
        '<div class="row between sub"><span>Start</span><span>Alarm at ' + (settings.radius < 1000 ? settings.radius + ' m' : settings.radius / 1000 + ' km') + '</span></div>' +
        '<div style="margin:14px 0 4px"><span class="gps" id="tGps"><b></b><span>Waiting for GPS</span></span></div>' +
        '<div id="tDoors" style="text-align:left;margin-top:12px"></div>' +
        '<div id="tWarn" style="text-align:left;margin-top:12px">' + warnBanner(trip.name, true) + '</div></div>' +
      '<button type="button" class="btn btn-danger btn-xl" id="stopBtn">Stop alarm</button>' +
      '<p class="sub" style="margin-top:12px">Keep this page open. The alarm can’t ring if the phone closes it, and GPS may drop underground.</p>';
    renderTrackDoors();
    updateTrackUI();
  }
  function renderTrackDoors() {
    var box = $('tDoors'); if (!box || !trip) return;
    var s = stationByName(trip.name), line = trip.lineId && lineById(trip.lineId);
    box.innerHTML = line && s ? doorsPanel(line, s.upper, trip.dir, !!doorInfo(doorKey(line.id, s.upper, trip.dir))) : '';
  }
  function updateTrackUI() {
    if (!track || !$('tDist')) return;
    var d = track.dist;
    if (d == null) { $('tDist').textContent = '…'; $('tSub').textContent = track.error || 'Finding your location…'; return; }
    $('tDist').textContent = fmtDist(d);
    $('tSub').textContent = track.error || (d > settings.radius ? fmtDist(d - settings.radius) + ' until the alarm' : 'You’re inside the alarm zone');
    var span = Math.max(track.startDist - settings.radius, 1), pct = d <= settings.radius ? 100 : Math.max(0, Math.min(100, (1 - (d - settings.radius) / span) * 100));
    $('tBar').style.width = pct + '%';
    var q = track.acc <= 30 ? ['good', 'Good GPS'] : track.acc <= 100 ? ['fair', 'Fair GPS'] : ['weak', 'Weak GPS'];
    $('tGps').className = 'gps ' + q[0];
    $('tGps').lastChild.textContent = q[1] + ' · ±' + Math.round(track.acc) + ' m';
  }

  /* ---------- alarm ---------- */
  function primeAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {}
  }
  function beep() {
    if (!audio || !settings.sound) return;
    try {
      [0, .35].forEach(function (off) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + off;
        o.type = 'square'; o.frequency.value = off ? 1000 : 800; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(settings.volume / 100 * .35, t); g.gain.exponentialRampToValueAtTime(.001, t + .3);
        o.start(t); o.stop(t + .3);
      });
    } catch (e) {}
  }
  function fireAlarm(d, test) {
    primeAudio();
    var s = stationByName(trip.name), line = trip.lineId && lineById(trip.lineId), info = line && s ? doorInfo(doorKey(line.id, s.upper, trip.dir)) : null;
    var el = $('alarm');
    el.innerHTML = '<div class="big" aria-hidden="true">🚆</div><h2>' + (test ? 'Test alarm' : 'Wake up!') + '</h2><p style="font-size:20px">' + esc(trip.name) + (d != null ? ' · ' + fmtDist(d) + ' away' : '') + '</p>' +
      (info ? '<div class="doorcall">' + SIDE[info.side][0] + ' Doors open on the ' + SIDE[info.side][1] + '</div>' : '') +
      '<button type="button" class="btn btn-xl" id="dismissBtn">I’m awake</button>';
    el.classList.remove('hidden');
    var pulse = function () { beep(); if (settings.vibrate && navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]); };
    pulse(); clearInterval(alarmTimer); alarmTimer = setInterval(pulse, 2500);
    if (!test) notify(d);
    $('dismissBtn').focus();
  }
  function stopAlarm() { clearInterval(alarmTimer); alarmTimer = null; $('alarm').classList.add('hidden'); if (navigator.vibrate) navigator.vibrate(0); }
  function notify(d) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: trip.name + ' · ' + fmtDist(d) + ' away', tag: 'jagamrt', requireInteraction: true, vibrate: [500, 200, 500] };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(function (r) { r.showNotification('🚆 JAGAMRT', opts); }).catch(function () { new Notification('🚆 JAGAMRT', opts); });
    else new Notification('🚆 JAGAMRT', opts);
  }
  function holdScreen() {
    if (!settings.wake || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
  }
  function releaseScreen() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && track) holdScreen(); });

  /* ---------- stations tab + sheet ---------- */
  function renderStationsTab() {
    if (!DATA.stations) { $('stList').innerHTML = '<li class="sub" style="padding:14px 0">Station data is unavailable right now.</li>'; return; }
    $('stChips').innerHTML = [{ id: 'ALL', name: 'All lines' }].concat(DATA.stations.lines).map(function (l) {
      return '<button type="button" class="chip" data-line-filter="' + esc(l.id) + '" aria-pressed="' + (l.id === lineFilter) + '">' + (l.id === 'ALL' ? 'All' : badge(l) + ' ' + esc(l.name.replace(/^(LRT|MRT|KL|BRT) /, ''))) + '</button>';
    }).join('');
    var q = $('stSearch').value.trim().toUpperCase(), rows = [];
    STATIONS.forEach(function (s, i) {
      if (lineFilter !== 'ALL' && !s.lines.some(function (l) { return l.id === lineFilter; })) return;
      if (q && s.upper.indexOf(q) === -1) return;
      rows.push(i);
    });
    $('stList').innerHTML = rows.slice(0, 80).map(function (i) { return '<li>' + item(i) + '</li>'; }).join('') +
      (rows.length > 80 ? '<li class="sub" style="padding:12px 0">Showing 80 of ' + rows.length + '. Type to narrow the list.</li>' : '') +
      (rows.length ? '' : '<li class="sub" style="padding:14px 0">No station matches.</li>');
    var n = Object.keys(myDoors).length;
    $('stSource').innerHTML = esc(DATA.stations.source) + ', updated ' + esc(DATA.stations.updated.slice(0, 10)) + '.' +
      '<br>Door-side reports saved on this device: <b>' + n + '</b>' + (n ? ' · <a href="#" id="copyDoors">Copy to share</a>' : '') + '.';
  }
  function openSheet(i) { sheetStation = i; renderSheet(); }
  function closeSheet() { sheetStation = null; $('sheetRoot').innerHTML = ''; }
  function renderSheet() {
    var s = STATIONS[sheetStation]; if (!s) return closeSheet();
    $('sheetRoot').innerHTML = '<div class="scrim" id="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(s.name) + '"><div class="grab"></div>' +
      '<div class="row between"><div><h2 class="h2">' + esc(s.name) + '</h2><div class="sub">' + s.lat.toFixed(4) + ', ' + s.lng.toFixed(4) + '</div></div><button type="button" class="link" id="closeSheet">Close</button></div>' +
      s.lines.map(function (l) {
        return '<div class="card stack" style="box-shadow:none;border:1px solid var(--line);margin-top:12px"><div>' + badge(l) + ' <b>' + esc(l.name) + '</b>' + (headway(l.id) ? '<div class="sub">' + esc(headway(l.id)) + '</div>' : '') + '</div>' +
          dirsFor(l, s.upper).map(function (d) { return '<div><div class="eyebrow" style="margin-bottom:6px">Toward ' + esc(terminal(l, d)) + '</div>' + doorsPanel(l, s.upper, d, false, true) + '</div>'; }).join('') +
          '<button type="button" class="btn btn-ghost" data-dest="' + sheetStation + '" data-dest-line="' + esc(l.id) + '">Set as my destination</button></div>';
      }).join('') + '</div>';
  }

  /* ---------- status chrome ---------- */
  function updateStatusUI() {
    var a = window.JagaDisruption && window.JagaDisruption.active();
    var pill = $('statusPill');
    pill.classList.toggle('hidden', !a);
    if (a) pill.textContent = '⚠️ Disruption';
    $('statusDot').classList.toggle('hidden', !a);
    if (!track && trip && trip.name) renderReady();   // refresh the destination warning
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var go = t.closest('[data-go]'); if (go) { e.preventDefault(); setTab(go.getAttribute('data-go')); closeSheet(); return; }
    var tabBtn = t.closest('.tab'); if (tabBtn) { setTab(tabBtn.getAttribute('data-tab')); return; }
    if (t.closest('#statusPill')) { setTab('status'); return; }
    var st = t.closest('[data-st]');
    if (st) { var i = +st.getAttribute('data-st'); if (tab === 'stations') openSheet(i); else chooseStation(STATIONS[i]); return; }
    var dest = t.closest('[data-dest]'); if (dest) { chooseStation(STATIONS[+dest.getAttribute('data-dest')], dest.getAttribute('data-dest-line')); closeSheet(); setTab('trip'); return; }
    var door = t.closest('[data-door]'); if (door) { saveDoor(door.closest('.confirm').getAttribute('data-key'), door.getAttribute('data-door')); return; }
    var lf = t.closest('[data-line-filter]'); if (lf) { lineFilter = lf.getAttribute('data-line-filter'); renderStationsTab(); return; }
    if (t.closest('#scrim') || t.closest('#closeSheet')) { closeSheet(); return; }
    if (t.closest('#copyDoors')) { e.preventDefault(); copyDoors(); return; }
    if (t.closest('#nearBtn')) { nearMe(); return; }
    if (t.closest('#nearBack')) { renderPick(); return; }
    if (t.closest('#mapPickBtn')) {
      var w = $('mapWrap'); w.classList.toggle('hidden');
      if (!w.classList.contains('hidden')) initMap(false, function (ll) {
        trip = { name: 'Map pin', lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5), lineId: null, dir: 'A' };
        store.set('jagamrt_trip', trip); renderTrip();
      });
      return;
    }
    if (t.closest('#changeDest')) { trip = null; store.set('jagamrt_trip', null); renderPick(); return; }
    var ln = t.closest('[data-line]'); if (ln && ln.closest('#lineSeg')) { var s2 = stationByName(trip.name), l2 = lineById(ln.getAttribute('data-line')); trip.lineId = l2.id; trip.dir = dirsFor(l2, s2.upper)[0]; store.set('jagamrt_trip', trip); renderReady(); return; }
    var dr = t.closest('[data-dir]'); if (dr && dr.closest('#dirSeg')) { trip.dir = dr.getAttribute('data-dir'); store.set('jagamrt_trip', trip); renderReady(); return; }
    var rr = t.closest('[data-r]'); if (rr) { settings.radius = +rr.getAttribute('data-r'); store.set('jagamrt_settings', settings); renderReady(); return; }
    var sv = t.closest('[data-set] [data-v]'); if (sv) { settings[sv.closest('[data-set]').getAttribute('data-set')] = sv.getAttribute('data-v') === '1'; store.set('jagamrt_settings', settings); renderReady(); var det = $('tripBody').querySelector('details'); if (det) det.open = true; return; }
    if (t.closest('#startBtn')) { startTracking(); return; }
    if (t.closest('#stopBtn')) { stopTracking(); return; }
    if (t.closest('#testBtn')) { fireAlarm(settings.radius, true); return; }
    if (t.closest('#dismissBtn')) { stopAlarm(); return; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'tripSearch') search(e.target.value);
    else if (e.target.id === 'stSearch') renderStationsTab();
    else if (e.target.id === 'vol') { settings.volume = +e.target.value; store.set('jagamrt_settings', settings); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); } });
  document.addEventListener('jagamrt:incidents', updateStatusUI);

  function copyDoors() {
    var out = { note: 'JAGAMRT door-side reports. Key = LINE|STATION|DIRECTION (A = toward last station of the line, B = toward first). L/R = side as you face the front of the train.', entries: myDoors };
    var text = JSON.stringify(out, null, 2);
    var done = function () { var a = $('copyDoors'); if (a) a.textContent = 'Copied ✓'; };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this:', text); });
    else window.prompt('Copy this:', text);
  }

  /* ---------- boot ---------- */
  function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }); }
  function boot() {
    renderTrip(); updateStatusUI();
    Promise.all(['stations', 'headways', 'doors'].map(function (k) { return get('data/' + k + '.json').catch(function () { return null; }); })).then(function (r) {
      DATA.stations = r[0]; DATA.headways = r[1]; DATA.doors = r[2];
      buildStations();
      if (DATA.stations && window.JagaDisruption) {
        var pyl = lineById('PYL');
        if (pyl) window.JagaDisruption.setLineStations('PYL', pyl.stations.map(function (s) { return pretty(clean(s.name)); }));
      }
      renderStationsTab();
      if (!track) renderTrip();
    });
  }
  window.addEventListener('beforeunload', function (e) { if (track) { e.preventDefault(); e.returnValue = ''; } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
