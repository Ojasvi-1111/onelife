# OneLife

A personal goal board for one person on one iPad. Every active goal is a floating box. The app arranges the boxes and sizes each one by urgency. One tap records progress. All data stays on the iPad.

## Using it

- **Address:** `https://YOUR-USERNAME.github.io/onelife/`
- **Install:** open the address in Safari on the iPad, tap Share, then Add to Home Screen, and keep Open as Web App on.
- **Add goals only in the installed app.** Safari and the installed app keep separate data.
- **Removing the app from the Home Screen deletes its data.** Export a backup first.
- **Backup:** Settings, then Export backup, then Save to Files. This file is the only copy of your goals outside the iPad. Do it regularly.

## Changing it

The app is plain HTML, CSS and JavaScript. There is no build step: GitHub Pages serves the files exactly as they are in this repo.

1. Edit or replace a file on GitHub and commit.
2. Wait for the green tick on the newest commit. Red marks on older commits only mean a newer commit replaced them.
3. Fully close OneLife on the iPad and open it again. It picks up new files when it starts with a connection. Settings also has a Reload app button.

When asking an AI tool for a change:

- Give it this README and the files that the change touches.
- Ask for whole-file replacements, one file per message.
- Ask it to leave the logic files alone unless the change is about the rules, and to keep `test.html` passing.
- Test on the iPad after each file.

## Testing

- **Self-test:** open `/onelife/test.html` in Safari. It should say all 138 checks passed. It covers the rules: days, sessions, missed and owed, urgency, layout.
- **Clock override:** add `?now=2026-11-13T18:40` to the address in Safari to see the app at another time. This runs in Safari, so it shows Safari's data, not the installed app's.
- **Icon maker:** `/onelife/icon.html` redraws the three icon files.

## File map

| File | What it does |
|---|---|
| `index.html` | The page. Also holds the look: one style block that restyles everything |
| `manifest.webmanifest`, `sw.js` | Install details, and the offline cache (network first, saved copy as fallback) |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | App icons |
| `icon.html`, `test.html` | Icon maker and self-test page |
| `css/base.css` | Page frame, header, bottom bar, toast |
| `css/board.css` | Goal boxes |
| `css/sheets.css` | Sheets, inputs, buttons, the goal form |
| `css/screens.css` | Goal detail, Done, Settings, motion settings |
| `js/app.js` | Start-up, switching screens, wiring |
| `js/store.js`, `js/db.js` | The data in memory and in the iPad's database |
| `js/time.js`, `js/sessions.js`, `js/dayclose.js`, `js/urgency.js`, `js/layout.js` | The rules. Pure logic, covered by the self-test |
| `js/board.js` | The Board and its boxes |
| `js/form.js`, `js/detail.js` | Goal form and goal detail |
| `js/actions.js` | Everything you can do to a goal: tick, make up, skip, finish, drop, undo |
| `js/celebrate.js` | Power surge, sounds, the goal-finished card |
| `js/done.js`, `js/settings.js`, `js/backup.js` | Done screen, Settings, export and import |
| `js/ink.js` | Handwriting: the writing pad and drawing saved ink |
| `js/ui.js`, `js/icons.js` | Shared helpers and icons |
| `js/tests.js` | The checks behind `test.html` |

## Not built

- Notifications or alerts of any kind, accounts, sync, a server.
- A light theme. The app is dark only.
- A separate "restart to update" step. Updates apply on the next start with a connection.
- Handwriting recognition. The app cannot read handwriting as text.

---

# Master spec (as built)

This describes the app as it exists in this repo.

## 1. Scope

- An installable, offline web app for iPad with three screens (Board, Done, Settings) and two sheets (Goal form, Goal detail), plus a handwriting pad.
- Target: iPadOS 18.4 or later, installed to the Home Screen. Works in landscape, portrait and resized windows.
- No requests leave the app's own address.

## 2. Platform rules

