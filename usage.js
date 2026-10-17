// Site usage panel on the Status screen: Vercel Web Analytics served through /api/analytics.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('en-GB'); }

  var REASONS = {
    no_token: "Vercel hasn't been given a key to read this project's analytics yet.",
    no_project: "This deployment doesn't know which Vercel project to read analytics from.",
    api_error: "Vercel's analytics API didn't answer just now.",
    unreachable: "The analytics endpoint isn't reachable from here — likely because this copy of the site isn't running on Vercel."
  };
  var SETUP = 'Turn on Web Analytics for this project in the Vercel dashboard (Analytics tab → Enable), then add ' +
    'VERCEL_ANALYTICS_TOKEN (a Vercel access token that can read this project) and redeploy.';

  function bar(pct, color) { return '<span class="dr-bar"><i style="width:' + pct + '%;background:' + color + '"></i></span>'; }

  function rankList(title, rows) {
    if (!rows || !rows.length) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return r.views; })) || 1;
    return '<p class="dr-sub" style="margin-top:12px">' + esc(title) + '</p>' +
      rows.slice(0, 5).map(function (r) {
        return '<div class="dr-row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.key) + '</span>' +
          bar(r.views / max * 100, '#2563eb') + '<span class="dr-n">' + fmt(r.views) + '</span></div>';
      }).join('');
  }

  function dailyChart(daily) {
    if (!daily || !daily.length) return '';
    var max = Math.max.apply(null, daily.map(function (r) { return r.views; })) || 1;
    var bars = daily.map(function (r) {
      return '<i title="' + esc(r.key) + ': ' + fmt(r.views) + ' views" style="flex:1;min-width:2px;background:var(--brand);height:' + Math.max(2, r.views / max * 100) + '%"></i>';
    }).join('');
    return '<div style="display:flex;align-items:flex-end;gap:1px;height:70px;margin:8px 0">' + bars + '</div>';
  }

  function render(j) {
    var box = $('drUsage'); if (!box) return;
    if (!j || j.connected === false) {
      var reason = (j && j.reason) || 'unreachable';
      box.innerHTML = '<div class="banner warn">' + esc(REASONS[reason] || REASONS.unreachable) +
        (j && j.detail ? ' (' + esc(j.detail) + ')' : '') + '</div>' +
        '<p class="dr-sub" style="margin-top:10px">' + esc(SETUP) + '</p>';
      return;
    }
    box.innerHTML =
      '<div class="usage-stats"><div class="usage-stat"><b>' + fmt(j.totals.views) + '</b><span>page views</span></div>' +
      '<div class="usage-stat"><b>' + fmt(j.totals.visitors) + '</b><span>visitors</span></div></div>' +
      dailyChart(j.daily) +
      rankList('Top pages', j.pages) +
      rankList('Top countries', j.countries) +
      rankList('Devices', j.devices) +
      rankList('Referrers', j.referrers) +
      '<p class="dr-sub" style="margin-top:12px">Last ' + (j.days || 30) + ' days (' + esc(j.since || '') + ' → ' + esc(j.until || '') + '), from Vercel Web Analytics.</p>';
  }

  function init() {
    var box = $('drUsage'); if (!box) return;
    fetch('/api/analytics').then(function (r) {
      return r.json().catch(function () { return { connected: false, reason: 'unreachable' }; });
    }).then(render).catch(function () { render({ connected: false, reason: 'unreachable' }); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
