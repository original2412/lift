/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;
  const C = App.coach;

  // Deload banner/card, shared with Home.
  App.deloadCard = function (compact) {
    if (C.deloadActive()) {
      return el('div.card.deload-card', null, [
        el('div.rowsplit', null, [
          el('strong', { text: 'Deload week · ' + U.pluralize(C.deloadDaysLeft(), 'day') + ' left' }),
          el('button.btn.sm.ghost', { text: 'End early', onclick: function () { C.endDeload(); } })
        ]),
        el('div.muted.tiny', { text: 'Same weights, half the sets, stop with 3–4 reps left. Your next workouts are set up this way automatically.', style: { marginTop: '4px' } })
      ]);
    }
    const f = C.fatigue();
    if (!f.suggest || (compact && f.snoozed)) return null;
    return el('div.card.deload-card.warn', null, [
      el('strong', { text: 'Signs of fatigue — take a deload week?' }),
      el('ul.change-list', { style: { margin: '8px 0' } }, f.reasons.map(function (r) { return el('li', { text: r }); })),
      el('div.muted.tiny', { text: 'A week with half the sets at the same weights lets fatigue clear so performance can climb again. It won’t cost you muscle.', style: { marginBottom: '10px' } }),
      el('div.btn-row', null, [
        el('button.btn.primary', { text: 'Start deload week', onclick: function () { C.startDeload(); UI.toast('Deload week started'); } }),
        el('button.btn.ghost', { text: 'Not now', onclick: function () { C.snoozeDeload(); } })
      ])
    ]);
  };

  // One-line summary card for Home.
  App.coachCard = function () {
    const s = C.summary();
    const bits = [];
    if (s.progressing.length) bits.push(s.progressing.length + ' progressing');
    if (s.stalled.length) bits.push(s.stalled.length + ' stalled');
    if (s.failureDue.length) bits.push(s.failureDue.length + ' failure check' + (s.failureDue.length > 1 ? 's' : '') + ' due');
    if (s.longRunning.length) bits.push(s.longRunning.length + ' to rotate');
    if (!bits.length) return null;
    return el('a.card.tight.coach-link', { href: '#/coach' }, [
      el('span.target-ic', { html: svg(ICON.target) }),
      el('div.grow', null, [el('strong', { text: 'Coach' }), el('div.muted.tiny', { text: bits.join(' · ') })]),
      el('span', { html: svg(ICON.chevronR, ' style="width:18px;height:18px;color:var(--text-faint)"') })
    ]);
  };

  App.router.add('/coach', function (ctx) {
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      v.appendChild(el('div.back-row', null, [
        el('button.icon-btn', { html: svg(ICON.back), 'aria-label': 'Back', onclick: function () { R.back('/'); } }),
        el('span.title', { text: 'Coach' })
      ]));
      const s = C.summary();

      // recovery
      v.appendChild(el('div.section-label', { text: 'Recovery' }));
      v.appendChild(App.deloadCard(false) || el('div.card.muted.tiny', {
        text: 'No signs of fatigue. A deload is only suggested when performance drops across exercises or most sets go to failure — scheduled deloads didn’t add muscle in research.'
      }));

      // stalled
      v.appendChild(el('div.section-label', { text: 'Stalled' }));
      if (!s.stalled.length) {
        v.appendChild(el('div.card.muted.tiny', { text: 'Nothing stalled — every exercise with enough history beat its earlier best in the last 3 sessions.' }));
      } else {
        const card = el('div.card', null, [el('div.muted.tiny', { text: 'Best estimated 1RM hasn’t gone up in 3+ sessions. In your next workout, tap the ⚠ row on the exercise for options (add volume, new rep range, or swap).', style: { marginBottom: '6px' } })]);
        s.stalled.forEach(function (x) {
          card.appendChild(exRow(x.id, 'No progress for ' + x.stalledFor + ' sessions', null));
        });
        v.appendChild(card);
      }

      // progressing
      if (s.progressing.length) {
        v.appendChild(el('div.section-label', { text: 'Progressing' }));
        const card = el('div.card');
        s.progressing.slice(0, 8).forEach(function (x) {
          card.appendChild(exRow(x.id, 'New best in the last 3 sessions', '+' + (Math.round(x.change * 1000) / 10) + '%'));
        });
        v.appendChild(card);
      }

      // rotation
      if (s.longRunning.length) {
        v.appendChild(el('div.section-label', { text: 'Consider rotating' }));
        const card = el('div.card', null, [el('div.muted.tiny', { text: 'In your program 8+ weeks and no longer climbing. Swapping 1–2 of these for a similar exercise gives a fresh stimulus — change a few at a time, not everything.', style: { marginBottom: '6px' } })]);
        s.longRunning.forEach(function (x) {
          const alt = C.alternatives(x.id, [], 1)[0];
          card.appendChild(exRow(x.id, x.weeks + ' weeks' + (alt ? ' · try ' + (alt.lengthened ? '↗ ' : '') + alt.name : ''), null));
        });
        v.appendChild(card);
      }

      // failure checks + calibration
      v.appendChild(el('div.section-label', { text: 'Effort calibration' }));
      const cal = (S.settings.calibrations || []).slice(-5).reverse();
      const card = el('div.card');
      card.appendChild(el('div.muted.tiny', { text: s.failureDue.length
        ? 'Due: ' + s.failureDue.map(S.exerciseName).join(', ') + '. These get a “Failure check” in your next workout automatically.'
        : 'No failure checks due. About every 4 weeks, a safe exercise (machine, cable, isolation) gets one automatically.' }));
      if (cal.length) {
        cal.forEach(function (c) {
          const txt = c.gap >= 2 ? '+' + c.gap + ' reps more than predicted — push harder'
            : c.gap <= -2 ? c.gap + ' reps — your sets are already very hard'
              : 'Accurate (' + (c.gap > 0 ? '+' : '') + c.gap + ')';
          card.appendChild(exRow(c.exId, txt, U.relDay(c.t)));
        });
      }
      v.appendChild(card);
    });
  }, { tab: 'home', fullscreen: true });

  function exRow(exId, meta, right) {
    return el('a.list-item', { href: '#/exercise/' + exId }, [
      UI.exerciseThumb(S.exercise(exId), 34),
      el('div.grow', null, [el('div.name', { text: S.exerciseName(exId) }), el('div.meta', { text: meta })]),
      right ? el('span.tiny', { text: right, style: { color: 'var(--good)', fontWeight: '700' } }) : null
    ]);
  }
})();
