// Ridership panel on the Status screen: daily Putrajaya Line riders (data.gov.my) and incident-day comparison.
(function () {
  var R = null;
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- Disruptions tab: ridership ----------
  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); var n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
  function render() {
    var box = $('drRidership'); if (!box || !R) return;
    var S = R.series.filter(function (r) { return r.mrt_pjy != null; });
    if (!S.length) { box.innerHTML = '<p class="dr-sub">No ridership data.</p>'; return; }
    var idx = {}; S.forEach(function (r, i) { idx[r.d] = i; });
    var recent = S.slice(-56), max = Math.max.apply(null, recent.map(function (r) { return r.mrt_pjy; }));
    var bars = recent.map(function (r) {
      return '<i title="' + r.d + ': ' + r.mrt_pjy.toLocaleString('en-GB') + ' riders" style="flex:1;min-width:2px;background:var(--brand);height:' + Math.max(2, r.mrt_pjy / max * 100) + '%"></i>';
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
        S[i].mrt_pjy.toLocaleString('en-GB') + ' riders <small class="dr-sub">vs ' + Math.round(m).toLocaleString('en-GB') + ' typical</small></span><span class="dr-n" style="width:auto;color:' + (pct < -5 ? 'var(--bad)' : 'var(--muted)') + '">' + (pct > 0 ? '+' : '') + pct.toFixed(0) + '%</span></div>');
    });
    box.innerHTML = '<p class="dr-sub">Putrajaya Line daily riders, last 56 days of published data (to ' + esc(last.d) + '). Prasarana publishes with a lag of several weeks, so recent incidents have no figure yet.</p>' +
      '<div style="display:flex;align-items:flex-end;gap:1px;height:70px;margin:8px 0">' + bars + '</div>' +
      (rows.length ? '<p class="dr-sub" style="margin-top:14px">Ridership on incident days vs the median of the previous four same weekdays:</p>' + rows.join('') +
        '<p class="dr-sub">Holidays, weather and other events move ridership too, so a dip is a hint, not proof.</p>' : '') +
      '<p class="dr-sub">Source: ' + esc(R.source) + '.</p>';
  }


  function init() {
    document.addEventListener('jagamrt:incidents', render);
    fetch('data/ridership.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) { R = j; render(); })
      .catch(function () { var b = $('drRidership'); if (b) b.innerHTML = '<p class="dr-sub">Ridership data is unavailable right now.</p>'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