1. The service worker tries the network first and falls back to the saved copy after 3 seconds or when offline. After one slow answer it serves saved copies first for a minute and refreshes in the background.
2. The app never runs in the background. On start, on every return to the foreground, and once a minute while visible, it runs day close (section 5), recomputes urgency and redraws.
3. Loads, writes and day closes run strictly one after another through one queue in `store.js`, so they can never interleave.
4. The memory copy changes only after the database write has succeeded.
5. Taps use click events only. After a tick on a goal, further ticks on it are ignored for 500 ms.
6. The keyboard only opens when focus happens inside the tap, so the + button focuses the title field in that same tap. Sheets resize to stay above the keyboard.
7. Day arithmetic is done on calendar parts. A day string is never parsed with `new Date(string)`, and 24 hours in milliseconds is never used to step between days.
8. Storage persistence is requested at start. Keep-awake uses the screen wake lock and is re-requested on return to the foreground.
9. Export goes through the share sheet on touch devices and falls back to a download elsewhere.

## 3. Data model

```ts
type Day = string;   // 'YYYY-MM-DD', a logical day in local time
type HHMM = string;  // '07:00', 24-hour

interface Goal {
  id: string;
  title: string;                    // 1-80 chars; 'Handwritten goal' when only handwritten
  notes: string;
  color: number;                    // 0-7, the goal's colour tag
  importance: 1 | 2 | 3 | 4 | 5;    // default 3
  status: 'active' | 'finished' | 'dropped';
  createdAt: string;                // ISO timestamp
  finishedAt: string | null;
  scheduleSetAt: string;            // creation, then every change to run or repeat
  run: { start: Day | null; end: Day | null };
  repeat:
    | { mode: 'none' }
    | { mode: 'days'; slots: DaySlot[]; sessionMinutes: number | null }
    | { mode: 'perWeek'; times: number; sessionMinutes: number | null };
  measure:
    | { type: 'check' }
    | { type: 'steps'; steps: { id: string; text: string }[] }
    | { type: 'number'; target: number; unit: string; startValue: number };
  inkTitle: Ink | null;             // handwritten title
  inkNote: Ink | null;              // handwritten note
}
interface DaySlot { weekday: 0|1|2|3|4|5|6; start: HHMM | null; end: HHMM | null } // 0 = Sunday
interface Ink { w: number; h: number; strokes: number[][] }  // each stroke is x, y, x, y, ...

interface Entry {
  id: string;
  goalId: string;
  day: Day;                 // logical day it counts for
  at: string;               // ISO timestamp it was recorded
  kind: 'done' | 'missed' | 'skipped' | 'makeup' | 'step' | 'number' | 'finished';
  minutes: number;
  value?: number;           // kind 'number'
  stepId?: string;          // kind 'step'
  clearsEntryId?: string;   // kind 'makeup': the missed entry it clears
}

interface Settings {
  quote: string;                                 // shown under the name; empty hides it
  minBox: 'compact' | 'comfortable' | 'large';
  motion: 'full' | 'calm' | 'off';
  sound: boolean;
  surge: boolean;                                // the power surge effect
  keepAwake: boolean;
  dayCutoff: HHMM;                               // default '04:00', allowed 00:00-06:00
  backupReminderDays: 0 | 7 | 14 | 30;
  lastBackupAt: string | null;
  lastClosedDay: Day | null;
  installBannerDismissed: boolean;
  doneTab: 'wall' | 'wins' | 'calendar';
  schemaVersion: number;
}
```

- `run`: both empty means no dates. Start only means forever. Start and end means a fixed run, inclusive. A goal that repeats always has a start.
- A slot has both times (a clock slot) or neither (any time that day).
- Slot times are positions inside the logical day, which runs from the day cut-off to the next cut-off. A slot may cross midnight but never the cut-off.
- Entries are the only record of progress. A step is ticked when a `step` entry with its id exists. A number's current value is `startValue` plus the sum of its `number` entries.

## 4. Time and sessions

- The logical day of a moment is the calendar date of that moment minus the cut-off. With 04:00, 02:30 on the 14th belongs to the 13th. Weeks run Monday to Sunday.
- A goal's first day is `run.start`, or its creation day. It is live from its first day to `run.end`. Upcoming means today is before the first day.
- Set-up day: the logical day of `scheduleSetAt`. Creating or rescheduling a goal never causes a miss for that day.
- Mode `days`: a session is scheduled on each live day whose weekday has a slot. On the set-up day, a clock slot that had already ended is not scheduled.
- Mode `perWeek`: n = live days in the week after the set-up day. Base requirement = round(times x n / 7). Required = base minus skips. Need = required minus done. One tick a day.

