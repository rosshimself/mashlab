import { useEffect, useMemo, useState } from "react";
import { ListOrdered, Trash2, Trophy } from "lucide-react";
import { api, MIN_INTERVALS_FOR_RANKING, type RunDetail, type RunSummary } from "../lib/api";
import { buttonLabel, fmtConfig, fmtDate, fmtFrames, fmtMs } from "../lib/format";
import { Badge, Button, Card, CardHeader, Empty, Stat, cx } from "../components/ui";
import { IntervalChart, PressTimeline } from "../components/charts";

export function RunsTab({
  profileId,
  version,
  focusRunId,
  onChanged,
}: {
  profileId: number;
  version: number;
  focusRunId: number | null;
  onChanged: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(focusRunId);
  const [detail, setDetail] = useState<RunDetail | null>(null);

  useEffect(() => {
    api.listRuns(profileId).then((r) => {
      setRuns(r);
      setSelected((s) => (s != null && r.some((x) => x.id === s) ? s : r[0]?.id ?? null));
    });
  }, [profileId, version]);

  useEffect(() => {
    if (focusRunId != null) setSelected(focusRunId);
  }, [focusRunId]);

  useEffect(() => {
    if (selected == null) return setDetail(null);
    let live = true;
    api.getRun(selected).then((d) => live && setDetail(d));
    return () => {
      live = false;
    };
  }, [selected]);

  const bestId = useMemo(() => {
    const ranked = (runs ?? []).filter((r) => r.interval_count >= MIN_INTERVALS_FOR_RANKING);
    return ranked.length ? ranked.reduce((a, b) => (b.mean_interval_ms < a.mean_interval_ms ? b : a)).id : null;
  }, [runs]);

  if (runs && runs.length === 0) {
    return (
      <Card>
        <Empty icon={<ListOrdered size={40} />} title="No runs yet">
          Finish a test and it will show up here with its full press-by-press timeline.
        </Empty>
      </Card>
    );
  }

  const remove = async (id: number) => {
    await api.deleteRun(id);
    onChanged();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[380px_1fr] gap-5">
      <Card className="flex min-h-0 flex-col">
        <CardHeader title="Runs" sub={runs ? `${runs.length} total · newest first` : "Loading…"} />
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line px-5 pb-2 text-xs text-ink-3">
          <span>When</span>
          <span className="text-right">Avg interval</span>
          <span className="w-10 text-right">Cons.</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {runs?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={cx(
                "grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-4 rounded-lg px-3 py-2.5 text-left transition",
                selected === r.id ? "bg-surface-3" : "hover:bg-surface-2",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm text-ink">
                  {fmtDate(r.started_at)}
                  {r.id === bestId && <Trophy size={13} className="text-accent" aria-label="Personal best" />}
                </div>
                <div className="truncate text-xs text-ink-3">
                  {fmtConfig(r.mode, r.target)} · {buttonLabel(r.button, r.controller)}
                  {r.mode === "time" && ` · ${r.press_count} presses`}
                </div>
              </div>
              <div className="num text-right text-sm text-ink">{fmtMs(r.mean_interval_ms)} ms</div>
              <div className="num w-10 text-right text-sm text-ink-2">{r.consistency.toFixed(0)}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-y-auto">
        {detail ? <RunDetailView detail={detail} isBest={detail.summary.id === bestId} onDelete={remove} /> : null}
      </Card>
    </div>
  );
}

function RunDetailView({ detail, isBest, onDelete }: { detail: RunDetail; isBest: boolean; onDelete: (id: number) => void }) {
  const s = detail.summary;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [s.id]);
  const intervals = useMemo(() => {
    const p = detail.events.filter((e) => e.pressed).map((e) => e.t_ms);
    return p.slice(1).map((t, i) => t - p[i]);
  }, [detail]);

  return (
    <>
      <div className="flex items-start justify-between px-6 pt-5">
        <div>
          <div className="flex items-center gap-2 text-sm text-ink-3">
            {fmtDate(s.started_at)} · {fmtConfig(s.mode, s.target)}
            {isBest && (
              <Badge tone="accent">
                <Trophy size={12} /> Personal best
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="num text-5xl font-bold">{fmtMs(s.mean_interval_ms)}</span>
            <span className="text-lg text-ink-3">ms avg</span>
            <span className="num text-lg text-ink-2">{fmtFrames(s.mean_interval_ms)}</span>
          </div>
          <div className="mt-1 text-xs text-ink-3">
            Button {buttonLabel(s.button, s.controller)} on {s.controller}
          </div>
        </div>
        {confirming ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            <Button variant="danger" className="bg-critical/20 text-ink" onClick={() => onDelete(s.id)}>
              <Trash2 size={14} /> Delete run
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 px-6 pt-5">
        <Stat label="Consistency" value={s.consistency.toFixed(0)} unit="/ 100" sub={`σ ${fmtMs(s.stddev_ms)} ms · CV ${(s.cv * 100).toFixed(1)}%`} />
        <Stat label="Presses / sec" value={s.presses_per_sec.toFixed(2)} sub={`${s.press_count} presses in ${(s.span_ms / 1000).toFixed(2)}s`} />
        <Stat label={`Best ${Math.min(10, s.interval_count)}-press stretch`} value={fmtMs(s.best_window_ms)} unit="ms" sub={fmtFrames(s.best_window_ms)} />
        <Stat label="Avg hold" value={fmtMs(s.mean_hold_ms)} unit="ms" sub={fmtFrames(s.mean_hold_ms)} />
        <Stat label="Median" value={fmtMs(s.median_interval_ms)} unit="ms" sub={fmtFrames(s.median_interval_ms)} />
        <Stat label="Fastest" value={fmtMs(s.min_interval_ms)} unit="ms" sub={fmtFrames(s.min_interval_ms)} />
        <Stat label="Slowest" value={fmtMs(s.max_interval_ms)} unit="ms" sub={fmtFrames(s.max_interval_ms)} />
        <Stat label="Intervals" value={s.interval_count} sub={s.interval_count < MIN_INTERVALS_FOR_RANKING ? "too few to rank" : "ranked"} />
      </div>

      <div className="pt-4">
        <CardHeader title="Interval per press" sub="Time since the previous press. Flat and low is the goal." />
        <div className="px-2">
          <IntervalChart intervals={intervals} mean={s.mean_interval_ms} />
        </div>
      </div>

      <div className="pt-2 pb-2">
        <CardHeader title="Press timeline" sub="Each block runs from button down to button up." />
        <PressTimeline events={detail.events} />
      </div>
    </>
  );
}
