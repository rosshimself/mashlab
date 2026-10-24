import { useEffect, useRef, useState } from "react";
import { Gamepad2, Play, RotateCcw, Square, Timer, Hash, Trophy, ArrowRight } from "lucide-react";
import { api, events, MIN_INTERVALS_FOR_RANKING, type Controller, type Mode, type Phase, type RunFinished, type TestConfig } from "../lib/api";
import { buttonLabel, fmtFrames, fmtMs } from "../lib/format";
import { Badge, Button, Card, CardHeader, Segmented, Stat, cx } from "../components/ui";
import { IntervalChart } from "../components/charts";

const PRESETS: Record<Mode, number[]> = { time: [5, 10, 15, 30], count: [10, 25, 50, 100] };
const CONFIG_KEY = "mashlab.testConfig";

function loadConfig(): TestConfig {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "");
    if ((c.mode === "time" || c.mode === "count") && Number.isInteger(c.target)) return c;
  } catch {
    /* fall through */
  }
  return { mode: "time", target: 10 };
}

interface Live {
  presses: number;
  intervals: number[];
  startedAt: number; // performance.now() when the first press arrived (display only)
}

export function TestTab({
  phase,
  controllers,
  hasProfile,
  onViewRun,
}: {
  phase: Phase;
  controllers: Controller[];
  hasProfile: boolean;
  onViewRun: (id: number) => void;
}) {
  const [config, setConfig] = useState<TestConfig>(loadConfig);
  const [custom, setCustom] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [result, setResult] = useState<RunFinished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(performance.now());
  const [popKey, setPopKey] = useState(0);
  const busy = phase.phase !== "idle";

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }
  }, [config]);

  // Start the live view when the first press arrives.
  useEffect(() => {
    if (phase.phase === "running") {
      setLive((l) => l ?? { presses: 1, intervals: [], startedAt: performance.now() });
    } else if (phase.phase === "armed") {
      setLive(null);
      setResult(null);
    }
  }, [phase]);

  useEffect(() => {
    const subs = [
      events.livePress((p) => {
        setLive((l) =>
          l ? { ...l, presses: p.n, intervals: p.interval_ms != null ? [...l.intervals, p.interval_ms] : l.intervals } : l,
        );
        setPopKey((k) => k + 1);
      }),
      events.runFinished((r) => {
        setResult(r);
        setLive(null);
      }),
    ];
    return () => subs.forEach((s) => s.then((un) => un()));
  }, []);

  // Clock for the countdown display only; measured times come from the backend.
  useEffect(() => {
    if (phase.phase !== "running") return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase.phase]);

  const start = async () => {
    setError(null);
    setResult(null);
    try {
      await api.startTest(config);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape" && busy) api.cancelTest();
      if ((e.key === "Enter" || e.key === " ") && !busy && hasProfile) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setMode = (mode: Mode) => {
    setCustom(false);
    setConfig({ mode, target: mode === "time" ? 10 : 25 });
  };

  return (
    <div className="grid h-full grid-cols-[300px_1fr] gap-5">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Test setup" sub="The first button you press is the one that counts." />
          <div className="flex flex-col gap-4 px-5 pt-2 pb-5">
            <Segmented
              value={config.mode}
              onChange={setMode}
              disabled={busy}
              options={[
                { value: "time", label: <span className="flex items-center gap-1.5"><Timer size={14} /> Timed</span> },
                { value: "count", label: <span className="flex items-center gap-1.5"><Hash size={14} /> Presses</span> },
              ]}
            />
            <div className="grid grid-cols-5 gap-1.5">
              {PRESETS[config.mode].map((v) => (
                <button
                  key={v}
                  disabled={busy}
                  onClick={() => {
                    setCustom(false);
                    setConfig({ ...config, target: v });
                  }}
                  className={cx(
                    "num rounded-lg border py-2 text-sm transition disabled:opacity-50",
                    !custom && config.target === v
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-line bg-surface-2 text-ink-2 hover:text-ink",
                  )}
                >
                  {v}
                  {config.mode === "time" ? "s" : ""}
                </button>
              ))}
              <button
                disabled={busy}
                onClick={() => setCustom(true)}
                className={cx(
                  "rounded-lg border py-2 text-xs transition disabled:opacity-50",
                  custom ? "border-accent/60 bg-accent/10 text-accent" : "border-line bg-surface-2 text-ink-2 hover:text-ink",
                )}
              >
                Custom
              </button>
            </div>
            {custom && (
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="number"
                  min={config.mode === "time" ? 1 : 2}
                  max={config.mode === "time" ? 120 : 1000}
                  value={config.target}
                  disabled={busy}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n) && n > 0) setConfig({ ...config, target: n });
                  }}
                  className="num w-24 rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink outline-none focus:border-accent/60"
                />
                {config.mode === "time" ? "seconds (1–120)" : "presses (2–1000)"}
              </label>
            )}
            <p className="text-xs leading-relaxed text-ink-3">
              {config.mode === "time"
                ? `Mash for ${config.target} seconds. The clock starts on your first press.`
                : `Press ${config.target} times as fast as you can. Stops on the last press.`}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Controllers" />
          <div className="flex flex-col gap-2 px-5 pt-1 pb-5">
            {controllers.length === 0 ? (
              <p className="text-sm text-ink-3">No controller detected. Plug one in. Wired USB gives the most accurate timing.</p>
            ) : (
              controllers.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm text-ink-2">
                  <span className="h-2 w-2 rounded-full bg-good" aria-hidden />
                  <Gamepad2 size={16} className="text-ink-3" />
                  <span className="truncate">{c.name}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="relative flex min-h-0 flex-col overflow-hidden">
        <Stage
          phase={phase}
          live={live}
          now={now}
          result={result}
          error={error}
          popKey={popKey}
          hasProfile={hasProfile}
          hasController={controllers.length > 0}
          onStart={start}
          onCancel={() => api.cancelTest()}
          onViewRun={onViewRun}
        />
      </Card>
    </div>
  );
}