## 5. Day close, owed time, skips, rates

- Day close runs for every day between the last closed day and yesterday. It is safe to run twice.
- Mode `days`: a scheduled session with no done, skipped or missed entry gets a `missed` entry, except on the set-up day.
- Mode `perWeek`: on a Sunday, or on the goal's end date, `missed` entries are added until the week's missed count equals its need.
- If one run closes 3 or more days, the app offers to excuse those days.
- A missed entry is owed until a `makeup` entry points at it. Make up one clears the oldest.
- In goal detail a missed entry can become done ("I did it") or skipped ("Excused"). Missed entries cannot be deleted.
- A skipped session is never owed and is left out of every rate.
- There are no streaks. The week line is "X of Y this week", counted from recorded entries for past days. The 30-day rate is done plus made-up, divided by done plus all missed.

## 6. Goal life cycle

- **Complete:** active, started, nothing owed, not a repeating goal without an end date, and one of: all steps ticked, number at target, or a repeating tick-only goal whose run has ended.
- **Overdue:** the end date has passed and the goal is active and not complete. It stays on the Board until finished, extended, dropped or deleted.
- **Finish:** the goal leaves the Board and joins the Done wall.
- **Auto-finish:** a goal that does not repeat finishes at once when a tap completes it.
- **Drop:** leaves the Board, keeps its past wins, and is listed in Settings with Restore and Delete.
- **Reopen:** from the Done wall, back to active.

## 7. Urgency

All terms run 0 to 1.

- I = (importance - 1) / 4.
- S, today's session: before a clock slot, 1 - minutesToStart / 180, never below 0. During the slot, 1. After it, still unticked, 0.85. Any-time session: 0.35 + 0.5 x fraction of the day elapsed. Weekly: 0.85 x min(1, need / live days left this week).
- P, pace: with sessions owed, min(1, 0.55 + 0.15 x owed sessions). For steps or numbers with a fixed run: twice the gap between the share of the run elapsed and the share done, measured from the later of the start date and the creation day.
- D, deadline: only with an end date and open work. 1 when due or past, otherwise 1 / (1 + daysLeft / 3).
- T = max(S, P, D). Complete goals use max(S, 0.8). Upcoming goals use 0.
- U = 0.7 x T + 0.3 x I, rounded to the nearest 0.05. Layout uses the rounded value.

## 8. Board layout

- No box is ever smaller than the floor: Compact 156 x 104, Comfortable 180 x 120, Large 208 x 139. Boxes are 3:2. When space runs out the Board scrolls.
- Largest width = the smallest of 420, the larger of 0.36 x board width and 1.6 x floor width, board width - 52, and 1.5 x (visible height - 52).
- Width = floor + (largest - floor) x urgency.
- Boxes may cover at most half the Board. If they would cover more, all shrink toward the floor by one factor.
- Placement is deterministic: sort by urgency, importance, creation time, id. The first box goes in the centre of the first screenful. Each next box walks a spiral outward and takes the first spot with a 26 px gap to other boxes and a 26 px margin to the edges.
- The same data, time and window size always give the same layout.
- Boxes drift a few pixels on a slow loop. Motion setting: Full, Calm, Off. After 3 minutes without a touch the drift calms.

## 9. The box

- **Colour:** a heat scale by urgency, from blue through violet and pink to red.
- **Looks:** owed or overdue is red at full brightness. A repeating goal with nothing waiting, owed or complete dims to cool blue. Upcoming is grey and dashed. A session running right now gets a spinning rainbow border.
- **Glow:** breathes, faster and brighter with urgency.
- **Title:** the typed name, or the handwriting when the goal has it. Never below 17 px. Other box text never below 14 px.
- **Status line:** the first that applies of: upcoming, overdue, owed, session running, slot ahead, slot passed, any-time or weekly session waiting, complete, done or skipped today, end date, next session, progress. Each has a long and a short form, chosen by measuring what fits.
- **Wider boxes** add a progress line, then a second status line and a seven-day strip.
- **Tick square** does the first that applies: mark today's session done, make up one owed session, finish a complete goal, then (only if the goal does not repeat or its run has ended) tick the next step or add 1, then finish a non-repeating tick-only goal. Hidden for upcoming goals.
- Tapping the box anywhere else opens goal detail.

