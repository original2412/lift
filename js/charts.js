/* global window */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const U = App.utils;

  const W = 320, H = 140, PAD_L = 4, PAD_R = 4, PAD_T = 10, PAD_B = 16;

  function svgOpen() {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">';
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

    let d = '', area = '';
    points.forEach(function (p, i) {
      const x = sx(p.t).toFixed(1), y = sy(p[valueKey]).toFixed(1);
      d += (i ? 'L' : 'M') + x + ' ' + y + ' ';
    });
    area = d + 'L' + sx(maxX).toFixed(1) + ' ' + (H - PAD_B) + ' L' + sx(minX).toFixed(1) + ' ' + (H - PAD_B) + ' Z';

    let grid = '';
    for (let g = 0; g <= 2; g++) {
      const yy = (PAD_T + g * (H - PAD_T - PAD_B) / 2).toFixed(1);
      grid += '<line class="grid-line" x1="0" y1="' + yy + '" x2="' + W + '" y2="' + yy + '"/>';
    }

    const lastIdx = points.length - 1;
    const dots = '<circle class="dot" cx="' + sx(points[lastIdx].t).toFixed(1) + '" cy="'
      + sy(points[lastIdx][valueKey]).toFixed(1) + '" r="3.2"/>';

    const labels = '<text class="axis-label" x="2" y="' + (H - 4) + '">'
      + U.fmtDate(minX, { month: 'short', day: 'numeric' }) + '</text>'
      + '<text class="axis-label" x="' + (W - 2) + '" y="' + (H - 4) + '" text-anchor="end">'
      + U.fmtDate(maxX, { month: 'short', day: 'numeric' }) + '</text>'
      + '<text class="axis-label" x="2" y="' + (PAD_T + 4) + '">' + fmt(maxY) + '</text>';

    return '<div class="chart">' + svgOpen() + grid
      + '<path class="area" d="' + area + '"/>'
      + '<path class="line" d="' + d.trim() + '"/>'
      + dots + labels + '</svg></div>';
  };

  // bars: [{ label, value }]
  Charts.bars = function (bars, fmt) {
    fmt = fmt || U.fmtNum;
    if (!bars || !bars.length) return '<div class="chart center muted tiny" style="padding:24px 0">No data yet</div>';
    const max = Math.max.apply(null, bars.map(function (b) { return b.value; })) || 1;
    const n = bars.length;
    const gap = 3;
    const bw = (W - PAD_L - PAD_R - gap * (n - 1)) / n;
    let rects = '';
    bars.forEach(function (b, i) {
      const h = max ? (b.value / max) * (H - PAD_T - PAD_B) : 0;
      const x = (PAD_L + i * (bw + gap)).toFixed(1);
      const y = (H - PAD_B - h).toFixed(1);
      rects += '<rect class="bar' + (b.value ? '' : ' dim') + '" x="' + x + '" y="' + y
        + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1)
        + '" rx="2"><title>' + U.escape(b.label + ': ' + fmt(b.value)) + '</title></rect>';
    });
    const first = bars[0].label, last = bars[n - 1].label;
    const labels = '<text class="axis-label" x="2" y="' + (H - 3) + '">' + U.escape(first) + '</text>'
      + '<text class="axis-label" x="' + (W - 2) + '" y="' + (H - 3) + '" text-anchor="end">' + U.escape(last) + '</text>'
      + '<text class="axis-label" x="2" y="' + (PAD_T + 4) + '">' + fmt(max) + '</text>';
    return '<div class="chart">' + svgOpen() + rects + labels + '</svg></div>';
  };

  App.charts = Charts;
})();
