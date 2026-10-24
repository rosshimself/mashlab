import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

export function CardHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

type Variant = "primary" | "ghost" | "danger" | "subtle";

export function Button({
  variant = "subtle",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:brightness-110 font-semibold",
    subtle: "bg-surface-2 text-ink hover:bg-surface-3 border border-line",
    ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
    danger: "text-ink-2 hover:text-ink hover:bg-critical/20",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm transition disabled:pointer-events-none disabled:opacity-40",
        styles[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-50",
            o.value === value ? "bg-surface-3 text-ink shadow-sm" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface-2 px-4 py-3", className)}>
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num text-xl font-semibold text-ink">{value}</span>
        {unit && <span className="text-xs text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="num mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="text-ink-3">{icon}</div>
      <div className="text-base font-semibold text-ink">{title}</div>
      {children && <div className="max-w-sm text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "accent" }) {
  const t = {
    neutral: "bg-surface-3 text-ink-2",
    good: "bg-good/15 text-[#5fd35f]",
    accent: "bg-accent/15 text-accent",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}
