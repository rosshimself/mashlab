export const FRAME_MS = 1000 / 60;

export const fmtMs = (ms: number | null | undefined, digits = 1) =>
  ms == null || !Number.isFinite(ms) ? "—" : `${ms.toFixed(digits)}`;

export const toFrames = (ms: number) => ms / FRAME_MS;

export const fmtFrames = (ms: number | null | undefined) =>
  ms == null || !Number.isFinite(ms) ? "—" : `${toFrames(ms).toFixed(2)}f`;

export const fmtDate = (epochMs: number) =>
  new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const fmtShortDate = (epochMs: number) =>
  new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const fmtConfig = (mode: "time" | "count", target: number) =>
  mode === "time" ? `${target}s timed` : `${target} presses`;

type Layout = "xbox" | "playstation" | "nintendo";

function layoutFor(controller: string): Layout {
  if (/xbox|xinput/i.test(controller)) return "xbox";
  if (/dualsense|dualshock|playstation|ps[345]|wireless controller|sony/i.test(controller)) return "playstation";
  if (/nintendo|switch|pro controller|joy-?con/i.test(controller)) return "nintendo";
  return "xbox";
}

const FACE: Record<Layout, Record<string, string>> = {
  xbox: { South: "A", East: "B", West: "X", North: "Y" },
  playstation: { South: "✕", East: "○", West: "□", North: "△" },
  nintendo: { South: "B", East: "A", West: "Y", North: "X" },
};

const SHARED: Record<string, string> = {
  LeftTrigger: "LB",
  LeftTrigger2: "LT",
  RightTrigger: "RB",
  RightTrigger2: "RT",
  Select: "Select",
  Start: "Start",
  Mode: "Home",
  LeftThumb: "L3",
  RightThumb: "R3",
  DPadUp: "D-Up",
  DPadDown: "D-Down",
  DPadLeft: "D-Left",
  DPadRight: "D-Right",
};

const PS_SHOULDERS: Record<string, string> = {
  LeftTrigger: "L1",
  LeftTrigger2: "L2",
  RightTrigger: "R1",
  RightTrigger2: "R2",
  Select: "Share",
  Start: "Options",
};

/** Short glyph for a button, using the controller's naming when we can tell. */
export function buttonLabel(button: string, controller = ""): string {
  const layout = layoutFor(controller);
  return (
    FACE[layout][button] ??
    (layout === "playstation" ? PS_SHOULDERS[button] : undefined) ??
    SHARED[button] ??
    button
  );
}
