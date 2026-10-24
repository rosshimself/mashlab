import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InputEvent } from "../lib/api";
import { FRAME_MS, fmtFrames, fmtMs } from "../lib/format";
import { Segmented } from "./ui";

const C = {
  series: "var(--color-series-1)",
  series2: "var(--color-series-2)",
  grid: "#26262c",
  axis: "#8c8b84",
  ref: "#c3c2b7",
};

const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function TipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-line bg-surface-3/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 text-ink-3">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-ink-2">{k}</span>
          <span className="num text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Interval between consecutive presses, one point per press. */
export function IntervalChart({
  intervals,
  mean,
  height = 220,
  live = false,
}: {
  intervals: number[];
  mean?: number;
  height?: number;
  live?: boolean;
}) {
  const data = useMemo(() => intervals.map((v, i) => ({ n: i + 2, v })), [intervals]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 64, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="n" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={48} domain={[0, "auto"]} unit="ms" />
        {mean != null && (
          <ReferenceLine
            y={mean}
            stroke={C.ref}
            strokeDasharray="4 4"
            label={{ value: `avg ${mean.toFixed(1)}`, fill: C.ref, fontSize: 11, position: "right" }}
          />
        )}
        {!live && (
          <Tooltip
            cursor={{ stroke: C.axis, strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TipBox
                  title={`Press #${payload[0].payload.n}`}
                  rows={[
                    ["Interval", `${fmtMs(payload[0].payload.v)} ms`],
                    ["Frames @60", fmtFrames(payload[0].payload.v)],
                  ]}
                />
              ) : null
            }
          />
        )}
        <Line
          type="linear"
          dataKey="v"
          stroke={C.series}
          strokeWidth={2}
          dot={data.length <= 60 ? { r: 2.5, fill: C.series, strokeWidth: 0 } : false}
          activeDot={{ r: 5, stroke: "var(--color-surface)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** One value per run over time (mean interval or consistency). */
export function RunTrendChart({
  points,
  unit,
  label,
  reference,
  referenceLabel,
  height = 220,
  lowerIsBetter = true,
}: {
  points: { id: number; x: string; v: number }[];
  unit: string;
  label: string;
  reference?: number;
  referenceLabel?: string;
  height?: number;
  lowerIsBetter?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 10, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="x" {...axisProps} minTickGap={28} />
        <YAxis {...axisProps} width={48} domain={lowerIsBetter ? ["auto", "auto"] : [0, 100]} unit={unit} />
        {reference != null && (
          <ReferenceLine
            y={reference}
            stroke={C.ref}
            strokeDasharray="4 4"
            label={{ value: referenceLabel, fill: C.ref, fontSize: 11, position: "insideBottomRight" }}
          />
        )}
        <Tooltip
          cursor={{ stroke: C.axis, strokeWidth: 1 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TipBox title={payload[0].payload.x} rows={[[label, `${payload[0].payload.v.toFixed(1)} ${unit}`]]} />
            ) : null
          }
        />
        <Line
          type="linear"
          dataKey="v"
          stroke={C.series}
          strokeWidth={2}
          dot={{ r: 4, fill: C.series, stroke: "var(--color-surface)", strokeWidth: 2 }}
          activeDot={{ r: 6, stroke: "var(--color-surface)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Distribution of press intervals, in buckets of `bin` ms. */
export function IntervalHistogram({ intervals, bin = 5, height = 220 }: { intervals: number[]; bin?: number; height?: number }) {
  const data = useMemo(() => {
    if (!intervals.length) return [];
    // Clip the long tail so one hesitation doesn't flatten the chart.
    const sorted = [...intervals].sort((a, b) => a - b);
    const hi = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1];
    const lo = Math.floor(sorted[0] / bin) * bin;
    const n = Math.max(1, Math.ceil((hi - lo) / bin) + 1);
    const buckets = Array.from({ length: n }, (_, i) => ({ from: lo + i * bin, count: 0 }));
    for (const v of intervals) {
      const i = Math.min(n - 1, Math.floor((v - lo) / bin));
      buckets[i].count++;
    }
    return buckets.map((b) => ({ ...b, label: `${b.from}` }));
  }, [intervals, bin]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 16, bottom: 4, left: -8 }} barCategoryGap={2}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={16} unit="ms" />
        <YAxis {...axisProps} width={48} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgb(255 255 255 / 0.04)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TipBox
                title={`${payload[0].payload.from}–${payload[0].payload.from + bin} ms`}
                rows={[
                  ["Presses", String(payload[0].payload.count)],
                  ["Frames @60", `${(payload[0].payload.from / FRAME_MS).toFixed(1)}–${((payload[0].payload.from + bin) / FRAME_MS).toFixed(1)}`],
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="count" fill={C.series} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Piano-roll view of a run: each block is one press, from button down to button up,
 * drawn over a 60 fps frame grid. Useful for matching mash timing to animation frames.
 */
export function PressTimeline({ events }: { events: InputEvent[] }) {
  const [scale, setScale] = useState(0.5); // px per ms
  const { blocks, end } = useMemo(() => {
    const blocks: { start: number; end: number | null; n: number }[] = [];
    let open: (typeof blocks)[number] | null = null;
    for (const e of events) {
      if (e.pressed) {
        open = { start: e.t_ms, end: null, n: blocks.length + 1 };
        blocks.push(open);
      } else if (open) {
        open.end = e.t_ms;
        open = null;
      }
    }
    const last = events.length ? events[events.length - 1].t_ms : 0;
    return { blocks, end: last + 50 };
  }, [events]);

  const [hover, setHover] = useState<(typeof blocks)[number] | null>(null);
  const width = Math.max(600, end * scale);
  const H = 64;
  const frameW = FRAME_MS * scale;
  const frames = frameW >= 4 ? Math.ceil(end / FRAME_MS) : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 px-5">
        <div className="num h-4 text-xs text-ink-2">
          {hover
            ? `#${hover.n} · down at ${hover.start.toFixed(1)} ms` +
              (hover.end != null
                ? ` · held ${(hover.end - hover.start).toFixed(1)} ms (${fmtFrames(hover.end - hover.start)})`
                : "")
            : <span className="text-ink-3">Hover a press for details. Grid lines are 60 fps frames.</span>}
        </div>
        <Segmented
          value={scale}
          onChange={setScale}
          options={[
            { value: 0.25, label: "¼×" },
            { value: 0.5, label: "½×" },
            { value: 1, label: "1×" },
            { value: 2, label: "2×" },
          ]}
        />
      </div>
      <div className="overflow-x-auto px-5 pb-3">
        <svg width={width} height={H + 20} className="block">
          {Array.from({ length: frames }, (_, i) => (
            <line key={i} x1={i * frameW} x2={i * frameW} y1={0} y2={H} stroke={i % 6 === 0 ? "#34343b" : "#202025"} />
          ))}
          {Array.from({ length: Math.floor(end / 1000) + 1 }, (_, s) => (
            <text key={s} x={s * 1000 * scale + 2} y={H + 14} fill={C.axis} fontSize={10}>
              {s}s
            </text>
          ))}
          {blocks.map((b) => {
            const x = b.start * scale;
            const w = Math.max(2, ((b.end ?? b.start + 8) - b.start) * scale);
            return (
              <g key={b.n} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}>
                <rect x={x - 3} y={0} width={w + 6} height={H} fill="transparent" />
                <rect
                  x={x}
                  y={10}
                  width={w}
                  height={H - 20}
                  rx={3}
                  fill={C.series}
                  opacity={hover && hover !== b ? 0.55 : 1}
                  stroke={hover === b ? "#f0efec" : "none"}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
