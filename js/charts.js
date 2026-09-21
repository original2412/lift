/* global window */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const U = App.utils;

  const W = 320, H = 150, PAD_L = 4, PAD_R = 4, PAD_T = 14, PAD_B = 18;

  // Keep the aspect ratio: preserveAspectRatio="none" stretched the axis text.
  function svgOpen() {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  }

  const Charts = {};

  // points: [{ t:<ms>, <valueKey>:<number> }], render as filled line chart.
  Charts.line = function (points, valueKey, fmt) {
    valueKey = valueKey || 'value';
    fmt = fmt || U.fmtNum;
    if (!points || points.length === 0) {
      return '<div class="chart center muted tiny" style="padding:24px 0">No data yet</div>';
    }
    if (points.length === 1) {
      const only = points[0];
      return '<div class="chart center" style="padding:20px 0">'
        + '<div style="font-size:22px;font-weight:800">' + fmt(only[valueKey]) + '</div>'
        + '<div class="muted tiny">' + U.fmtDate(only.t, { month: 'short', day: 'numeric' }) + ' · one session</div></div>';
    }

    const xs = points.map(function (p) { return p.t; });
    const ys = points.map(function (p) { return p[valueKey]; });
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    let minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    if (minY === maxY) { minY = minY - 1; maxY = maxY + 1; }
    const padY = (maxY - minY) * 0.12;
    minY -= padY; maxY += padY;

    const sx = function (t) { return PAD_L + (maxX === minX ? 0.5 : (t - minX) / (maxX - minX)) * (W - PAD_L - PAD_R); };
    const sy = function (v) { return PAD_T + (1 - (v - minY) / (maxY - minY)) * (H - PAD_T - PAD_B); };

    let d = '';
    points.forEach(function (p, i) {
      d += (i ? 'L' : 'M') + sx(p.t).toFixed(1) + ' ' + sy(p[valueKey]).toFixed(1) + ' ';
    });
    const area = d + 'L' + sx(maxX).toFixed(1) + ' ' + (H - PAD_B) + ' L' + sx(minX).toFixed(1) + ' ' + (H - PAD_B) + ' Z';

    let grid = '';
    for (let g = 0; g <= 2; g++) {
      const yy = (PAD_T + g * (H - PAD_T - PAD_B) / 2).toFixed(1);
      grid += '<line class="grid-line" x1="0" y1="' + yy + '" x2="' + W + '" y2="' + yy + '"/>';
    }

    const last = points[points.length - 1];
    const dots = '<circle class="dot" cx="' + sx(last.t).toFixed(1) + '" cy="' + sy(last[valueKey]).toFixed(1) + '" r="3.5"/>';

    const labels = '<text class="axis-label" x="2" y="' + (H - 4) + '">'
      + U.fmtDate(minX, { month: 'short', day: 'numeric' }) + '</text>'
      + '<text class="axis-label" x="' + (W - 2) + '" y="' + (H - 4) + '" text-anchor="end">'
      + U.fmtDate(maxX, { month: 'short', day: 'numeric' }) + '</text>';

    return '<div class="chart">' + svgOpen() + grid
      + '<path class="area" d="' + area + '"/>'
      + '<path class="line" d="' + d.trim() + '"/>'
      + dots + labels + '</svg></div>';
  };

  // bars: [{ label, value }]. The last bar (current period) is highlighted and
  // its value printed; every `labelEvery`-th bar gets an x label.
  Charts.bars = function (bars, fmt, opts) {
    fmt = fmt || U.fmtNum;
    opts = opts || {};
    if (!bars || !bars.length) return '<div class="chart center muted tiny" style="padding:24px 0">No data yet</div>';
    const max = Math.max.apply(null, bars.map(function (b) { return b.value; })) || 1;
    const n = bars.length;
    const gap = 5;
    const bw = (W - PAD_L - PAD_R - gap * (n - 1)) / n;
    const every = opts.labelEvery || Math.ceil(n / 4);
    const plotH = H - PAD_T - PAD_B;
    let out = '';
    for (let g = 0; g <= 2; g++) {
      const yy = (PAD_T + g * plotH / 2).toFixed(1);
      out += '<line class="grid-line" x1="0" y1="' + yy + '" x2="' + W + '" y2="' + yy + '"/>';
    }
    bars.forEach(function (b, i) {
      const h = b.value ? Math.max(2, (b.value / max) * plotH) : 2;
      const x = PAD_L + i * (bw + gap);
      const y = H - PAD_B - h;
      const last = i === n - 1;
      out += '<rect class="bar' + (last ? ' hl' : '') + (b.value ? '' : ' dim') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1)
        + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>'
        + U.escape(b.label + ': ' + fmt(b.value)) + '</title></rect>';
      if (last && b.value) {
        out += '<text class="bar-val" x="' + (x + bw / 2).toFixed(1) + '" y="' + Math.max(10, y - 4).toFixed(1) + '" text-anchor="middle">' + U.escape(fmt(b.value)) + '</text>';
      }
      if ((n - 1 - i) % every === 0) {
        out += '<text class="axis-label" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + U.escape(b.label) + '</text>';
      }
    });
    return '<div class="chart">' + svgOpen() + out + '</svg></div>';
  };

  App.charts = Charts;
})();
