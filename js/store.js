/* global window */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const U = App.utils;
  const DB = App.db;

  const listeners = [];

  const S = {
    get state() { return DB.state; },
    get settings() { return DB.state.settings; },

    // ---- pub/sub so the current view can re-render after a data change ----
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit: function () {
      listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    },

    // ---- exercises ----
    exercises: function () {
      return DB.state.exercises.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    },
    exercise: function (id) {
      return DB.state.exercises.find(function (e) { return e.id === id; }) || null;
    },
    exerciseName: function (id) {
      const e = S.exercise(id);
      return e ? e.name : 'Unknown exercise';
    },
    addExercise: function (data) {
      const ex = {
        id: U.uid(),
        name: (data.name || '').trim(),
        primary: data.primary || 'Other',
        equipment: data.equipment || 'Other',
        tracking: data.tracking || 'weight',
        isCustom: true,
        createdAt: Date.now()
      };
      DB.state.exercises.push(ex);
      DB.save('exercises');
      S.emit();
      return ex;
    },
    updateExercise: function (id, patch) {
      const e = S.exercise(id);
      if (!e) return;
      Object.assign(e, patch);
      DB.save('exercises');
      S.emit();
    },
    deleteExercise: function (id) {
      const idx = DB.state.exercises.findIndex(function (e) { return e.id === id; });
      if (idx < 0) return;
      DB.state.exercises.splice(idx, 1);
      DB.save('exercises');
      S.emit();
    },
    exerciseUsedCount: function (id) {
      let n = 0;
      DB.state.workouts.forEach(function (w) {
        w.items.forEach(function (it) { if (it.exerciseId === id) n++; });
      });
      return n;
    },

    // ---- routines ----
    routines: function () {
      return DB.state.routines.slice().sort(function (a, b) {
        return (a.order || 0) - (b.order || 0) || b.updatedAt - a.updatedAt;
      });
    },
    routine: function (id) {
      return DB.state.routines.find(function (r) { return r.id === id; }) || null;
    },
    saveRoutine: function (routine) {
      const now = Date.now();
      if (routine.id) {
        const existing = S.routine(routine.id);
        if (existing) {
          Object.assign(existing, routine, { updatedAt: now });
          DB.save('routines');
          S.emit();
          return existing;
        }
      }
      const r = Object.assign({
        id: U.uid(),
        name: 'Untitled routine',
        notes: '',
        items: [],
        order: DB.state.routines.length,
        createdAt: now,
        updatedAt: now
      }, routine);
      r.id = r.id || U.uid();
      DB.state.routines.push(r);
      DB.save('routines');
      S.emit();
      return r;
    },
    deleteRoutine: function (id) {
      const idx = DB.state.routines.findIndex(function (r) { return r.id === id; });
      if (idx < 0) return;
      DB.state.routines.splice(idx, 1);
      DB.save('routines');
      S.emit();
    },
    duplicateRoutine: function (id) {
      const r = S.routine(id);
      if (!r) return null;
      const copy = U.deepClone(r);
      copy.id = U.uid();
      copy.name = r.name + ' (copy)';
      copy.createdAt = copy.updatedAt = Date.now();
      copy.order = DB.state.routines.length;
      DB.state.routines.push(copy);
      DB.save('routines');
      S.emit();
      return copy;
    },

    // ---- workout history ----
    workouts: function () {
      return DB.state.workouts.slice().sort(function (a, b) { return b.startedAt - a.startedAt; });
    },
    workout: function (id) {
      return DB.state.workouts.find(function (w) { return w.id === id; }) || null;
    },
    deleteWorkout: function (id) {
      const idx = DB.state.workouts.findIndex(function (w) { return w.id === id; });
      if (idx < 0) return;
      DB.state.workouts.splice(idx, 1);
      DB.save('workouts');
      S.emit();
    },
    commitWorkout: function (w) {
      DB.state.workouts.push(w);
      DB.save('workouts');
      DB.saveNow('workouts');
      S.emit();
    },

    // ---- derived stats ----

    // Volume in kg for a single logged item (completed working + drop sets).
    itemVolume: function (item) {
      let v = 0;
      (item.sets || []).forEach(function (s) {
        if (!s.done) return;
        if (s.type === 'warmup') return;
        const w = Number(s.weight) || 0;
        const r = Number(s.reps) || 0;
        v += w * r;
      });
      return v;
    },
    workoutVolume: function (w) {
      let v = 0;
      (w.items || []).forEach(function (it) { v += S.itemVolume(it); });
      return v;
    },
    workoutSetCount: function (w) {
      let n = 0;
      (w.items || []).forEach(function (it) {
        (it.sets || []).forEach(function (s) { if (s.done) n++; });
      });
      return n;
    },

    // Best-ever numbers for an exercise across committed history, optionally
    // ignoring one workout id (used while re-computing during a live session).
    exerciseBests: function (exId, exceptWorkoutId) {
      let best1RM = 0, bestWeight = 0, bestReps = 0, bestVolume = 0, bestSetVolume = 0;
      DB.state.workouts.forEach(function (w) {
        if (exceptWorkoutId && w.id === exceptWorkoutId) return;
        let wVol = 0;
        (w.items || []).forEach(function (it) {
          if (it.exerciseId !== exId) return;
          (it.sets || []).forEach(function (s) {
            if (!s.done || s.type === 'warmup') return;
            const wt = Number(s.weight) || 0;
            const rp = Number(s.reps) || 0;
            const e1 = U.epley1RM(wt, rp);
            if (e1 > best1RM) best1RM = e1;
            if (wt > bestWeight) bestWeight = wt;
            if (rp > bestReps) bestReps = rp;
            if (wt * rp > bestSetVolume) bestSetVolume = wt * rp;
            wVol += wt * rp;
          });
        });
        if (wVol > bestVolume) bestVolume = wVol;
      });
      return { e1rm: best1RM, weight: bestWeight, reps: bestReps, volume: bestVolume, setVolume: bestSetVolume };
    },

    // Most recent committed performance of an exercise (for "previous" hints).
    lastPerformance: function (exId, exceptWorkoutId) {
      const hist = S.workouts();
      for (let i = 0; i < hist.length; i++) {
        const w = hist[i];
        if (exceptWorkoutId && w.id === exceptWorkoutId) continue;
        const it = (w.items || []).find(function (x) { return x.exerciseId === exId; });
        if (it) {
          return {
            date: w.startedAt,
            sets: (it.sets || []).filter(function (s) { return s.done; })
          };
        }
      }
      return null;
    },

    // Time series of best estimated 1RM per session for an exercise.
    exerciseSeries: function (exId) {
      const points = [];
      S.workouts().slice().reverse().forEach(function (w) {
        let top1RM = 0, topWeight = 0, vol = 0;
        (w.items || []).forEach(function (it) {
          if (it.exerciseId !== exId) return;
          (it.sets || []).forEach(function (s) {
            if (!s.done || s.type === 'warmup') return;
            const wt = Number(s.weight) || 0;
            const rp = Number(s.reps) || 0;
            top1RM = Math.max(top1RM, U.epley1RM(wt, rp));
            topWeight = Math.max(topWeight, wt);
            vol += wt * rp;
          });
        });
        if (top1RM > 0 || vol > 0) points.push({ t: w.startedAt, e1rm: top1RM, weight: topWeight, volume: vol });
      });
      return points;
    },

    // Weekly totals for the last `weeks` Monday-weeks.
    weeklyVolume: function (weeks) {
      weeks = weeks || 12;
      const map = {};
      DB.state.workouts.forEach(function (w) {
        const k = U.weekStart(w.startedAt);
        map[k] = (map[k] || 0) + S.workoutVolume(w);
      });
      const out = [];
      const thisWeek = U.weekStart(Date.now());
      for (let i = weeks - 1; i >= 0; i--) {
        const k = thisWeek - i * 7 * 86400000;
        out.push({ t: k, volume: map[k] || 0 });
      }
      return out;
    },

    workoutStreakDays: function () {
      if (!DB.state.workouts.length) return 0;
      const days = {};
      DB.state.workouts.forEach(function (w) {
        const d = new Date(w.startedAt); d.setHours(0, 0, 0, 0);
        days[d.getTime()] = true;
      });
      let streak = 0;
      const cur = new Date(); cur.setHours(0, 0, 0, 0);
      // allow "today not trained yet" — start from today or yesterday
      if (!days[cur.getTime()]) cur.setDate(cur.getDate() - 1);
      while (days[cur.getTime()]) {
        streak++;
        cur.setDate(cur.getDate() - 1);
      }
      return streak;
    },

    // ---- measurements ----
    measurements: function (type) {
      return DB.state.measurements
        .filter(function (m) { return !type || m.type === type; })
        .sort(function (a, b) { return a.date - b.date; });
    },
    addMeasurement: function (type, value, date) {
      const m = { id: U.uid(), type: type, value: Number(value), date: date || Date.now() };
      DB.state.measurements.push(m);
      DB.save('measurements');
      S.emit();
      return m;
    },
    deleteMeasurement: function (id) {
      const idx = DB.state.measurements.findIndex(function (m) { return m.id === id; });
      if (idx >= 0) { DB.state.measurements.splice(idx, 1); DB.save('measurements'); S.emit(); }
    },
    latestMeasurement: function (type) {
      const list = S.measurements(type);
      return list.length ? list[list.length - 1] : null;
    }
  };

  App.store = S;
})();
