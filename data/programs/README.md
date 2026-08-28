# Preset programs

A preset is a published training program expressed as data. It is **not**
generated — no `generate()`, no `chooseSplit()`, no `score()`. A preset is
expanded into a `Program` (see `js/engine/SPEC.md`) by `expandPreset()`, and
from there it is an ordinary program: renderable, editable, exportable to
FitNotes.

## What belongs in this directory

`example-*.json` — templates authored for this repo, committed, used as test
fixtures.

Everything else here is **gitignored on purpose**. See the copyright note below.

## Copyright

The sets, reps and loads of a published program are facts. The *selection*,
*sequencing* and *progression* are the author's expressive work, and encoding a
copyrighted program into `hiit-100.json` and pushing it to a public repository
is redistribution.

So: the **mechanism** ships, the **templates** do not. A template you have
lawful access to sits in this directory, is ignored by git, and never leaves
your machine. `.gitignore` enforces that rather than relying on care during
`git add -A`.

If you author a program yourself, or it is genuinely public domain, name it
`example-*.json` and it will be tracked.

## Template format

Compact, because published programs are repetitive. A six-week, six-day program
is 36 sessions but usually six day-templates plus a rest schedule.

```jsonc
{
  "id": "example-6wk",
  "name": "Example 6-Week Block",
  "weeks": 6,

  // Weekday pattern. REQUIRED: toFitNotesCSV() throws without a schedule,
  // because a plan with no schedule has no dates.
  "schedule": ["mon", "tue", "wed", "thu", "fri", "sat"],

  // Optional per-week overrides applied to every setGroup carrying the
  // matching tag. In the worked example the rest schedule IS the progression:
  // sets, reps and load never move across the six weeks.
  "restByWeek": { "anchor": [60, 50, 40, 30, 20, 10] },

  "days": [
    {
      "label": "Day 1 — Chest / Back / Abs",
      "setGroups": [
        {
          "exerciseId": "barbell-bench-press",
          "sets": 10, "reps": 10,
          "restTag": "anchor",
          "loadNote": "50% of 10RM"
        },
        {
          "exerciseId": "barbell-bench-press",
          "sets": 3, "reps": 10, "restSeconds": 60,
          "loadNote": "10RM to failure; last set drop to 50% and rep out"
        }
      ]
    }
  ]
}
```

### Rules

- `exerciseId` must exist in the catalog. An unknown id is a hard error, never
  a silent drop.
- The same `exerciseId` may appear twice in one day. That is a legitimate
  prescription (a high-set protocol followed by heavy work on the same lift),
  not a bug — the generator's `usedIds` guard does not apply here.
- `loadNote` is printed verbatim in the FitNotes Notes column and bypasses the
  `anchorable` gate in `fitnotes-export.js`. That gate is correct for generated
  programs, where a percentage against a lift with no measurable max is a
  percentage of nothing (ADR-023). A preset inverts the premise: the load is
  authored, so it is stated.
- Days are enumerated in order. There is no split, no `patternEmphasis`, and no
  emphasis-ordered selection pass.

## Using one

Drop the file here, pick it in the app, choose a start date, export. Individual
sessions can be moved in the date preview without shifting the block (#54).

## Known rough edge

`weeklyVolume()` counts every set equally against the landmarks. A protocol
built on high-set back-off work at half the working load will read as far past
MRV when it is not — the landmarks assume sets taken near failure. The volume
panel reports, never enforces, so this is a false alarm rather than a block.
