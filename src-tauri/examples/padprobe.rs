//! Diagnostic: print raw SDL3 gamepad events with timestamps.
//! Mirrors the app: SDL runs on a background thread while the main thread runs
//! the platform run loop.
//! Run: cargo run --example padprobe [seconds]
use sdl3_sys::everything::*;
use std::ffi::CStr;

fn main() {
    let secs: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(5);
    let t = std::thread::spawn(move || unsafe {
        SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, c"1".as_ptr());
        if !SDL_Init(SDL_INIT_GAMEPAD) {
            println!("SDL_Init failed: {:?}", CStr::from_ptr(SDL_GetError()));
            std::process::exit(1);
        }
        println!("SDL {} ready", SDL_GetVersion());
        let end = SDL_GetTicksNS() + secs * 1_000_000_000;
        let mut ev = SDL_Event::default();
        let mut last_down = 0u64;
        while SDL_GetTicksNS() < end {
            if !SDL_WaitEventTimeout(&mut ev, 5) {
                continue;
            }
            let t = ev.r#type;
            if t == SDL_EVENT_GAMEPAD_ADDED.0 {
                let pad = SDL_OpenGamepad(ev.gdevice.which);
                println!("added {:?} id={}", CStr::from_ptr(SDL_GetGamepadName(pad)), ev.gdevice.which.0);
            } else if t == SDL_EVENT_GAMEPAD_BUTTON_DOWN.0 || t == SDL_EVENT_GAMEPAD_BUTTON_UP.0 {
                let b = ev.gbutton;
                let dt = if b.down { let d = b.timestamp - last_down; last_down = b.timestamp; d as f64 / 1e6 } else { 0.0 };
                println!("button {} {} t={:.3}ms since_last_down={:.3}ms", b.button, if b.down { "down" } else { "up" }, b.timestamp as f64 / 1e6, dt);
            } else if t == SDL_EVENT_GAMEPAD_AXIS_MOTION.0 {
                println!("axis {} {}", ev.gaxis.axis, ev.gaxis.value);
            }
        }
        std::process::exit(0);
    });
    #[cfg(target_os = "macos")]
    core_foundation::runloop::CFRunLoop::run_current();
    let _ = t.join();
}
