/* global window */
// Training logic beyond simple logging: per-set effort, next-session targets,
// stall detection, reactive deloads and failure "calibration" checks.
// Evidence behind the rules (see Stats → ⓘ and the Coach screen):
//   - load or rep progression grow muscle equally when sets are hard
//     (Plotkin 2022); hard = ~0–3 reps in reserve (Refalo 2023)
//   - RIR self-estimates are off by ~1 rep, better near failure (Halperin
//     2022) — so effort is a 3-way choice, not a 0–10 scale
//   - scheduled deloads didn't add muscle and cost some strength (Coleman
//     2024) — so deloads are suggested only on signs of fatigue
//   - systematic, not random, exercise variation helps (Kassiano 2022)
(function () {
  'use strict';
  const App = window.App;
  const U = App.utils, DB = App.db;
  const S = App.store;
  const DAY = 86400000;

  // Reps-in-reserve each effort choice stands for.
  const EFFORT_RIR = { easy: 4, good: 2, fail: 0 };
  const DEFAULT_RIR = 2; // unmarked sets: assume a normal hard set

  const C = {};

  C.EFFORTS = [
    { key: 'easy', label: 'Easy', sub: '4+ left' },
    { key: 'good', label: 'Good', sub: '1–3 left' },
    { key: 'fail', label: 'Failure', sub: '0 left' }
  ];

  // ---------- deload state ----------
  C.deloadActive = function () {
    const d = S.settings.deload;
    return !!(d && Date.now() < d.end);
  };
  C.deloadDaysLeft = function () {
    const d = S.settings.deload;
    return d ? Math.max(0, Math.ceil((d.end - Date.now()) / DAY)) : 0;
  };
  C.startDeload = function () {
    DB.setSettings({ deload: { start: Date.now(), end: Date.now() + 7 * DAY }, deloadSnoozeUntil: 0 });
    S.emit();
  };
  C.endDeload = function () {
    DB.setSettings({ deload: null, lastDeloadEnd: Date.now() });
    S.emit();
  };
  C.snoozeDeload = function () {
    DB.setSettings({ deloadSnoozeUntil: Date.now() + 7 * DAY });
    S.emit();
  };

  // ---------- history helpers ----------
  function workingSets(item) {
    return (item.sets || []).filter(function (s) {
      return s.done && S.setGroup(s.type) === 'work' && Number(s.reps) > 0;
    });
  }

  // Sessions (newest first) where the exercise has completed working sets.
  // Deload weeks are left out — they're deliberately easier.
  function sessions(exId, sinceDays) {
    const since = sinceDays ? Date.now() - sinceDays * DAY : 0;
    const out = [];
    S.workouts().forEach(function (w) {
      if (w.deload || w.startedAt < since) return;
      const it = (w.items || []).filter(function (x) { return x.exerciseId === exId; })[0];
      if (!it) return;
      const sets = workingSets(it);
      if (!sets.length) return;
      out.push({ t: w.startedAt, workoutId: w.id, sets: sets, e1: bestE1(sets) });
    });
    return out;
  }
  C.sessions = sessions;

  function bestE1(sets) {
    let b = 0;
    sets.forEach(function (s) { b = Math.max(b, U.epley1RM(Number(s.weight) || 0, Number(s.reps) || 0)); });
    return b;
  }

  // Effective reps-in-reserve of set i. A "Good" set followed by a big rep
  // crash at the same weight was probably closer to failure than it felt.
  C.rirOf = function (sets, i) {
    const s = sets[i];
    let rir = s.effort ? EFFORT_RIR[s.effort] : DEFAULT_RIR;
    const next = sets[i + 1];
    if (next && s.effort !== 'fail' && S.setGroup(next.type) === 'work' &&
        Math.abs((Number(next.weight) || 0) - (Number(s.weight) || 0)) < 0.01 &&
        (Number(s.reps) || 0) - (Number(next.reps) || 0) >= 3) {
      rir = Math.min(rir, 1);
    }
    return rir;
  };

  function stepKg() {
    return S.settings.units === 'lb' ? (S.settings.incLb || 5) * U.KG_PER_LB : (S.settings.incKg || 2.5);
  }
  function roundTo(w, step) { return Math.round(w / step) * step; }

  // ---------- next-session target for one working set ----------
  // prev: last session's set (with effort). Returns { weight, reps, kind }
  // kind: 'weight' (up), 'down', 'reps' (+reps, same weight), 'deload'.
  C.nextTarget = function (prev, rir, repMin, repMax) {
    const w = Number(prev.weight) || 0, r = Number(prev.reps) || 0;
    const step = stepKg();
    if (C.deloadActive()) return { weight: prev.weight, reps: prev.reps, kind: 'deload' };
    if (!w) {
      // bodyweight: can't add load, so add reps (more if it was easy)
      return { weight: prev.weight, reps: r + (prev.effort === 'easy' ? 2 : 1), kind: 'reps' };
    }
    const e1 = w * (1 + (r + rir) / 30);
    const loadFor = function (reps, atRir) { return e1 / (1 + (reps + atRir) / 30); };

    if (r < repMin) {
      // Below the range (too heavy, or the range was just changed): pick the
      // load that lands at the bottom of the range with ~2 in reserve.
      let nw = roundTo(loadFor(repMin, 2), step);
      if (nw >= w) return { weight: prev.weight, reps: repMin, kind: 'reps' };
      nw = Math.max(nw, roundTo(w * 0.85, step));
      return { weight: nw, reps: repMin, kind: 'down' };
    }
    if (prev.effort === 'easy') {
      // too far from failure to count fully — jump to a load that lands at
      // the same reps with ~2 in reserve (at least one step, at most +10%)
      const reps = r >= repMax ? repMin : r;
      let nw = roundTo(loadFor(reps, 2), step);
      nw = Math.min(Math.max(nw, w + step), Math.max(w + step, roundTo(w * 1.1, step)));
      return { weight: nw, reps: reps, kind: 'weight' };
    }
    if (r >= repMax) {
      // classic double progression: one step up, back to the bottom of the range
      return { weight: w + step, reps: repMin, kind: 'weight' };
    }
    return { weight: prev.weight, reps: Math.min(repMax, r + 1), kind: 'reps' };
  };

  // ---------- stalls ----------
  // 'new' (<4 sessions), 'progressing', 'stalled' (best of the last 3
  // sessions didn't beat the best before them), or 'steady'.
  C.trend = function (exId) {
    const ss = sessions(exId, 120);
    if (ss.length < 4) return { status: 'new', sessions: ss.length };
    const recent = ss.slice(0, 3), before = ss.slice(3);
    const recentBest = Math.max.apply(null, recent.map(function (s) { return s.e1; }));
    const beforeBest = Math.max.apply(null, before.map(function (s) { return s.e1; }));
    const change = beforeBest ? (recentBest - beforeBest) / beforeBest : 0;
    if (recentBest <= beforeBest * 1.005) {
      // count how many recent sessions in a row failed to beat the earlier best
      let n = 0;
      for (let i = 0; i < ss.length - 1; i++) {
        const prior = Math.max.apply(null, ss.slice(i + 1).map(function (s) { return s.e1; }));
        if (ss[i].e1 <= prior * 1.005) n++; else break;
      }
      return { status: 'stalled', sessions: ss.length, stalledFor: Math.max(3, n), change: change };
    }
    return { status: ss[0].e1 > beforeBest ? 'progressing' : 'steady', sessions: ss.length, change: change };
  };

  // Same-muscle alternatives. Ranked: same kind of movement first (a press
  // for a press, an isolation for an isolation — approximated by sharing the
  // same secondary muscles), then lengthened-position exercises (Maeo 2021),
  // then a different piece of equipment for a genuinely different stimulus.
  C.alternatives = function (exId, excludeIds, n) {
    const ex = S.exercise(exId);
    if (!ex) return [];
    excludeIds = excludeIds || [];
    const sig = function (e) { return (e.secondary || []).slice().sort().join(','); };
    const score = function (e) {
      return (sig(e) === sig(ex) ? 4 : 0) + (e.lengthened ? 2 : 0) + (e.equipment !== ex.equipment ? 1 : 0);
    };
    return S.exercises()
      .filter(function (e) {
        return e.id !== exId && e.primary === ex.primary && e.tracking !== 'cardio' && excludeIds.indexOf(e.id) < 0;
      })
      .sort(function (a, b) { return score(b) - score(a) || a.name.localeCompare(b.name); })
      .slice(0, n || 3);
  };

  // ---------- fatigue → deload suggestion ----------
  C.fatigue = function () {
    const res = { suggest: false, reasons: [], dropped: [] };
    if (C.deloadActive()) return res;
    const now = Date.now();
    const quietSince = Math.max(S.settings.lastDeloadEnd || 0, 0);
    if (now - quietSince < 14 * DAY) return res;

    // 1) performance drops: this week's best vs the average of the 3 sessions before
    const seen = {};
    S.workouts().forEach(function (w) {
      if (w.deload || w.startedAt < now - 7 * DAY || w.startedAt < quietSince) return;
      (w.items || []).forEach(function (it) {
        if (seen[it.exerciseId]) return;
        const ss = sessions(it.exerciseId, 90);
        const idx = ss.findIndex(function (s) { return s.workoutId === w.id; });
        if (idx < 0) return;
        const prior = ss.slice(idx + 1, idx + 4);
        if (prior.length < 2) return;
        seen[it.exerciseId] = true;
        const avg = prior.reduce(function (n, s) { return n + s.e1; }, 0) / prior.length;
        if (ss[idx].e1 < avg * 0.95) res.dropped.push(it.exerciseId);
      });
    });
    if (res.dropped.length >= 2) {
      res.reasons.push('Performance dropped on ' + res.dropped.length + ' exercises this week (' +
        res.dropped.slice(0, 3).map(S.exerciseName).join(', ') + ')');
    }

    // 2) grinding: most marked sets over two weeks were taken to failure
    let marked = 0, fails = 0;
    S.workouts().forEach(function (w) {
      if (w.deload || w.startedAt < now - 14 * DAY) return;
      (w.items || []).forEach(function (it) {
        workingSets(it).forEach(function (s) { if (s.effort) { marked++; if (s.effort === 'fail') fails++; } });
      });
    });
    const grinding = marked >= 15 && fails / marked >= 0.5;
    if (grinding) res.reasons.push(Math.round(fails / marked * 100) + '% of your sets in the last 2 weeks went to failure');

    res.suggest = res.dropped.length >= 2 || grinding;
    if (res.suggest && (S.settings.deloadSnoozeUntil || 0) > now) res.snoozed = true;
    return res;
  };

  // ---------- failure checks ----------
  // Safe to take to failure without a spotter: machines, cables, small
  // isolation lifts. Never heavy barbell compounds.
  C.safeToFail = function (ex) {
    if (!ex || ex.tracking === 'cardio') return false;
    if (ex.equipment === 'Machine' || ex.equipment === 'Cable') return true;
    if (ex.equipment === 'Barbell') return false;
    return ['Biceps', 'Triceps', 'Shoulders', 'Calves', 'Abs', 'Forearms'].indexOf(ex.primary) >= 0;
  };

  // Due when a safe exercise has history but no failure set in ~4 weeks.
  C.failureCheckDue = function (exId) {
    if (C.deloadActive()) return false;
    const ex = S.exercise(exId);
    if (!C.safeToFail(ex)) return false;
    const ss = sessions(exId, 365);
    if (ss.length < 2) return false;
    const lastFail = ss.filter(function (s) {
      return s.sets.some(function (x) { return x.effort === 'fail'; });
    })[0];
    return !lastFail || Date.now() - lastFail.t > 28 * DAY;
  };

  // After a failure set: compare it with the set before it at the same weight.
  // If you got 2+ more reps than that set plus what you said was left, your
  // "Good" sets are softer than you think.
  C.calibrate = function (sets, failIdx) {
    const f = sets[failIdx];
    for (let i = failIdx - 1; i >= 0; i--) {
      const p = sets[i];
      if (!p.done || S.setGroup(p.type) !== 'work' || !p.effort || p.effort === 'fail') continue;
      if (Math.abs((Number(p.weight) || 0) - (Number(f.weight) || 0)) > 0.01) return null;
      const predictedMax = (Number(p.reps) || 0) + EFFORT_RIR[p.effort];
      const gap = (Number(f.reps) || 0) - predictedMax;
      return { gap: gap, said: p.effort, prevReps: Number(p.reps) || 0, failReps: Number(f.reps) || 0 };
    }
    return null;
  };

  C.recordCalibration = function (exId, result) {
    const list = (S.settings.calibrations || []).slice(-19);
    list.push({ t: Date.now(), exId: exId, gap: result.gap });
    DB.setSettings({ calibrations: list });
  };

  // ---------- weekly coach summary ----------
  C.summary = function () {
    const ids = {};
    S.workouts().forEach(function (w) {
      if (w.startedAt < Date.now() - 42 * DAY) return;
      (w.items || []).forEach(function (it) { ids[it.exerciseId] = true; });
    });
    const progressing = [], stalled = [], due = [], longRunning = [];
    Object.keys(ids).forEach(function (id) {
      const t = C.trend(id);
      if (t.status === 'progressing') progressing.push({ id: id, change: t.change });
      if (t.status === 'stalled') stalled.push({ id: id, stalledFor: t.stalledFor });
      if (C.failureCheckDue(id)) due.push(id);
      // systematic rotation: in the program 8+ weeks and no longer climbing
      const ss = sessions(id, 120);
      if (t.status !== 'progressing' && t.status !== 'stalled' && ss.length >= 6 &&
          ss[ss.length - 1].t <= Date.now() - 56 * DAY) {
        longRunning.push({ id: id, weeks: Math.round((Date.now() - ss[ss.length - 1].t) / (7 * DAY)) });
      }
    });
    progressing.sort(function (a, b) { return b.change - a.change; });
    return { progressing: progressing, stalled: stalled, failureDue: due, longRunning: longRunning, fatigue: C.fatigue() };
  };

  App.coach = C;
})();
