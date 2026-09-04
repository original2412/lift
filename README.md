# Lift — workout tracker (HEVY-style, no social)

A private, mobile-first PWA for logging strength workouts: routines, a live
workout screen with rest timers, workout history, personal records and progress
charts. All data stays on the device (localStorage). No account, no server, no
social feed.

## Feature summary

| Area | What's in |
| --- | --- |
| **Routines** | Create/edit/duplicate/delete routines, per-exercise target sets (weight × reps), set types (normal / warm-up / drop / fail), per-exercise rest timer, notes, reorder. |
| **Live workout** | Start empty or from a routine. Per-set weight/reps entry, tap ✓ to complete, auto rest-timer countdown (−15 / +15 / skip), "previous session" hint per set, add sets/exercises mid-workout, replace/reorder/remove, screen-wake-lock, elapsed timer, resume-after-reload. |
| **PRs** | Live PR flags during a set (est. 1RM, top weight) and an end-of-workout summary of new records (1RM / weight / session volume). |
| **History** | All finished workouts grouped by month, full set breakdown with per-set estimated 1RM, rename / note / delete. |
| **Exercises** | ~95 built-in exercises with muscle group + equipment, search + muscle filter, add/edit/delete custom exercises, per-exercise page with 1RM chart, volume chart and full history. |
| **Stats** | Totals, weekly-volume bar chart (12 wk), working sets by muscle (30 d), day streak, body-measurement tracking (bodyweight, waist, chest, arm, thigh) with charts. |
| **Settings** | kg/lb units (converts everything), default rest timer, dark/light theme, wake-lock toggle, notification permission, JSON export / import (merge or replace), restore default exercises, erase all data. |

## Run it locally

No build step. Any static file server works. Two options:

```bash
# Perl (bundled with Git for Windows) — used during development
perl tools/serve.pl 8123 .
# then open http://localhost:8123
```

```bash
# or, if you install Node later
npx serve .
```

Opening `index.html` straight from disk (`file://`) mostly works, but the service
worker and "Add to Home Screen" only activate over `http(s)`.

## Deploy (so it installs on your phone)

It's plain static files — deploy the whole folder to any static host:

- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder, or connect a git repo. Zero config.
- **GitHub Pages** — push to a repo, enable Pages on the branch root.

Once it's on an `https://` URL, open it in mobile Chrome/Safari → *Share* →
*Add to Home Screen*. It then runs full-screen and offline like a native app.

### PWA icons

`icons/icon.svg` (+ maskable variant) is referenced by `manifest.webmanifest`.
Chrome/Android accept SVG icons. For the best iOS home-screen icon, add a
180×180 PNG at `icons/icon-180.png` and re-add the `apple-touch-icon` line in
`index.html`.

## Data & backups

Everything lives in `localStorage` under the `lift.v1.*` keys, scoped to the
origin you host it on. It never leaves the device. Use **Settings → Export
backup** regularly; **Import** can merge or replace. Moving to a new phone =
export on the old one, import on the new one.

## Project layout

```
index.html                 app shell + bottom nav
manifest.webmanifest        PWA manifest
sw.js                       service worker (offline app-shell cache)
css/styles.css              all styling (dark + light tokens)
js/
  utils.js                  formatting, dates, 1RM math, units
  db.js                     localStorage-backed store + import/export
  seed.js                   built-in exercise library
  store.js                  data operations + derived stats / PR logic
  ui.js                     DOM builder, bottom sheet, menu, confirm, toast
  charts.js                 inline-SVG line + bar charts
  router.js                 hash router
  views/                    one file per screen
    home.js  routine-edit.js  workout.js  history.js
    exercises.js  stats.js  settings.js
  app.js                    boot, theme, unit helpers, resume bar
tools/serve.pl              tiny static server for local preview
```

## Notes / possible next steps

- Optional cloud sync (e.g. a small Supabase backend) if you ever want
  phone↔desktop without manual export/import.
- Plate calculator, 1RM calculator screen, supersets, RPE column.
- Hebrew / RTL UI.
