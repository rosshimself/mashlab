//! Controller input thread and the test state machine.
//!
//! Input comes from SDL3 (Apple's GameController framework on macOS, evdev/HIDAPI
//! on Linux). SDL stamps each event with its monotonic nanosecond clock when the
//! device state is read, so this thread polls SDL roughly every 0.5 ms to keep
//! that stamp close to when the controller actually reported. All timing and the
//! test state machine live on this thread; the UI only displays what it reports,
//! so webview rendering and IPC latency never affect measured intervals.

use crate::db::{InputEvent, Mode, NewRun};
use crate::stats;
use crate::AppState;
use sdl3_sys::everything::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::CStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Extra time after a timed run's deadline to let in-flight events arrive.
const DEADLINE_GRACE_MS: f64 = 30.0;
/// An armed or running test is abandoned after this long without a press.
const IDLE_TIMEOUT_MS: f64 = 10_000.0;
/// How long the input thread sleeps between SDL polls.
const POLL_INTERVAL: Duration = Duration::from_micros(500);
/// Analog triggers count as pressed above this fraction of travel, and released
/// below the lower one (hysteresis avoids chatter around a single threshold).
const TRIGGER_DOWN: i16 = (32767.0 * 0.30) as i16;
const TRIGGER_UP: i16 = (32767.0 * 0.20) as i16;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TestConfig {
    pub mode: Mode,
    /// Seconds for `Mode::Time`, presses for `Mode::Count`.
    pub target: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Controller {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum Phase {
    Idle,
    /// Waiting for the first press, which picks the button.
    Armed { config: TestConfig },
    Running {
        config: TestConfig,
        button: String,
        controller: String,
    },
}

#[derive(Debug, Clone, Serialize)]
struct LivePress {
    n: usize,
    t_ms: f64,
    interval_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunFinished {
    pub run_id: Option<i64>,
    pub summary: Option<crate::db::RunSummary>,
    pub previous_best_ms: Option<f64>,
    pub reason: Option<String>,
}

struct ActiveRun {
    config: TestConfig,
    profile_id: i64,
    gamepad: u32,
    button: &'static str,
    controller: String,
    started_at: SystemTime,
    /// SDL tick time of the first press, in ms.
    t0_ms: f64,
    last_press_ms: f64,
    presses: Vec<f64>,
    releases: Vec<f64>,
}

enum State {
    Idle,
    Armed { config: TestConfig, profile_id: i64, armed_at_ms: f64 },
    Running(ActiveRun),
}

pub struct Engine {
    state: State,
    controllers: Vec<Controller>,
}

pub type SharedEngine = Arc<Mutex<Engine>>;

fn epoch_ms(t: SystemTime) -> f64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

fn ticks_ms() -> f64 {
    unsafe { SDL_GetTicksNS() as f64 / 1e6 }
}

/// Stable name for an SDL gamepad button (positional, layout-independent).
/// These are stored with each run; the UI maps them to per-layout glyphs.
fn button_name(b: u8) -> &'static str {
    match b {
        0 => "South",
        1 => "East",
        2 => "West",
        3 => "North",
        4 => "Select",
        5 => "Mode",
        6 => "Start",
        7 => "LeftThumb",
        8 => "RightThumb",
        9 => "LeftTrigger",
        10 => "RightTrigger",
        11 => "DPadUp",
        12 => "DPadDown",
        13 => "DPadLeft",
        14 => "DPadRight",
        15 => "Misc1",
        16 => "RightPaddle1",
        17 => "LeftPaddle1",
        18 => "RightPaddle2",
        19 => "LeftPaddle2",
        20 => "Touchpad",
        _ => "Misc",
    }
}

impl Engine {
    pub fn new() -> SharedEngine {
        Arc::new(Mutex::new(Engine { state: State::Idle, controllers: Vec::new() }))
    }

    pub fn phase(&self) -> Phase {
        match &self.state {
            State::Idle => Phase::Idle,
            State::Armed { config, .. } => Phase::Armed { config: *config },
            State::Running(r) => Phase::Running {
                config: r.config,
                button: r.button.to_string(),
                controller: r.controller.clone(),
            },
        }
    }

    pub fn controllers(&self) -> Vec<Controller> {
        self.controllers.clone()
    }

    pub fn arm(&mut self, config: TestConfig, profile_id: i64) {
        self.state = State::Armed { config, profile_id, armed_at_ms: ticks_ms() };
    }

    pub fn cancel(&mut self) {
        self.state = State::Idle;
    }
}

/// Outcome of feeding one event or tick into the state machine.
enum Step {
    None,
    PhaseChanged,
    Press(LivePress),
    Finished(ActiveRun),
    Abandoned(String),
}

/// `t_ms` is the SDL event timestamp in ms.
fn on_button(eng: &mut Engine, gamepad: u32, controller: &str, button: &'static str, pressed: bool, t_ms: f64) -> Step {
    match &mut eng.state {
        State::Idle => Step::None,
        State::Armed { config, profile_id, .. } => {
            if !pressed {
                return Step::None;
            }
            eng.state = State::Running(ActiveRun {
                config: *config,
                profile_id: *profile_id,
                gamepad,
                button,
                controller: controller.to_string(),
                started_at: SystemTime::now(),
                t0_ms: t_ms,
                last_press_ms: t_ms,
                presses: vec![0.0],
                releases: Vec::new(),
            });
            Step::PhaseChanged
        }
        State::Running(run) => {
            // Only the button that started the run counts.
            if run.gamepad != gamepad || run.button != button {
                return Step::None;
            }
            let rel = t_ms - run.t0_ms;
            if run.config.mode == Mode::Time && rel > run.config.target as f64 * 1000.0 {
                return Step::None;
            }
            if !pressed {
                run.releases.push(rel);
                return Step::None;
            }
            let prev = *run.presses.last().unwrap();
            run.presses.push(rel);
            run.last_press_ms = t_ms;
            let live = LivePress { n: run.presses.len(), t_ms: rel, interval_ms: Some(rel - prev) };
            if run.config.mode == Mode::Count && run.presses.len() >= run.config.target as usize {
                let State::Running(run) = std::mem::replace(&mut eng.state, State::Idle) else { unreachable!() };
                return Step::Finished(run);
            }
            Step::Press(live)
        }
    }
}

fn on_tick(eng: &mut Engine, now_ms: f64) -> Step {
    match &eng.state {
        State::Idle => Step::None,
        State::Armed { armed_at_ms, .. } => {
            if now_ms - armed_at_ms > IDLE_TIMEOUT_MS * 3.0 {
                eng.state = State::Idle;
                return Step::Abandoned("No button pressed — test cancelled.".into());
            }
            Step::None
        }
        State::Running(run) => {
            let timed_out = run.config.mode == Mode::Time
                && now_ms >= run.t0_ms + run.config.target as f64 * 1000.0 + DEADLINE_GRACE_MS;
            let idle = now_ms - run.last_press_ms > IDLE_TIMEOUT_MS;
            if timed_out || idle {
                let State::Running(run) = std::mem::replace(&mut eng.state, State::Idle) else { unreachable!() };
                if idle && run.config.mode == Mode::Count {
                    return Step::Abandoned("Stopped pressing — run discarded.".into());
                }
                return Step::Finished(run);
            }
            Step::None
        }
    }
}

fn save_run(app: &AppHandle, run: ActiveRun) -> RunFinished {
    let Some(stats) = stats::compute(&run.presses, &run.releases) else {
        return RunFinished {
            run_id: None,
            summary: None,
            previous_best_ms: None,
            reason: Some("Not enough presses to measure an interval.".into()),
        };
    };

    let mut events: Vec<InputEvent> = run
        .presses
        .iter()
        .map(|&t| InputEvent { pressed: true, t_ms: t })
        .chain(run.releases.iter().map(|&t| InputEvent { pressed: false, t_ms: t }))
        .collect();
    events.sort_by(|a, b| a.t_ms.total_cmp(&b.t_ms));

    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let new_run = NewRun {
        profile_id: run.profile_id,
        started_at: epoch_ms(run.started_at) as i64,
        mode: run.config.mode,
        target: run.config.target,
        button: run.button,
        controller: &run.controller,
        stats: &stats,
        events: &events,
    };
    match db.insert_run(&new_run) {
        Ok(id) => {
            let previous_best_ms = db.best_mean_interval(run.profile_id, id).ok().flatten();
            let summary = db.run_detail(id).ok().flatten().map(|d| d.summary);
            RunFinished { run_id: Some(id), summary, previous_best_ms, reason: None }
        }
        Err(e) => RunFinished {
            run_id: None,
            summary: None,
            previous_best_ms: None,
            reason: Some(format!("Failed to save run: {e}")),
        },
    }
}

unsafe fn sdl_error() -> String {
    unsafe { CStr::from_ptr(SDL_GetError()).to_string_lossy().into_owned() }
}

/// Open gamepads, keyed by SDL joystick instance id.
struct Pads {
    open: HashMap<u32, (*mut SDL_Gamepad, String)>,
    /// Trigger pressed state per (pad, axis), for hysteresis.
    triggers: HashMap<(u32, u8), bool>,
}

impl Pads {
    fn add(&mut self, id: SDL_JoystickID) {
        unsafe {
            let pad = SDL_OpenGamepad(id);
            if pad.is_null() {
                eprintln!("failed to open gamepad {}: {}", id.0, sdl_error());
                return;
            }
            let name = SDL_GetGamepadName(pad);
            let name = if name.is_null() { "Gamepad".into() } else { CStr::from_ptr(name).to_string_lossy().into_owned() };
            self.open.insert(id.0, (pad, name));
        }
    }

    fn remove(&mut self, id: SDL_JoystickID) {
        if let Some((pad, _)) = self.open.remove(&id.0) {
            unsafe { SDL_CloseGamepad(pad) };
        }
        self.triggers.retain(|(p, _), _| *p != id.0);
    }

    fn name(&self, id: u32) -> String {
        self.open.get(&id).map(|(_, n)| n.clone()).unwrap_or_default()
    }

    fn list(&self) -> Vec<Controller> {
        let mut v: Vec<_> = self.open.iter().map(|(&id, (_, name))| Controller { id, name: name.clone() }).collect();
        v.sort_by_key(|c| c.id);
        v
    }

    /// Turns trigger axis motion into press/release transitions.
    fn trigger(&mut self, pad: u32, axis: u8, value: i16) -> Option<(&'static str, bool)> {
        let name = match axis {
            4 => "LeftTrigger2",
            5 => "RightTrigger2",
            _ => return None,
        };
        let down = self.triggers.entry((pad, axis)).or_insert(false);
        if !*down && value >= TRIGGER_DOWN {
            *down = true;
            Some((name, true))
        } else if *down && value <= TRIGGER_UP {
            *down = false;
            Some((name, false))
        } else {
            None
        }
    }
}

pub fn spawn(app: AppHandle, engine: SharedEngine) {
    std::thread::Builder::new()
        .name("gamepad-input".into())
        .spawn(move || unsafe {
            // We have no SDL window, so without this SDL would treat the app as
            // unfocused and drop controller input.
            SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, c"1".as_ptr());
            if !SDL_Init(SDL_INIT_GAMEPAD) {
                eprintln!("SDL gamepad init failed: {}", sdl_error());
                return;
            }
            let mut pads = Pads { open: HashMap::new(), triggers: HashMap::new() };
            let mut ev = SDL_Event::default();

            loop {
                let mut steps = Vec::new();
                let mut controllers_changed = false;
                SDL_PumpEvents();
                while SDL_PollEvent(&mut ev) {
                    let ty = SDL_EventType(ev.r#type);
                    // (pad, button, pressed, timestamp ms)
                    let input = if ty == SDL_EVENT_GAMEPAD_ADDED {
                        pads.add(ev.gdevice.which);
                        controllers_changed = true;
                        None
                    } else if ty == SDL_EVENT_GAMEPAD_REMOVED {
                        pads.remove(ev.gdevice.which);
                        controllers_changed = true;
                        None
                    } else if ty == SDL_EVENT_GAMEPAD_BUTTON_DOWN || ty == SDL_EVENT_GAMEPAD_BUTTON_UP {
                        let b = ev.gbutton;
                        Some((b.which.0, button_name(b.button), b.down, b.timestamp))
                    } else if ty == SDL_EVENT_GAMEPAD_AXIS_MOTION {
                        let a = ev.gaxis;
                        pads.trigger(a.which.0, a.axis, a.value).map(|(name, down)| (a.which.0, name, down, a.timestamp))
                    } else {
                        None
                    };

                    if let Some((pad, button, pressed, ts)) = input {
                        if pressed {
                            let _ = app.emit("button-activity", button);
                        }
                        let name = pads.name(pad);
                        let mut eng = engine.lock().unwrap();
                        steps.push(on_button(&mut eng, pad, &name, button, pressed, ts as f64 / 1e6));
                    }
                }

                {
                    let mut eng = engine.lock().unwrap();
                    if controllers_changed {
                        eng.controllers = pads.list();
                        let _ = app.emit("controllers", eng.controllers());
                    }
                    steps.push(on_tick(&mut eng, ticks_ms()));
                }

                for step in steps {
                    match step {
                        Step::None => {}
                        Step::PhaseChanged => {
                            let phase = engine.lock().unwrap().phase();
                            let _ = app.emit("phase", phase);
                        }
                        Step::Press(p) => {
                            let _ = app.emit("live-press", p);
                        }
                        Step::Finished(run) => {
                            let _ = app.emit("phase", Phase::Idle);
                            let result = save_run(&app, run);
                            let _ = app.emit("run-finished", result);
                        }
                        Step::Abandoned(reason) => {
                            let _ = app.emit("phase", Phase::Idle);
                            let _ = app.emit(
                                "run-finished",
                                RunFinished { run_id: None, summary: None, previous_best_ms: None, reason: Some(reason) },
                            );
                        }
                    }
                }

                std::thread::sleep(POLL_INTERVAL);
            }
        })
        .expect("failed to spawn input thread");
}
