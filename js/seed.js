/* global window */
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  App.MUSCLES = [
    'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
    'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Traps',
    'Full Body', 'Cardio', 'Other'
  ];

  // Weekly hard-set targets per muscle, counted "fractionally" (a set counts 1
  // for its primary muscle and 0.5 for each secondary), per Pelland et al.
  // 2024's dose-response meta-regression. min ≈ RP's minimum effective volume,
  // max ≈ top of their maximum adaptive volume — above it gains still come but
  // slower, and recovery becomes the limit. "Shoulders" here means side/rear
  // delts; front delts get enough from pressing.
  App.MUSCLE_TARGETS = {
    Chest: { min: 8, max: 18 },
    Back: { min: 10, max: 20 },
    Shoulders: { min: 8, max: 16 },
    Biceps: { min: 6, max: 14 },
    Triceps: { min: 6, max: 12 },
    Quadriceps: { min: 8, max: 18 },
    Hamstrings: { min: 6, max: 14 },
    Glutes: { min: 4, max: 12 },
    Calves: { min: 8, max: 16 },
    Abs: { min: 4, max: 16 }
  };
  App.OTHER_MUSCLE_TARGET = { min: 4, max: 12 };
  App.GROWTH_MUSCLES = Object.keys(App.MUSCLE_TARGETS);
  App.muscleTarget = function (m) { return App.MUSCLE_TARGETS[m] || App.OTHER_MUSCLE_TARGET; };
  App.DEFAULT_REP_RANGE = { min: 8, max: 12 };

  App.EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'Other'];

  // Base library. Ids are stable slugs so history survives re-seeding.
  const RAW = [
    // Chest
    ['Bench Press', 'Chest', 'Barbell'],
    ['Incline Bench Press', 'Chest', 'Barbell'],
    ['Decline Bench Press', 'Chest', 'Barbell'],
    ['Dumbbell Bench Press', 'Chest', 'Dumbbell'],
    ['Incline Dumbbell Press', 'Chest', 'Dumbbell'],
    ['Dumbbell Fly', 'Chest', 'Dumbbell'],
    ['Cable Fly', 'Chest', 'Cable'],
    ['Chest Press Machine', 'Chest', 'Machine'],
    // 4th element pins the id — renamed from "Pec Deck", keep history attached.
    ['Butterfly (Pec Deck)', 'Chest', 'Machine', 'ex_pec_deck'],
    ['Cable Fly Crossover', 'Chest', 'Cable'],
    ['Push-Up', 'Chest', 'Bodyweight'],
    ['Dip', 'Chest', 'Bodyweight'],

    // Back
    ['Deadlift', 'Back', 'Barbell'],
    ['Barbell Row', 'Back', 'Barbell'],
    ['Pendlay Row', 'Back', 'Barbell'],
    ['T-Bar Row', 'Back', 'Machine'],
    ['Dumbbell Row', 'Back', 'Dumbbell'],
    ['Seated Cable Row', 'Back', 'Cable'],
    ['Lat Pulldown', 'Back', 'Cable'],
    ['Wide-Grip Pulldown', 'Back', 'Cable'],
    ['Straight-Arm Pulldown', 'Back', 'Cable'],
    ['Pull-Up', 'Back', 'Bodyweight'],
    ['Chin-Up', 'Back', 'Bodyweight'],
    ['Machine Row', 'Back', 'Machine'],
    ['Rack Pull', 'Back', 'Barbell'],
    ['Back Extension', 'Back', 'Bodyweight'],

    // Shoulders
    ['Overhead Press', 'Shoulders', 'Barbell'],
    ['Seated Dumbbell Press', 'Shoulders', 'Dumbbell'],
    ['Arnold Press', 'Shoulders', 'Dumbbell'],
    ['Lateral Raise', 'Shoulders', 'Dumbbell'],
    ['Cable Lateral Raise', 'Shoulders', 'Cable'],
    ['Front Raise', 'Shoulders', 'Dumbbell'],
    ['Reverse Fly', 'Shoulders', 'Dumbbell'],
    ['Face Pull', 'Shoulders', 'Cable'],
    ['Machine Shoulder Press', 'Shoulders', 'Machine'],
    ['Upright Row', 'Shoulders', 'Barbell'],

    // Traps
    ['Barbell Shrug', 'Traps', 'Barbell'],
    ['Dumbbell Shrug', 'Traps', 'Dumbbell'],

    // Biceps
    ['Barbell Curl', 'Biceps', 'Barbell'],
    ['EZ-Bar Curl', 'Biceps', 'Barbell'],
    ['Dumbbell Curl', 'Biceps', 'Dumbbell'],
    ['Hammer Curl', 'Biceps', 'Dumbbell'],
    ['Incline Dumbbell Curl', 'Biceps', 'Dumbbell'],
    ['Preacher Curl', 'Biceps', 'Machine'],
    ['Cable Curl', 'Biceps', 'Cable'],
    ['Concentration Curl', 'Biceps', 'Dumbbell'],
    ['Behind-the-Back Cable Curl', 'Biceps', 'Cable'],

    // Triceps
    ['Close-Grip Bench Press', 'Triceps', 'Barbell'],
    ['Triceps Pushdown', 'Triceps', 'Cable'],
    ['Rope Pushdown', 'Triceps', 'Cable'],
    ['Overhead Triceps Extension', 'Triceps', 'Dumbbell'],
    ['Skull Crusher', 'Triceps', 'Barbell'],
    ['Triceps Dip', 'Triceps', 'Bodyweight'],
    ['Triceps Kickback', 'Triceps', 'Dumbbell'],

    // Forearms
    ['Wrist Curl', 'Forearms', 'Barbell'],
    ['Reverse Wrist Curl', 'Forearms', 'Barbell'],
    ['Farmer’s Carry', 'Forearms', 'Dumbbell'],

    // Quads
    ['Back Squat', 'Quadriceps', 'Barbell'],
    ['Front Squat', 'Quadriceps', 'Barbell'],
    ['Hack Squat', 'Quadriceps', 'Machine'],
    ['Leg Press', 'Quadriceps', 'Machine'],
    ['Leg Extension', 'Quadriceps', 'Machine'],
    ['Bulgarian Split Squat', 'Quadriceps', 'Dumbbell'],
    ['Walking Lunge', 'Quadriceps', 'Dumbbell'],
    ['Goblet Squat', 'Quadriceps', 'Dumbbell'],
    ['Smith Machine Squat', 'Quadriceps', 'Machine'],

    // Hamstrings
    ['Romanian Deadlift', 'Hamstrings', 'Barbell'],
    ['Stiff-Leg Deadlift', 'Hamstrings', 'Barbell'],
    ['Lying Leg Curl', 'Hamstrings', 'Machine'],
    ['Seated Leg Curl', 'Hamstrings', 'Machine'],
    ['Nordic Curl', 'Hamstrings', 'Bodyweight'],
    ['Good Morning', 'Hamstrings', 'Barbell'],

    // Glutes
    ['Hip Thrust', 'Glutes', 'Barbell'],
    ['Glute Bridge', 'Glutes', 'Barbell'],
    ['Cable Kickback', 'Glutes', 'Cable'],
    ['Abduction Machine', 'Glutes', 'Machine'],
    ['Sumo Deadlift', 'Glutes', 'Barbell'],

    // Calves
    ['Standing Calf Raise', 'Calves', 'Machine'],
    ['Seated Calf Raise', 'Calves', 'Machine'],
    ['Leg Press Calf Raise', 'Calves', 'Machine'],

    // Abs
    ['Hanging Leg Raise', 'Abs', 'Bodyweight'],
    ['Cable Crunch', 'Abs', 'Cable'],
    ['Crunch', 'Abs', 'Bodyweight'],
    ['Machine Crunch', 'Abs', 'Machine'],
    ['Plank', 'Abs', 'Bodyweight'],
    ['Ab Wheel Rollout', 'Abs', 'Other'],
    ['Russian Twist', 'Abs', 'Bodyweight'],
    ['Decline Sit-Up', 'Abs', 'Bodyweight'],

    // Full body / cardio
    ['Clean and Jerk', 'Full Body', 'Barbell'],
    ['Power Clean', 'Full Body', 'Barbell'],
    ['Snatch', 'Full Body', 'Barbell'],
    ['Kettlebell Swing', 'Full Body', 'Kettlebell'],
    ['Burpee', 'Full Body', 'Bodyweight'],
    ['Treadmill', 'Cardio', 'Machine'],
    ['Stationary Bike', 'Cardio', 'Machine'],
    ['Rowing Machine', 'Cardio', 'Machine'],
    ['Elliptical', 'Cardio', 'Machine'],
    ['Stair Climber', 'Cardio', 'Machine'],
    ['Jump Rope', 'Cardio', 'Other']
  ];

  function slug(name) {
    return 'ex_' + name.toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // A handful of built-ins have no good public-domain demo photo (checked
  // against the free-exercise-db dataset) — they fall back to an initials avatar.
  var NO_IMAGE = { ex_pendlay_row: 1, ex_machine_row: 1, ex_nordic_curl: 1, ex_burpee: 1, ex_behind_the_back_cable_curl: 1 };

  // Muscles that do meaningful work but aren't the target — each set adds 0.5
  // to them. Deliberately conservative (e.g. pressing isn't credited to side
  // delts, rows aren't credited to rear delts).
  var SECONDARY = {
    'Bench Press': ['Triceps'], 'Incline Bench Press': ['Triceps'], 'Decline Bench Press': ['Triceps'],
    'Dumbbell Bench Press': ['Triceps'], 'Incline Dumbbell Press': ['Triceps'], 'Chest Press Machine': ['Triceps'],
    'Push-Up': ['Triceps'], 'Dip': ['Triceps'],
    'Deadlift': ['Hamstrings', 'Glutes'], 'Rack Pull': ['Glutes', 'Traps'], 'Back Extension': ['Glutes', 'Hamstrings'],
    'Barbell Row': ['Biceps'], 'Pendlay Row': ['Biceps'], 'T-Bar Row': ['Biceps'], 'Dumbbell Row': ['Biceps'],
    'Seated Cable Row': ['Biceps'], 'Machine Row': ['Biceps'], 'Lat Pulldown': ['Biceps'],
    'Wide-Grip Pulldown': ['Biceps'], 'Pull-Up': ['Biceps'], 'Chin-Up': ['Biceps'],
    'Overhead Press': ['Triceps'], 'Seated Dumbbell Press': ['Triceps'], 'Arnold Press': ['Triceps'],
    'Machine Shoulder Press': ['Triceps'], 'Upright Row': ['Traps'],
    'Close-Grip Bench Press': ['Chest'], 'Triceps Dip': ['Chest'], 'Hammer Curl': ['Forearms'],
    'Back Squat': ['Glutes'], 'Front Squat': ['Glutes'], 'Hack Squat': ['Glutes'], 'Smith Machine Squat': ['Glutes'],
    'Goblet Squat': ['Glutes'], 'Leg Press': ['Glutes'], 'Bulgarian Split Squat': ['Glutes'], 'Walking Lunge': ['Glutes'],
    'Romanian Deadlift': ['Glutes'], 'Stiff-Leg Deadlift': ['Glutes'], 'Good Morning': ['Glutes'],
    'Hip Thrust': ['Hamstrings'], 'Glute Bridge': ['Hamstrings'], 'Sumo Deadlift': ['Quadriceps', 'Hamstrings']
  };

  // Default rep ranges. Research (Schoenfeld 2017/2021) shows ~6–30 reps grow
  // muscle about equally when taken close to failure, so these are practical
  // choices: heavy compounds lower (fewer reps to fatigue-out on technique),
  // small-muscle / joint-friendly isolation higher.
  var HEAVY = ['Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Deadlift', 'Barbell Row', 'Pendlay Row',
    'Overhead Press', 'Back Squat', 'Front Squat', 'Romanian Deadlift', 'Sumo Deadlift', 'Rack Pull',
    'Close-Grip Bench Press', 'Hip Thrust', 'Hack Squat', 'Pull-Up', 'Chin-Up', 'T-Bar Row'];
  var HIGH = ['Lateral Raise', 'Cable Lateral Raise', 'Face Pull', 'Reverse Fly', 'Standing Calf Raise',
    'Seated Calf Raise', 'Leg Press Calf Raise', 'Crunch', 'Machine Crunch', 'Cable Crunch', 'Hanging Leg Raise',
    'Decline Sit-Up', 'Russian Twist', 'Wrist Curl', 'Reverse Wrist Curl', 'Abduction Machine', 'Cable Kickback'];
  var ISO = ['Dumbbell Fly', 'Cable Fly', 'Cable Fly Crossover', 'Butterfly (Pec Deck)', 'Leg Extension',
    'Lying Leg Curl', 'Seated Leg Curl', 'Front Raise', 'Straight-Arm Pulldown', 'Barbell Shrug', 'Dumbbell Shrug',
    'Upright Row'];
  function repRange(name, primary) {
    if (HEAVY.indexOf(name) >= 0) return [6, 10];
    if (HIGH.indexOf(name) >= 0) return [12, 20];
    if (ISO.indexOf(name) >= 0 || ['Biceps', 'Triceps', 'Forearms'].indexOf(primary) >= 0) return [10, 15];
    return [8, 12];
  }

  App.seed = {
    // Bump whenever RAW/NO_IMAGE data changes, so existing devices pick up
    // the update (see app.js boot — built-ins get merged, customs untouched).
    VERSION: 4,
    exercises: function () {
      return RAW.map(function (r) {
        var id = r[3] || slug(r[0]);
        var rr = repRange(r[0], r[1]);
        return {
          id: id,
          name: r[0],
          primary: r[1],
          secondary: SECONDARY[r[0]] || [],
          repMin: rr[0],
          repMax: rr[1],
          equipment: r[2],
          isCustom: false,
          // Cardio & carries are tracked as time/distance rather than reps.
          tracking: r[1] === 'Cardio' ? 'cardio' : 'weight',
          image: NO_IMAGE[id] ? null : 'img/exercises/' + id + '.jpg',
          createdAt: Date.now()
        };
      });
    }
  };
})();
