# MashLab

Measures how fast (and how evenly) someone can mash a single gamepad button.
Built for timing fast fighting-game animations, so results are shown in
milliseconds and in 60 fps frames.

Desktop app for macOS and Linux: Tauri 2 (Rust) + React/TypeScript.

## Run it

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm tauri build    # produce a .app/.dmg (macOS) or .deb/.AppImage (Linux)
```

Building needs `cmake` (SDL3 is compiled from source and linked statically, so
users don't need SDL installed). Linux also needs the Tauri prerequisites
(https://tauri.app/start/prerequisites/) plus `libudev-dev`, and your user needs
read access to `/dev/input/event*` (usually via the `input` group).

`cargo run --example padprobe 30` (in `src-tauri/`) prints raw controller events
with timestamps, which is useful when a controller doesn't register.

`pnpm dev` alone serves the UI in a browser with a fake backend and sample data
(`src/lib/mock.ts`), which is handy for UI work without a controller.

## How timing works

- Controller input is read with [SDL3] on a dedicated Rust thread (on macOS SDL
  uses Apple's GameController framework, which is the only way to read wired
  Xbox Series controllers there). SDL stamps each event with a monotonic
  nanosecond clock when it reads the device, and the thread polls about every
  0.5 ms, so polling adds at most about 0.5 ms on top of OS/driver delivery.
- Analog triggers (LT/RT) count as presses past 30% travel, and release below 20%.
- The test state machine (`src-tauri/src/input.rs`) runs entirely on that thread.
  The webview only displays results, so rendering and IPC never affect measurements.
- The first button pressed after "Start" locks the run to that button on that
  controller; every other input is ignored.
- Timed runs keep presses that land inside the window (the clock starts at the
  first press). Count runs end on the Nth press.
- Accuracy is ultimately limited by the controller's report rate: typically 1–8 ms
  wired, and worse and more variable over Bluetooth. Use wired for serious numbers.

## Metrics

| Metric | Meaning |
|---|---|
| Avg interval (score) | Mean time between consecutive presses. Lower is better. Ranks bests and the scoreboard. |
| Consistency | `100 × (1 − σ/mean)`. 100 means every interval was identical. |
| Best 10-press stretch | Fastest mean over any 10 consecutive intervals. |
| Avg hold | Mean time between button down and button up. |

Runs need at least 5 intervals to count toward bests and the scoreboard.

## Data

SQLite at the OS app-data dir (`~/Library/Application Support/com.buttons.mashlab/mashlab.sqlite3`
on macOS, `~/.local/share/com.buttons.mashlab/` on Linux). Every raw press and
release is stored per run (`run_events`), so new analytics can be computed later
from existing runs.

## Layout

```
src-tauri/src/
  input.rs   gamepad thread + test state machine
  stats.rs   run statistics (unit tested)
  db.rs      SQLite schema and queries
  lib.rs     Tauri commands
src/
  tabs/      Test, Runs, Analytics
  components/charts.tsx, ui.tsx
  lib/api.ts typed bindings to the Rust commands/events
```

[SDL3]: https://wiki.libsdl.org/SDL3/CategoryGamepad
