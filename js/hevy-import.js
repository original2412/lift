/* global window */
// Import workout history from a Hevy CSV export (Hevy → Settings → Export
// data). One row per set; rows sharing title + start time are one workout.
// Imported workouts get ids derived from their start time, and any Hevy
// workout that overlaps one already in Lift is skipped, so importing the
// same file twice (or a file covering workouts also logged here) is safe.
(function () {
  'use strict';
  const App = window.App;
  const DB = App.db, S = App.store, U = App.utils;

  // Hevy name → built-in id, where the names differ.
  const ALIAS = {
    'Bench Press (Barbell)': 'ex_bench_press',
    'Bench Press (Dumbbell)': 'ex_dumbbell_bench_press',
    'Incline Bench Press (Barbell)': 'ex_incline_bench_press',
    'Incline Bench Press (Dumbbell)': 'ex_incline_dumbbell_press',
    'Decline Bench Press (Barbell)': 'ex_decline_bench_press',
    'Chest Fly (Dumbbell)': 'ex_dumbbell_fly',
    'Chest Press (Machine)': 'ex_chest_press_machine',
    'Butterfly (Pec Deck)': 'ex_pec_deck',
    'Cable Fly Crossovers': 'ex_cable_fly_crossover',
    'Chest Dip': 'ex_dip',
    'Chest Dip (Weighted)': 'ex_dip',
    'Push Up': 'ex_push_up',
    'Deadlift (Barbell)': 'ex_deadlift',
    'Bent Over Row (Barbell)': 'ex_barbell_row',
    'Pendlay Row (Barbell)': 'ex_pendlay_row',
    'T Bar Row': 'ex_t_bar_row',
    'Dumbbell Row': 'ex_dumbbell_row',
    'Chest Supported Incline Row (Dumbbell)': 'ex_dumbbell_row',
    'Seated Cable Row - V Grip (Cable)': 'ex_seated_cable_row',
    'Seated Cable Row - Bar Grip': 'ex_seated_cable_row',
    'Lat Pulldown (Cable)': 'ex_lat_pulldown',
    'Pull Up': 'ex_pull_up',
    'Pull Up (Weighted)': 'ex_pull_up',
    'Chin Up': 'ex_chin_up',
    'Chin Up (Weighted)': 'ex_chin_up',
    'Iso-Lateral Row (Machine)': 'ex_iso_lateral_row_machine',
    'Overhead Press (Barbell)': 'ex_overhead_press',
    'Overhead Press (Smith Machine)': 'ex_overhead_press',
    'Shoulder Press (Dumbbell)': 'ex_seated_dumbbell_press',
    'Seated Shoulder Press (Machine)': 'ex_machine_shoulder_press',
    'Lateral Raise (Dumbbell)': 'ex_lateral_raise',
    'Lateral Raise (Cable)': 'ex_cable_lateral_raise',
    'Front Raise (Dumbbell)': 'ex_front_raise',
    'Rear Delt Reverse Fly (Dumbbell)': 'ex_reverse_fly',
    'Shrug (Barbell)': 'ex_barbell_shrug',
    'Shrug (Dumbbell)': 'ex_dumbbell_shrug',
    'Bicep Curl (Barbell)': 'ex_barbell_curl',
    'Bicep Curl (Dumbbell)': 'ex_dumbbell_curl',
    'Bicep Curl (Cable)': 'ex_cable_curl',
    'EZ Bar Biceps Curl': 'ex_ez_bar_curl',
    'Hammer Curl (Dumbbell)': 'ex_hammer_curl',
    'Preacher Curl (Dumbbell)': 'ex_preacher_curl',
    'Preacher Curl (Barbell)': 'ex_preacher_curl',
    'Preacher Curl (Machine)': 'ex_preacher_curl',
    'Behind the Back Curl (Cable)': 'ex_behind_the_back_cable_curl',
    'Triceps Pushdown': 'ex_triceps_pushdown',
    'Triceps Rope Pushdown': 'ex_rope_pushdown',
    'Overhead Triceps Extension (Cable)': 'ex_overhead_triceps_extension',
    'Triceps Extension (Dumbbell)': 'ex_overhead_triceps_extension',
    'Triceps Kickback (Cable)': 'ex_triceps_kickback',
    'Triceps Kickback (Dumbbell)': 'ex_triceps_kickback',
    'Skullcrusher (Barbell)': 'ex_skull_crusher',
    'Skullcrusher (Dumbbell)': 'ex_skull_crusher',
    'Squat (Barbell)': 'ex_back_squat',
    'Front Squat': 'ex_front_squat',
    'Squat (Smith Machine)': 'ex_smith_machine_squat',
    'Hack Squat (Machine)': 'ex_hack_squat',
    'Leg Press (Machine)': 'ex_leg_press',
    'Leg Press Horizontal (Machine)': 'ex_leg_press',
    'Leg Extension (Machine)': 'ex_leg_extension',
    'Bulgarian Split Squat': 'ex_bulgarian_split_squat',
    'Lunge (Dumbbell)': 'ex_walking_lunge',
    'Walking Lunge (Dumbbell)': 'ex_walking_lunge',
    'Romanian Deadlift (Barbell)': 'ex_romanian_deadlift',
    'Romanian Deadlift (Dumbbell)': 'ex_romanian_deadlift',
    'Seated Leg Curl (Machine)': 'ex_seated_leg_curl',
    'Lying Leg Curl (Machine)': 'ex_lying_leg_curl',
    'Hip Thrust (Barbell)': 'ex_hip_thrust',
    'Hip Abduction (Machine)': 'ex_abduction_machine',
    'Calf Press (Machine)': 'ex_leg_press_calf_raise',
    'Standing Calf Raise (Machine)': 'ex_standing_calf_raise',
    'Seated Calf Raise': 'ex_seated_calf_raise',
    'Crunch (Machine)': 'ex_machine_crunch',
    'Knee Raise Parallel Bars': 'ex_hanging_leg_raise',
    'Hanging Knee Raise': 'ex_hanging_leg_raise',
    'Hanging Leg Raise': 'ex_hanging_leg_raise'
  };

  const SET_TYPE = { normal: 'normal', warmup: 'warmup', dropset: 'drop', failure: 'fail' };
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // Muscle for a Hevy exercise we have no match for, from its name.
  const GUESS = [
    [/calf/i, 'Calves'], [/curl.*leg|leg curl|hamstring|romanian|rdl/i, 'Hamstrings'],
    [/curl/i, 'Biceps'], [/tricep|pushdown|skull|kickback/i, 'Triceps'],
    [/squat|leg press|lunge|leg extension/i, 'Quadriceps'], [/glute|hip thrust|abduct/i, 'Glutes'],
    [/row|pull|lat |deadlift/i, 'Back'], [/bench|chest|fly|dip|push up/i, 'Chest'],
    [/lateral|shoulder|overhead|raise|delt|face pull/i, 'Shoulders'], [/shrug/i, 'Traps'],
    [/crunch|ab |plank|sit up|knee raise/i, 'Abs']
  ];
  const EQUIP = { barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', 'smith machine': 'Machine', kettlebell: 'Kettlebell', band: 'Band' };

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1; });
  }

  // "11 Sep 2026, 17:44" (phone's local time) → ms
  function parseTime(s) {
    const m = /(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(s || '');
    if (m && MONTHS[m[2].toLowerCase()] != null) {
      return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]).getTime();
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function key(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  // Find (or plan to create) the Lift exercise for a Hevy name.
  function matcher() {
    const byName = {};
    DB.state.exercises.forEach(function (e) { byName[key(e.name)] = e; });
    const byId = {};
    DB.state.exercises.forEach(function (e) { byId[e.id] = e; });
    return function (name) {
      // 1) same name (incl. a custom you made to mirror Hevy)
      if (byName[key(name)]) return byName[key(name)];
      // 2) known Hevy name
      if (ALIAS[name] && byId[ALIAS[name]]) return byId[ALIAS[name]];
      // 3) "Name (Equipment)" → "Name" or "Equipment Name"
      const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
      if (m) {
        if (byName[key(m[1])]) return byName[key(m[1])];
        if (byName[key(m[2] + ' ' + m[1])]) return byName[key(m[2] + ' ' + m[1])];
      }
      return null;
    };
  }

  function newExercise(name) {
    let primary = 'Other';
    for (let i = 0; i < GUESS.length; i++) if (GUESS[i][0].test(name)) { primary = GUESS[i][1]; break; }
    const m = /\(([^)]+)\)\s*$/.exec(name);
    const equipment = (m && EQUIP[m[1].toLowerCase()]) || (/weighted|push up|pull up|dip/i.test(name) ? 'Bodyweight' : 'Other');
    return { id: 'ex_hevy_' + key(name), name: name, primary: primary, equipment: equipment, tracking: 'weight', isCustom: true, createdAt: Date.now() };
  }

  function num(s) { const n = parseFloat(s); return isNaN(n) ? 0 : n; }

  // Read a Hevy CSV into a plan: what would be added, skipped and created.
  function plan(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    const head = rows.shift() || [];
    const col = {};
    head.forEach(function (h, i) { col[h.trim()] = i; });
    ['title', 'start_time', 'exercise_title', 'set_type', 'weight_kg', 'reps'].forEach(function (k) {
      if (col[k] == null) throw new Error('This isn’t a Hevy workout export (missing “' + k + '”)');
    });
    const get = function (r, k) { return col[k] == null ? '' : (r[col[k]] || '').trim(); };

    const match = matcher();
    const created = {};
    const mapped = {};
    const workouts = {};
    const order = [];
    rows.forEach(function (r) {
      const start = parseTime(get(r, 'start_time'));
      if (start == null) return;
      const wk = start + '|' + get(r, 'title');
      let w = workouts[wk];
      if (!w) {
        const end = parseTime(get(r, 'end_time')) || start;
        w = workouts[wk] = {
          id: 'hevy_' + start.toString(36),
          name: get(r, 'title') || 'Workout',
          startedAt: start,
          endedAt: Math.max(end, start),
          durationSec: Math.max(0, Math.round((end - start) / 1000)),
          notes: get(r, 'description'),
          items: [],
          _byEx: {}
        };
        order.push(w);
      }
      const hname = get(r, 'exercise_title');
      let ex = match(hname);
      if (!ex) ex = created[hname] = created[hname] || newExercise(hname);
      const base = hname.replace(/\s*\([^)]*\)\s*$/, '');
      if (key(ex.name) !== key(hname) && key(ex.name) !== key(base)) mapped[hname] = ex.name;
      // a Hevy exercise appears once per workout (superset rows interleave)
      const ik = hname + '|' + get(r, 'superset_id');
      let it = w._byEx[ik];
      if (!it) {
        it = w._byEx[ik] = { exerciseId: ex.id, notes: get(r, 'exercise_notes'), restSec: 0, sets: [] };
        if (get(r, 'superset_id')) it.superset = 'hevy' + get(r, 'superset_id');
        w.items.push(it);
      }
      const type = SET_TYPE[get(r, 'set_type')] || 'normal';
      const set = { type: type, weight: num(get(r, 'weight_kg')), reps: Math.round(num(get(r, 'reps'))), done: true, _i: num(get(r, 'set_index')) };
      if (type === 'fail') set.effort = 'fail';
      it.sets.push(set);
    });

    // skip what's already here: same id (imported before) or overlapping a
    // workout logged in Lift (e.g. the same session tracked in both apps)
    const have = DB.state.workouts;
    const ids = {};
    have.forEach(function (x) { ids[x.id] = true; });
    const PAD = 30 * 60 * 1000;
    const add = [], skip = [];
    order.forEach(function (w) {
      w.items.forEach(function (it) {
        it.sets.sort(function (a, b) { return a._i - b._i; });
        it.sets.forEach(function (s) { delete s._i; });
      });
      w.items = w.items.filter(function (it) { return it.sets.length; });
      delete w._byEx;
      const dup = ids[w.id] || have.some(function (x) {
        return x.startedAt < w.endedAt + PAD && (x.endedAt || x.startedAt) > w.startedAt - PAD;
      });
      (dup ? skip : add).push(w);
    });
    add.sort(function (a, b) { return a.startedAt - b.startedAt; });

    return {
      add: add,
      skip: skip,
      created: Object.keys(created).map(function (k) { return created[k]; }),
      mapped: mapped,
      sets: add.reduce(function (n, w) { return n + w.items.reduce(function (m, it) { return m + it.sets.length; }, 0); }, 0)
    };
  }

  // Records (as Lift marks them on finish) for the imported workouts, replayed
  // in time order against everything logged before each one.
  function markRecords(importedIds) {
    const best = {};
    DB.state.workouts.slice().sort(function (a, b) { return a.startedAt - b.startedAt; }).forEach(function (w) {
      const prs = [];
      (w.items || []).forEach(function (it) {
        const b = best[it.exerciseId] = best[it.exerciseId] || { e1rm: 0, weight: 0, volume: 0 };
        let top1 = 0, topW = 0, vol = 0;
        (it.sets || []).forEach(function (s) {
          if (s.type === 'warmup') return;
          top1 = Math.max(top1, U.epley1RM(s.weight, s.reps));
          topW = Math.max(topW, s.weight);
          vol += s.weight * s.reps;
        });
        const hits = [];
        if (top1 > b.e1rm + 0.01 && b.e1rm > 0) hits.push('1RM ' + U.fmtNum(App.fmtW(top1)) + App.unit());
        if (topW > b.weight + 0.01 && b.weight > 0) hits.push('weight ' + U.fmtNum(App.fmtW(topW)) + App.unit());
        if (vol > b.volume + 0.01 && b.volume > 0) hits.push('volume');
        if (hits.length) prs.push({ exerciseId: it.exerciseId, hits: hits });
        b.e1rm = Math.max(b.e1rm, top1); b.weight = Math.max(b.weight, topW); b.volume = Math.max(b.volume, vol);
      });
      if (importedIds[w.id]) w.prs = prs;
    });
  }

  function apply(p) {
    p.created.forEach(function (e) {
      if (!S.exercise(e.id)) DB.state.exercises.push(e);
    });
    const routineByName = {};
    DB.state.routines.forEach(function (r) { routineByName[key(r.name)] = r.id; });
    const ids = {};
    p.add.forEach(function (w) {
      w.routineId = routineByName[key(w.name)] || null;
      w.imported = 'hevy';
      ids[w.id] = true;
      DB.state.workouts.push(w);
    });
    markRecords(ids);
    DB.saveNow('exercises');
    DB.saveNow('workouts');
    S.emit();
  }

  App.hevyImport = { plan: plan, apply: apply, parseCSV: parseCSV, parseTime: parseTime };
})();
