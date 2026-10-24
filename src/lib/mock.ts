// Dev-only fake backend so the UI can run in a plain browser (`pnpm dev`) with
// sample data. Never loaded inside the Tauri app.
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { InputEvent, LeaderboardEntry, Profile, RunSummary, TestConfig } from "./api";

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

function simulate(n: number, base: number, jitter: number): InputEvent[] {
  const ev: InputEvent[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    if (i) t += Math.max(35, base + gauss() * jitter + i * 0.15);
    ev.push({ pressed: true, t_ms: t });
    ev.push({ pressed: false, t_ms: t + 22 + rand() * 14 });
  }
  return ev;
}

function stats(events: InputEvent[]) {
  const p = events.filter((e) => e.pressed).map((e) => e.t_ms);
  const r = events.filter((e) => !e.pressed).map((e) => e.t_ms);
  const d = p.slice(1).map((t, i) => t - p[i]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
  const sorted = [...d].sort((a, b) => a - b);
  const w = Math.min(10, d.length);
  let best = Infinity;
  for (let i = 0; i + w <= d.length; i++) best = Math.min(best, d.slice(i, i + w).reduce((a, b) => a + b, 0) / w);
  return {
    press_count: p.length,
    interval_count: d.length,
    span_ms: p[p.length - 1],
    mean_interval_ms: mean,
    median_interval_ms: sorted[Math.floor(sorted.length / 2)],
    min_interval_ms: sorted[0],
    max_interval_ms: sorted[sorted.length - 1],
    stddev_ms: sd,
    cv: sd / mean,
    consistency: Math.max(0, (1 - sd / mean) * 100),
    presses_per_sec: 1000 / mean,
    best_window_ms: best,
    mean_hold_ms: r.reduce((a, b, i) => a + (b - p[i]), 0) / r.length,
  };
}

export function installMock() {
  const profiles: Profile[] = [
    { id: 1, name: "alex", created_at: Date.now() },
    { id: 2, name: "maya", created_at: Date.now() },
  ];
  let active = 1;
  let nextId = 100;
  const runs: { s: RunSummary; events: InputEvent[] }[] = [];
  const add = (profile_id: number, daysAgo: number, cfg: TestConfig, base: number, jitter: number, button = "South") => {
    const n = cfg.mode === "count" ? cfg.target : Math.round((cfg.target * 1000) / base);
    const events = simulate(n, base, jitter);
    runs.push({
      s: {
        id: nextId++,
        profile_id,
        started_at: Date.now() - daysAgo * 86400000,
        mode: cfg.mode,
        target: cfg.target,
        button,
        controller: "Xbox Wireless Controller",
        ...stats(events),
      },
      events,
    });
  };
  for (let i = 0; i < 14; i++) add(1, 14 - i, { mode: "time", target: 10 }, 86 - i * 1.3, 12 - i * 0.4, i % 4 === 3 ? "RightTrigger" : "South");
  add(1, 1, { mode: "count", target: 50 }, 71, 7);
  add(2, 2, { mode: "time", target: 10 }, 69, 6);

  const live = async (cfg: TestConfig) => {
    const events = simulate(cfg.mode === "count" ? cfg.target : 80, 66, 8).filter((e) => cfg.mode === "count" || e.t_ms <= cfg.target * 1000);
    await new Promise((r) => setTimeout(r, 400));
    await emit("phase", { phase: "running", config: cfg, button: "South", controller: "Xbox Wireless Controller" });
    const presses = events.filter((e) => e.pressed);
    const speed = Number(new URLSearchParams(location.search).get("speed") ?? 1);
    const t0 = performance.now();
    for (let i = 1; i < presses.length; i++) {
      await new Promise((r) => setTimeout(r, Math.max(0, presses[i].t_ms / speed - (performance.now() - t0))));
      await emit("live-press", { n: i + 1, t_ms: presses[i].t_ms, interval_ms: presses[i].t_ms - presses[i - 1].t_ms });
    }
    const prev = Math.min(...runs.filter((r) => r.s.profile_id === active).map((r) => r.s.mean_interval_ms));
    add(active, 0, cfg, 66, 8);
    const r = runs[runs.length - 1];
    r.events = events;
    Object.assign(r.s, stats(events));
    await emit("phase", { phase: "idle" });
    await emit("run-finished", { run_id: r.s.id, summary: r.s, previous_best_ms: prev, reason: null });
  };

  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, any>;
      switch (cmd) {
        case "list_profiles":
          return profiles;
        case "get_active_profile":
          return profiles.find((p) => p.id === active) ?? null;
        case "set_active_profile":
          active = a.id;
          return null;
        case "create_profile": {
          const p = { id: profiles.length + 1, name: a.name, created_at: Date.now() };
          profiles.push(p);
          active = p.id;
          return p;
        }
        case "list_controllers":
          return [{ id: 0, name: "Xbox Wireless Controller" }];
        case "get_phase":
          return { phase: "idle" };
        case "start_test":
          emit("phase", { phase: "armed", config: a.config });
          live(a.config);
          return null;
        case "cancel_test":
          emit("phase", { phase: "idle" });
          return null;
        case "list_runs":
          return runs.filter((r) => r.s.profile_id === a.profileId).map((r) => r.s).sort((x, y) => y.started_at - x.started_at);
        case "get_run": {
          const r = runs.find((r) => r.s.id === a.runId);
          return r ? { summary: r.s, events: r.events } : null;
        }
        case "delete_run":
          runs.splice(runs.findIndex((r) => r.s.id === a.runId), 1);
          return null;
        case "leaderboard": {
          const out: LeaderboardEntry[] = [];
          for (const p of profiles) {
            const mine = runs.filter((r) => r.s.profile_id === p.id).map((r) => r.s);
            if (!mine.length) continue;
            const b = mine.reduce((x, y) => (y.mean_interval_ms < x.mean_interval_ms ? y : x));
            out.push({ profile_id: p.id, name: p.name, run_id: b.id, mean_interval_ms: b.mean_interval_ms, consistency: b.consistency, presses_per_sec: b.presses_per_sec, started_at: b.started_at });
          }
          out.sort((x, y) => x.mean_interval_ms - y.mean_interval_ms);
          return out;
        }
      }
      return null;
    },
    { shouldMockEvents: true },
  );
}
