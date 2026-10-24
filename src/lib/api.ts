import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Mode = "time" | "count";

export interface TestConfig {
  mode: Mode;
  /** Seconds for "time", presses for "count". */
  target: number;
}

export interface Profile {
  id: number;
  name: string;
  created_at: number;
}

export interface Controller {
  id: number;
  name: string;
}

export type Phase =
  | { phase: "idle" }
  | { phase: "armed"; config: TestConfig }
  | { phase: "running"; config: TestConfig; button: string; controller: string };

export interface RunStats {
  press_count: number;
  interval_count: number;
  span_ms: number;
  mean_interval_ms: number;
  median_interval_ms: number;
  min_interval_ms: number;
  max_interval_ms: number;
  stddev_ms: number;
  cv: number;
  consistency: number;
  presses_per_sec: number;
  best_window_ms: number;
  mean_hold_ms: number | null;
}

export interface RunSummary extends RunStats {
  id: number;
  profile_id: number;
  started_at: number;
  mode: Mode;
  target: number;
  button: string;
  controller: string;
}

export interface InputEvent {
  pressed: boolean;
  t_ms: number;
}

export interface RunDetail {
  summary: RunSummary;
  events: InputEvent[];
}

export interface LivePress {
  n: number;
  t_ms: number;
  interval_ms: number | null;
}

export interface RunFinished {
  run_id: number | null;
  summary: RunSummary | null;
  previous_best_ms: number | null;
  reason: string | null;
}

export interface LeaderboardEntry {
  profile_id: number;
  name: string;
  run_id: number;
  mean_interval_ms: number;
  consistency: number;
  presses_per_sec: number;
  started_at: number;
}

/** Runs need at least this many intervals to count toward bests (mirrors the backend). */
export const MIN_INTERVALS_FOR_RANKING = 5;

export const api = {
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  createProfile: (name: string) => invoke<Profile>("create_profile", { name }),
  getActiveProfile: () => invoke<Profile | null>("get_active_profile"),
  setActiveProfile: (id: number) => invoke<void>("set_active_profile", { id }),
  listControllers: () => invoke<Controller[]>("list_controllers"),
  getPhase: () => invoke<Phase>("get_phase"),
  startTest: (config: TestConfig) => invoke<void>("start_test", { config }),
  cancelTest: () => invoke<void>("cancel_test"),
  listRuns: (profileId: number) => invoke<RunSummary[]>("list_runs", { profileId }),
  getRun: (runId: number) => invoke<RunDetail | null>("get_run", { runId }),
  deleteRun: (runId: number) => invoke<void>("delete_run", { runId }),
  leaderboard: () => invoke<LeaderboardEntry[]>("leaderboard"),
};

export const events = {
  phase: (cb: (p: Phase) => void): Promise<UnlistenFn> => listen<Phase>("phase", (e) => cb(e.payload)),
  livePress: (cb: (p: LivePress) => void) => listen<LivePress>("live-press", (e) => cb(e.payload)),
  runFinished: (cb: (r: RunFinished) => void) => listen<RunFinished>("run-finished", (e) => cb(e.payload)),
  controllers: (cb: (c: Controller[]) => void) => listen<Controller[]>("controllers", (e) => cb(e.payload)),
  buttonActivity: (cb: (b: string) => void) => listen<string>("button-activity", (e) => cb(e.payload)),
};