## 10. Goal form

- One page. A title alone is enough: no dates, no repeat, tick-only, importance 3.
- Return saves from the title field, adds the next step from a step field, and does nothing elsewhere.
- **When:** No dates, Fixed dates, Forever.
- **Time slot:** None, Same time daily, Chosen weekdays, Different per day, No fixed time (every day, chosen weekdays, or N times a week). Choosing a slot switches When to Forever.
- **Measure:** Just done, Steps, Number. Locked once progress is recorded.
- **Importance** 1 to 5, **Colour tag**, **Notes**.
- **Handwriting:** the title and a note can each be written by hand.
- A changed schedule counts from now.

## 11. Goal detail

- Title, dates and slot in words, status.
- Actions that apply: done for today, make up one session, excuse all owed, skip, finish.
- Importance, editable in place.
- Steps checklist, or number with -1, +1 and "Add".
- Stats: week line, 30-day rate, time logged, owed.
- Notes, typed and handwritten. The handwritten note can be written, edited or removed here.
- History: a 14-day strip and the entries. Entries can be deleted, minutes edited, missed days corrected, and a past day logged.
- Edit, Drop, Delete. Overdue goals can extend their end date.

## 12. Celebration and undo

- Every win: the box flashes and rings of light spread across the screen, with a short chime.
- Finishing a goal: three surges, a longer rising chime, and a "Goal finished" card with the goal's totals.
- Sound and the surge each have a switch in Settings.
- Every action shows a message for 6 seconds with Undo. Only the latest action can be undone.

## 13. Done screen

- **Wall:** finished goals as neon signs, newest first, with the finish date and totals. Tap a sign for Reopen and Delete.
- **Wins:** every win grouped by day, newest first.
- **Calendar:** a month grid shaded by the number of wins per day. Tap a day to list its wins.
- A win is a done session, a make-up, a ticked step, a number increase, or a finished goal.

## 14. Settings and backup

- **Backup:** Export backup (one JSON file with settings, goals and history), Import backup, Export spreadsheet (two CSV files), reminder every 7, 14 or 30 days or never.
- **Import** checks the whole file first and changes nothing if it is not a sound OneLife backup. After a restore, the days between the export and now are never marked missed. Damaged handwriting is dropped, never the whole backup.
- **Look:** Quote, Smallest box, Motion.
- **Behaviour:** Day ends at (00:00 to 06:00), Sound, Power surge, Keep screen awake. A cut-off change is refused while any goal has a clock slot between the old and the new time.
- **Dropped goals**, **Sample goals**, **Erase everything** (type ERASE), **About** with Reload app.

## 15. Handwriting

- The pad takes the Apple Pencil or a finger. Once a Pencil has been used, finger touches are ignored so the palm leaves no marks.
- Ink is stored as pen strokes, not as a picture, in a space 1000 units wide. The title page is 4:1 and the note page is 4:3.
- A goal with only a handwritten title is named "Handwritten goal" wherever plain text is needed, such as the small messages and the spreadsheet.
- Handwriting is shown on the box, in goal detail, on the Done wall and in the wins lists.

## 16. Look

- Dark only. Near-black with a cyan glow from the top left, a pink glow from the bottom right, and film grain.
- Rounded glowing cards, cyan highlights, gradient primary buttons, small capital-letter labels in a monospace face.
- The OneLife name is large and neon green. The quote sits under it.
- The whole look is one style block at the end of `index.html`. It comes after the four css files and overrides them.

## 17. Checks

1. `test.html` says all 138 checks passed.
2. With the network off after the first load, the installed app starts and every feature works.
3. Tapping + opens the keyboard. A title and Return creates a goal.
4. No box is smaller than the floor, no boxes overlap, and no status text is cut mid-word.
5. A session not ticked by the cut-off shows as missed on the next start. One make-up tap clears one.
6. A goal set up late in the day gets no miss for that day.
7. Every tick can be undone, and a fast double tap acts once.
8. Export, Erase everything, then Import restores identical goals, history and handwriting.