function Stage(props: {
  phase: Phase;
  live: Live | null;
  now: number;
  result: RunFinished | null;
  error: string | null;
  popKey: number;
  hasProfile: boolean;
  hasController: boolean;
  onStart: () => void;
  onCancel: () => void;
  onViewRun: (id: number) => void;
}) {
  const { phase, live, now, result, error } = props;

  if (phase.phase === "armed") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="pulse-ring flex h-40 w-40 items-center justify-center rounded-full border-2 border-accent/70">
          <Gamepad2 size={56} className="text-accent" />
        </div>
        <div className="text-center">
          <div className="text-2xl font-semibold">Start mashing</div>
          <p className="mt-2 text-sm text-ink-3">Your first press picks the button and starts the clock.</p>
        </div>
        <Button variant="ghost" onClick={props.onCancel}>
          <Square size={14} /> Cancel <kbd className="ml-1 text-xs text-ink-3">Esc</kbd>
        </Button>
      </div>
    );
  }

  if (phase.phase === "running" && live) {
    const { config } = phase;
    const elapsed = (now - live.startedAt) / 1000;
    const progress =
      config.mode === "time" ? Math.min(1, elapsed / config.target) : Math.min(1, live.presses / config.target);
    const lastInterval = live.intervals[live.intervals.length - 1];
    const avg = live.intervals.length ? live.intervals.reduce((a, b) => a + b, 0) / live.intervals.length : null;
    const R = 92;
    const circ = 2 * Math.PI * R;
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-6 pt-5">
          <Badge tone="accent">
            Button {buttonLabel(phase.button, phase.controller)}
          </Badge>
          <Button variant="ghost" onClick={props.onCancel}>
            <Square size={14} /> Stop
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center gap-14">
          <div className="relative h-[220px] w-[220px]">
            <svg viewBox="0 0 220 220" className="absolute inset-0 -rotate-90">
              <circle cx={110} cy={110} r={R} fill="none" stroke="var(--color-surface-3)" strokeWidth={10} />
              <circle
                cx={110}
                cy={110}
                r={R}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - progress)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div key={props.popKey} className="pop num text-6xl font-bold">{live.presses}</div>
              <div className="num mt-1 text-sm text-ink-3">
                {config.mode === "time"
                  ? `${Math.max(0, config.target - elapsed).toFixed(1)}s left`
                  : `of ${config.target}`}
              </div>
            </div>
          </div>
          <div className="grid w-64 grid-cols-1 gap-3">
            <Stat label="Last interval" value={fmtMs(lastInterval)} unit="ms" sub={fmtFrames(lastInterval)} />
            <Stat label="Running average" value={fmtMs(avg)} unit="ms" sub={avg ? `${(1000 / avg).toFixed(1)} presses/s` : "—"} />
          </div>
        </div>
        <div className="px-2 pb-4">
          <IntervalChart intervals={live.intervals} mean={avg ?? undefined} height={180} live />
        </div>
      </div>
    );
  }

  if (result?.summary) {
    const s = result.summary;
    const ranked = s.interval_count >= MIN_INTERVALS_FOR_RANKING;
    const isPb = ranked && (result.previous_best_ms == null || s.mean_interval_ms < result.previous_best_ms);
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-start justify-between px-6 pt-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-ink-3">
              Average interval
              {isPb && (
                <Badge tone="good">
                  <Trophy size={12} /> New personal best
                </Badge>
              )}
              {!ranked && <Badge>Too short to rank</Badge>}
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="num text-7xl font-bold text-accent">{fmtMs(s.mean_interval_ms)}</span>
              <span className="text-xl text-ink-3">ms</span>
              <span className="num text-xl text-ink-2">{fmtFrames(s.mean_interval_ms)}</span>
            </div>
            {result.previous_best_ms != null && (
              <div className="num mt-1 text-sm text-ink-3">
                Personal best {fmtMs(result.previous_best_ms)} ms ·{" "}
                {s.mean_interval_ms < result.previous_best_ms ? "−" : "+"}
                {fmtMs(Math.abs(s.mean_interval_ms - result.previous_best_ms))} ms
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="subtle" onClick={() => result.run_id && props.onViewRun(result.run_id)}>
              Details <ArrowRight size={14} />
            </Button>
            <Button variant="primary" onClick={props.onStart}>
              <RotateCcw size={14} /> Run again
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 px-6 pt-6">
          <Stat label="Consistency" value={s.consistency.toFixed(0)} unit="/ 100" sub={`σ ${fmtMs(s.stddev_ms)} ms`} />
          <Stat label="Presses / sec" value={s.presses_per_sec.toFixed(2)} sub={`${s.press_count} presses`} />
          <Stat label={`Best ${Math.min(10, s.interval_count)}-press stretch`} value={fmtMs(s.best_window_ms)} unit="ms" sub={fmtFrames(s.best_window_ms)} />
          <Stat label="Avg hold" value={fmtMs(s.mean_hold_ms)} unit="ms" sub={fmtFrames(s.mean_hold_ms)} />
          <Stat label="Median interval" value={fmtMs(s.median_interval_ms)} unit="ms" sub={fmtFrames(s.median_interval_ms)} />
          <Stat label="Fastest interval" value={fmtMs(s.min_interval_ms)} unit="ms" sub={fmtFrames(s.min_interval_ms)} />
          <Stat label="Slowest interval" value={fmtMs(s.max_interval_ms)} unit="ms" sub={fmtFrames(s.max_interval_ms)} />
          <Stat label="Button" value={buttonLabel(s.button, s.controller)} sub={s.controller} />
        </div>
        <div className="flex-1 px-2 pt-4 pb-4">
          <ResultChart runId={result.run_id} mean={s.mean_interval_ms} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-surface-2">
        <Gamepad2 size={44} className="text-ink-2" />
      </div>
      <div>
        <div className="text-2xl font-semibold">Ready when you are</div>
        <p className="mt-2 max-w-sm text-sm text-ink-3">
          {result?.reason ??
            error ??
            (props.hasController
              ? "Hit start, then mash a single button as fast and evenly as you can."
              : "Connect a controller to begin.")}
        </p>
      </div>
      <Button variant="primary" className="px-6 py-3 text-base" onClick={props.onStart} disabled={!props.hasProfile}>
        <Play size={16} /> Start test <kbd className="ml-1 text-xs opacity-60">Enter</kbd>
      </Button>
    </div>
  );
}

function ResultChart({ runId, mean }: { runId: number | null; mean: number }) {
  const [intervals, setIntervals] = useState<number[]>([]);
  const id = useRef(runId);
  id.current = runId;
  useEffect(() => {
    if (runId == null) return;
    api.getRun(runId).then((d) => {
      if (!d || id.current !== runId) return;
      const p = d.events.filter((e) => e.pressed).map((e) => e.t_ms);
      setIntervals(p.slice(1).map((t, i) => t - p[i]));
    });
  }, [runId]);
  return <IntervalChart intervals={intervals} mean={mean} height={200} />;
}
