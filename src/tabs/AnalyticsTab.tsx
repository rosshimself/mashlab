import { useEffect, useMemo, useState } from "react";
import { BarChart3, Crown } from "lucide-react";
import { api, MIN_INTERVALS_FOR_RANKING, type LeaderboardEntry, type RunSummary } from "../lib/api";
import { buttonLabel, fmtConfig, fmtFrames, fmtMs, fmtShortDate } from "../lib/format";
import { Card, CardHeader, Empty, Segmented, Stat, cx } from "../components/ui";
import { IntervalHistogram, RunTrendChart } from "../components/charts";

const RECENT = 10;

export function AnalyticsTab({ profileId, version }: { profileId: number; version: number }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [intervals, setIntervals] = useState<number[]>([]);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    api.listRuns(profileId).then(setRuns);
    api.leaderboard().then(setBoard);
  }, [profileId, version]);

  const configs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of runs ?? []) seen.set(`${r.mode}:${r.target}`, fmtConfig(r.mode, r.target));
    return [...seen.entries()].sort();
  }, [runs]);

  // Oldest first, ranked runs only, within the selected test config.
  const filtered = useMemo(
    () =>
      (runs ?? [])
        .filter((r) => r.interval_count >= MIN_INTERVALS_FOR_RANKING)
        .filter((r) => filter === "all" || `${r.mode}:${r.target}` === filter)
        .slice()
        .reverse(),
    [runs, filter],
  );

  const recentIds = filtered.slice(-RECENT).map((r) => r.id).join(",");
  useEffect(() => {
    const ids = recentIds ? recentIds.split(",").map(Number) : [];
    let live = true;
    Promise.all(ids.map((id) => api.getRun(id))).then((details) => {
      if (!live) return;
      const all: number[] = [];
      for (const d of details) {
        const p = d?.events.filter((e) => e.pressed).map((e) => e.t_ms) ?? [];
        for (let i = 1; i < p.length; i++) all.push(p[i] - p[i - 1]);
      }
      setIntervals(all);
    });
    return () => {
      live = false;
    };
  }, [recentIds]);

  if (runs && filtered.length === 0 && filter === "all") {
    return (
      <Card>
        <Empty icon={<BarChart3 size={40} />} title="Not enough data yet">
          Analytics shows up after your first run with at least {MIN_INTERVALS_FOR_RANKING + 1} presses.
        </Empty>
      </Card>
    );
  }

  const best = filtered.length ? filtered.reduce((a, b) => (b.mean_interval_ms < a.mean_interval_ms ? b : a)) : null;
  const recent = filtered.slice(-RECENT);
  const recentAvg = recent.length ? recent.reduce((a, r) => a + r.mean_interval_ms, 0) / recent.length : null;
  const recentCons = recent.length ? recent.reduce((a, r) => a + r.consistency, 0) / recent.length : null;
  const totalPresses = filtered.reduce((a, r) => a + r.press_count, 0);
  const trend = filtered.map((r, i) => ({ id: r.id, x: `#${i + 1} · ${fmtShortDate(r.started_at)}`, v: r.mean_interval_ms }));
  const consTrend = filtered.map((r, i) => ({ id: r.id, x: `#${i + 1} · ${fmtShortDate(r.started_at)}`, v: r.consistency }));

  const byButton = new Map<string, { label: string; runs: number; best: number; sum: number }>();
  for (const r of filtered) {
    const label = buttonLabel(r.button, r.controller);
    const b = byButton.get(label) ?? { label, runs: 0, best: Infinity, sum: 0 };
    b.runs++;
    b.best = Math.min(b.best, r.mean_interval_ms);
    b.sum += r.mean_interval_ms;
    byButton.set(label, b);
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-3">Test type</span>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, ...configs.map(([value, label]) => ({ value, label }))]}
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty icon={<BarChart3 size={40} />} title="No ranked runs for this test type" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Stat
              className="border-accent/30"
              label="Personal best · avg interval"
              value={<span className="text-accent">{fmtMs(best?.mean_interval_ms)}</span>}
              unit="ms"
              sub={best ? `${fmtFrames(best.mean_interval_ms)} · ${best.presses_per_sec.toFixed(2)}/s · ${fmtShortDate(best.started_at)}` : undefined}
            />
            <Stat
              label={`Last ${recent.length} runs · avg interval`}
              value={fmtMs(recentAvg)}
              unit="ms"
              sub={recentAvg ? `${fmtFrames(recentAvg)} · ${(1000 / recentAvg).toFixed(2)}/s` : undefined}
            />
            <Stat label={`Last ${recent.length} runs · consistency`} value={recentCons?.toFixed(0) ?? "—"} unit="/ 100" />
            <Stat label="Ranked runs" value={filtered.length} sub={`${totalPresses.toLocaleString()} presses`} />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Average interval per run" sub="Lower is faster. Dashed line is your personal best." />
              <div className="px-2 pb-3">
                <RunTrendChart points={trend} unit="ms" label="Avg interval" reference={best?.mean_interval_ms} referenceLabel="PB" />
              </div>
            </Card>
            <Card>
              <CardHeader title="Consistency per run" sub="100 means every interval was identical." />
              <div className="px-2 pb-3">
                <RunTrendChart points={consTrend} unit="" label="Consistency" lowerIsBetter={false} />
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Interval distribution"
                sub={`All presses from your last ${recent.length} runs, in 5 ms buckets. A narrow peak means a steady rhythm.`}
              />
              <div className="px-2 pb-3">
                <IntervalHistogram intervals={intervals} />
              </div>
            </Card>
            <Card>
              <CardHeader title="By button" />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-3">
                    <th className="px-5 py-2 text-left font-normal">Button</th>
                    <th className="px-5 py-2 text-right font-normal">Runs</th>
                    <th className="px-5 py-2 text-right font-normal">Best avg</th>
                    <th className="px-5 py-2 text-right font-normal">Mean avg</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byButton.values()]
                    .sort((a, b) => a.best - b.best)
                    .map((b) => (
                      <tr key={b.label} className="border-b border-line/60 last:border-0">
                        <td className="px-5 py-2.5 text-ink">{b.label}</td>
                        <td className="num px-5 py-2.5 text-right text-ink-2">{b.runs}</td>
                        <td className="num px-5 py-2.5 text-right text-ink">{fmtMs(b.best)} ms</td>
                        <td className="num px-5 py-2.5 text-right text-ink-2">{fmtMs(b.sum / b.runs)} ms</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader title="Scoreboard" sub="Each profile's best average interval on this machine, across all test types." />
        <div className="px-3 pb-3">
          {board.map((e, i) => (
            <div
              key={`${e.profile_id}:${e.run_id}`}
              className={cx(
                "grid grid-cols-[40px_1fr_auto_auto_auto] items-center gap-6 rounded-lg px-3 py-2.5",
                e.profile_id === profileId && "bg-surface-2",
              )}
            >
              <span className={cx("num text-sm", i === 0 ? "text-accent" : "text-ink-3")}>
                {i === 0 ? <Crown size={16} aria-label="First place" /> : `#${i + 1}`}
              </span>
              <span className="truncate text-sm text-ink">
                {e.name}
                {e.profile_id === profileId && <span className="ml-2 text-xs text-ink-3">you</span>}
              </span>
              <span className="num text-sm text-ink">{fmtMs(e.mean_interval_ms)} ms</span>
              <span className="num w-16 text-right text-xs text-ink-3">{e.presses_per_sec.toFixed(2)}/s</span>
              <span className="num w-20 text-right text-xs text-ink-3">cons. {e.consistency.toFixed(0)}</span>
            </div>
          ))}
          {board.length === 0 && <p className="px-3 py-2 text-sm text-ink-3">No ranked runs yet.</p>}
        </div>
      </Card>
    </div>
  );
}
