import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Check, ChevronDown, Gamepad2, ListOrdered, Plus, Timer, UserRound } from "lucide-react";
import { api, events, type Controller, type Phase, type Profile } from "./lib/api";
import { Button, cx } from "./components/ui";
import { TestTab } from "./tabs/TestTab";
import { RunsTab } from "./tabs/RunsTab";
import { AnalyticsTab } from "./tabs/AnalyticsTab";

type Tab = "test" | "runs" | "analytics";

const TABS: { id: Tab; label: string; icon: typeof Timer }[] = [
  { id: "test", label: "Test", icon: Timer },
  { id: "runs", label: "Runs", icon: ListOrdered },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("test");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [phase, setPhase] = useState<Phase>({ phase: "idle" });
  const [version, setVersion] = useState(0);
  const [focusRun, setFocusRun] = useState<number | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const refreshProfiles = useCallback(async () => {
    const [list, current] = await Promise.all([api.listProfiles(), api.getActiveProfile()]);
    setProfiles(list);
    setActive(current ?? list[0] ?? null);
    if (!current && list[0]) api.setActiveProfile(list[0].id);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refreshProfiles();
    api.listControllers().then(setControllers);
    api.getPhase().then(setPhase);
    const subs = [events.controllers(setControllers), events.phase(setPhase), events.runFinished(bump)];
    return () => subs.forEach((s) => s.then((un) => un()));
  }, [refreshProfiles, bump]);

  const switchProfile = async (p: Profile) => {
    await api.cancelTest();
    await api.setActiveProfile(p.id);
    setActive(p);
  };

  const busy = phase.phase !== "idle";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <Gamepad2 size={18} strokeWidth={2.5} />
          </div>
          <span className="text-base font-bold tracking-tight">MashLab</span>
        </div>

        <nav className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              disabled={busy && id !== "test"}
              onClick={() => setTab(id)}
              className={cx(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition disabled:opacity-40",
                tab === id ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <ControllerPill controllers={controllers} />
          {active && (
            <ProfileMenu
              profiles={profiles}
              active={active}
              disabled={busy}
              onSwitch={switchProfile}
              onCreated={refreshProfiles}
            />
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {loaded && !active ? (
          <Onboarding onCreated={refreshProfiles} />
        ) : active ? (
          <>
            {tab === "test" && (
              <TestTab
                phase={phase}
                controllers={controllers}
                hasProfile={!!active}
                onViewRun={(id) => {
                  setFocusRun(id);
                  setTab("runs");
                }}
              />
            )}
            {tab === "runs" && <RunsTab profileId={active.id} version={version} focusRunId={focusRun} onChanged={bump} />}
            {tab === "analytics" && <AnalyticsTab profileId={active.id} version={version} />}
          </>
        ) : null}
      </main>
    </div>
  );
}

function ControllerPill({ controllers }: { controllers: Controller[] }) {
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => {
    const sub = events.buttonActivity((b) => {
      setFlash(b);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFlash(null), 400);
    });
    return () => {
      sub.then((un) => un());
    };
  }, []);
  const c = controllers[0];
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-2">
      <span
        className={cx("h-2 w-2 rounded-full transition", c ? (flash ? "bg-accent" : "bg-good") : "bg-critical")}
        aria-hidden
      />
      <span className="max-w-48 truncate">
        {c ? c.name : "No controller"}
        {controllers.length > 1 && ` +${controllers.length - 1}`}
      </span>
    </div>
  );
}

function ProfileMenu({
  profiles,
  active,
  disabled,
  onSwitch,
  onCreated,
}: {
  profiles: Profile[];
  active: Profile;
  disabled: boolean;
  onSwitch: (p: Profile) => void;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        <Avatar name={active.name} />
        <span className="max-w-36 truncate">{active.name}</span>
        <ChevronDown size={14} className="text-ink-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-surface-2 p-1.5 shadow-2xl">
          <div className="max-h-64 overflow-y-auto">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onSwitch(p);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-3"
              >
                <Avatar name={p.name} />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === active.id && <Check size={14} className="text-accent" />}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            {creating ? (
              <div className="p-1">
                <NewProfileForm
                  autoFocus
                  onCreated={() => {
                    setCreating(false);
                    setOpen(false);
                    onCreated();
                  }}
                />
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-3"
              >
                <Plus size={16} /> New profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function NewProfileForm({ onCreated, autoFocus }: { onCreated: () => void; autoFocus?: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createProfile(name);
      setName("");
      onCreated();
    } catch (err) {
      setError(String(err));
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          value={name}
          maxLength={32}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none select-text focus:border-accent/60"
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Create
        </Button>
      </div>
      {error && <p className="text-xs text-[#e66767]">{error}</p>}
    </form>
  );
}

function Onboarding({ onCreated }: { onCreated: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-3">
          <UserRound size={24} className="text-ink-2" />
        </div>
        <h2 className="text-lg font-semibold">Who's mashing?</h2>
        <p className="mt-1 mb-5 text-sm text-ink-3">
          Create a profile to save runs and track your personal best. You can add more anytime.
        </p>
        <NewProfileForm autoFocus onCreated={onCreated} />
      </div>
    </div>
  );
}
