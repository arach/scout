import { useState, type ReactNode } from "react";
import { api } from "../../lib/api.ts";
import { ScoutMark } from "../../components/ScoutMark.tsx";
import { useScout, type OnboardingState } from "../Provider.tsx";
import { friendlyOnboardingError } from "./onboarding-errors.ts";
import { OnboardingHarnessPicker, onboardingHarnessDefault } from "./OnboardingHarnessPicker.tsx";

// Step 4 (SetupStep) only appears when the broker or agent still needs a check.
const TOTAL_STEPS = 3;

/** Apply the state observed by the write, avoiding an immediate duplicate read. */
export async function submitOnboardingMutation(
  path: string,
  body: Record<string, unknown>,
  refreshOnboarding: (state?: OnboardingState) => Promise<void>,
) {
  const result = await api<{ state?: OnboardingState }>(path, {
    method: "POST", body: JSON.stringify(body),
  });
  // Older servers may omit the additive state field; the provider refreshes then.
  await refreshOnboarding(result.state);
}

/* ── Top-level takeover — picks the first unresolved step and renders it ─── */
export function OnboardingTakeover() {
  const { onboarding } = useScout();
  if (!onboarding) return null;

  if (!onboarding.hasLocalConfig) return <Frame><PortsStep step={1} /></Frame>;
  if (!onboarding.hasOperatorName) return <Frame><NameStep step={2} /></Frame>;
  const chosenContext = onboarding.contextRoot ?? onboarding.projectRoot ?? onboarding.suggestedContextRoot;
  if (!onboarding.hasProjectConfig || !chosenContext) return <Frame><ProjectStep step={3} /></Frame>;
  // `needed === true` only comes from a real /api/onboarding/state response;
  // a missing `needed` means we are looking at a client-side placeholder and
  // must not take over the app.
  if (onboarding.needed === true && (!onboarding.brokerReachable || !onboarding.hasReadyRuntime)) {
    return <Frame><SetupStep step={4} /></Frame>;
  }
  return null;
}

/* ── Status panel — the same chrome, for hosts that wait on the state read ── */
export function OnboardingNotice({
  title,
  description,
  error,
  action,
  onAction,
  busy,
}: {
  title: string;
  description: ReactNode;
  error?: string | null;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  return (
    <Frame>
      <Header eyebrow="First-run setup" title={title} description={description} />
      <ErrorBanner message={error ?? null} />
      {action && onAction ? (
        <div>
          <button
            type="button"
            onClick={onAction}
            disabled={busy}
            style={{ ...primaryButtonStyle, opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer" }}
          >
            {busy ? "Working…" : action}
          </button>
        </div>
      ) : null}
    </Frame>
  );
}

/* ── Shared chrome — centered card, skip button is wired from each step ──── */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflow: "auto",
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "auto",
          flexShrink: 0,
          padding: "clamp(28px, 6vw, 80px) clamp(24px, 6vw, 72px)",
          display: "flex",
          flexDirection: "column",
          gap: 40,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Header({ eyebrow, title, description }: { eyebrow: string; title: string; description: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={eyebrowStyle}>{eyebrow}</div>
      <h1 style={{ ...titleStyle, margin: 0 }}>{title}</h1>
      <div style={descStyle}>{description}</div>
    </div>
  );
}

function Actions({
  primary,
  onPrimary,
  primaryDisabled,
  busy,
  foot,
}: {
  primary: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  busy?: boolean;
  foot?: ReactNode;
}) {
  const { skipOnboarding, onboardingError } = useScout();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled || busy}
          style={{
            ...primaryButtonStyle,
            opacity: primaryDisabled || busy ? 0.5 : 1,
            cursor: primaryDisabled || busy ? "default" : "pointer",
          }}
        >
          {busy ? "Working…" : primary}
        </button>
        <button
          type="button"
          onClick={skipOnboarding}
          style={skipLinkStyle}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--hud-ink)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--hud-muted)"; }}
        >
          Set up later
        </button>
      </div>
      {foot ? <div style={footStyle}>{foot}</div> : null}
      {onboardingError?.kind === "skip" ? (
        <div role="alert" style={{ fontSize: 12, color: "var(--hud-status-error)", lineHeight: 1.5 }}>
          Couldn't save "Set up later". {onboardingError.message}
        </div>
      ) : null}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--hud-status-error) 35%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--hud-status-error) 8%, transparent)",
        color: "var(--hud-status-error)",
        padding: "12px 16px",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
}

/* ── Step 0 — write ~/.openscout/config.json (ports) ────────────────────── */
// The steps ahead, phrased as things to do — the first screen never opens on
// what's missing.
const WELCOME_TODO = [
  { label: "Set up this Mac", detail: "Local settings and Scout's own service" },
  { label: "Add your name", detail: "It goes on the messages you send" },
  { label: "Choose your projects", detail: "Where your repos live, and the agent you prefer" },
];

function PortsStep({ step }: { step: number }) {
  const { onboarding, refreshOnboarding } = useScout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = (onboarding?.harnesses ?? []).filter((harness) => harness.state !== "missing");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitOnboardingMutation("/api/onboarding/init", {}, refreshOnboarding);
    } catch (err) {
      setError(friendlyOnboardingError("init", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          aria-label={`First-run setup, step ${step} of ${TOTAL_STEPS}`}
          style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--hud-accent)" }}
        >
          <ScoutMark className="size-[22px] shrink-0" />
          <span style={{ fontSize: 15, fontWeight: 400, letterSpacing: "-0.01em", color: "var(--hud-ink)" }}>Scout</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ ...titleStyle, margin: 0 }}>Welcome to Scout</h1>
          <div style={descStyle}>
            Scout connects the coding agents on this Mac, so you can give them work, follow what they do, and pick up where they left off.
          </div>
        </div>
      </div>
      <ol style={{ ...checklistStyle, gap: 16 }}>
        {WELCOME_TODO.map((item, index) => (
          <li key={item.label} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 14,
                height: 14,
                marginTop: 3,
                borderRadius: 4,
                border: `0.5px solid ${index === 0 ? "var(--hud-accent)" : "var(--hud-border)"}`,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--hud-ink)" }}>{item.label}</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--hud-muted)" }}>{item.detail}</div>
            </div>
          </li>
        ))}
      </ol>
      {found.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, paddingTop: 14, borderTop: "0.5px solid var(--hud-border)" }}>
          <span style={footStyle}>Already on this Mac</span>
          <span style={{ fontSize: 12, color: "var(--hud-ink)" }}>{found.map((harness) => harness.label).join(" · ")}</span>
        </div>
      ) : null}
      <ErrorBanner message={error} />
      <Actions
        primary="Set up this Mac"
        onPrimary={() => { void run(); }}
        busy={busy}
        foot="About a minute · stays on this Mac · no account"
      />
    </>
  );
}

/* ── Step 1 — operator name (writes user.json) ──────────────────────────── */
function NameStep({ step }: { step: number }) {
  const { onboarding, refreshOnboarding } = useScout();
  const suggestion = onboarding?.operatorNameSuggestion ?? "";
  const [name, setName] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name is required."); return; }
    setBusy(true);
    setError(null);
    try {
      await submitOnboardingMutation("/api/user", { name: trimmed }, refreshOnboarding);
    } catch (err) {
      setError(friendlyOnboardingError("identity", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        eyebrow={`Identity · Step ${step} of ${TOTAL_STEPS}`}
        title="What should we call you?"
        description="Your name shows up on messages you send and in any agent that speaks for you. You can change it later in Settings."
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label htmlFor="scout-onboarding-name" style={labelStyle}>Your name</label>
        <input
          id="scout-onboarding-name"
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) { void run(); } }}
          placeholder={suggestion || "Operator"}
          style={inputStyle}
        />
        {suggestion ? (
          <div style={{ fontSize: 11, color: "var(--hud-muted)", fontFamily: "var(--hud-font-mono)" }}>
            Prefilled from your machine.
          </div>
        ) : null}
      </div>
      <ErrorBanner message={error} />
      <Actions primary="Continue" onPrimary={() => { void run(); }} busy={busy} primaryDisabled={!name.trim()} />
    </>
  );
}

/* ── Step 2 — source roots + harness ────────────────────────────────────── */
function ProjectStep({ step }: { step: number }) {
  const { onboarding, refreshOnboarding } = useScout();
  const suggestedContext = onboarding?.suggestedContextRoot ?? onboarding?.contextRoot ?? onboarding?.projectRoot ?? "";
  const placeholderPath = onboarding?.sourceRoots?.[0] || "~/dev";
  const [roots, setRoots] = useState<string[]>(() => onboarding?.sourceRoots?.length ? [...onboarding.sourceRoots] : [placeholderPath]);
  const [contextRoot, setContextRoot] = useState<string>(suggestedContext);
  const [harness, setHarness] = useState(() => onboardingHarnessDefault(onboarding?.defaultHarness));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRootAt = (i: number, v: string) => {
    setRoots((current) => current.map((r, idx) => (idx === i ? v : r)));
  };
  const addRoot = () => setRoots((current) => [...current, ""]);
  const removeRoot = (i: number) => setRoots((current) => current.filter((_, idx) => idx !== i));

  const run = async () => {
    const cleanRoots = roots.map((r) => r.trim()).filter(Boolean);
    const cleanContext = contextRoot.trim();
    if (!cleanContext) { setError("Choose a workspace folder for Scout."); return; }
    setBusy(true);
    setError(null);
    try {
      await submitOnboardingMutation("/api/onboarding/project", {
        contextRoot: cleanContext,
        sourceRoots: cleanRoots,
        defaultHarness: harness,
      }, refreshOnboarding);
    } catch (err) {
      setError(friendlyOnboardingError("project", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        eyebrow={`Project · Step ${step} of ${TOTAL_STEPS}`}
        title="Where do your repos live?"
        description="Choose the folders Scout should look in for projects, where to save your workspace settings, and the coding agent you prefer."
      />

      <div style={sectionStyle}>
        <label style={labelStyle}>Scan folders</label>
        <div style={hintStyle}>Choose existing folders. You can use the same folder for scanning and your workspace.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roots.map((root, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input
                aria-label={`Scan folder ${i + 1}`}
                value={root}
                onChange={(e) => setRootAt(i, e.target.value)}
                placeholder={i === 0 ? placeholderPath : "Add another folder"}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => removeRoot(i)}
                disabled={roots.length <= 1}
                style={{
                  ...secondaryButtonStyle,
                  opacity: roots.length <= 1 ? 0.4 : 1,
                  cursor: roots.length <= 1 ? "default" : "pointer",
                }}
                aria-label={`Remove folder ${i + 1}`}
              >
                −
              </button>
            </div>
          ))}
          <button type="button" onClick={addRoot} style={{ ...secondaryButtonStyle, alignSelf: "flex-start" }}>
            + Add folder
          </button>
        </div>
      </div>

      <div style={sectionStyle}>
        <label htmlFor="scout-onboarding-context" style={labelStyle}>Workspace folder</label>
        <input
          id="scout-onboarding-context"
          value={contextRoot}
          onChange={(e) => setContextRoot(e.target.value)}
          placeholder="Choose an existing project folder"
          style={inputStyle}
        />
        <div style={hintStyle}>
          Scout saves its project settings in this folder.
        </div>
        <div style={hintStyle}>Tip: ~ expands to your home folder.</div>
      </div>

      <OnboardingHarnessPicker value={harness} onChange={setHarness} observations={onboarding?.harnesses} />

      <ErrorBanner message={error} />
      <Actions
        primary="Save project settings"
        onPrimary={() => { void run(); }}
        busy={busy}
        primaryDisabled={!contextRoot.trim()}
      />
    </>
  );
}

/* Step 3: run setup and verify runtime readiness. */
function SetupStep({ step }: { step: number }) {
  const { onboarding, refreshOnboarding } = useScout();
  const [harness, setHarness] = useState(() => onboardingHarnessDefault(onboarding?.defaultHarness));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = onboarding?.harnesses?.find((entry) => entry.id === harness)
    ?? (onboarding?.selectedHarness?.id === harness ? onboarding.selectedHarness : null);
  const command = selected?.state === "missing" ? selected.installCommand
    : selected?.state === "installed" ? selected.loginCommand : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let result: { state?: OnboardingState; brokerWarning?: string | null } = {};
      if (harness !== onboarding?.defaultHarness) {
        result = await api("/api/onboarding/project", {
          method: "POST", body: JSON.stringify({
            contextRoot: onboarding?.contextRoot ?? onboarding?.projectRoot ?? onboarding?.suggestedContextRoot,
            sourceRoots: onboarding?.sourceRoots ?? [], defaultHarness: harness,
          }),
        });
      } else if (!onboarding?.brokerReachable) {
        result = await api("/api/onboarding/setup", { method: "POST", body: "{}" });
      }
      await refreshOnboarding(result.state);
      if (result.brokerWarning) {
        setError(friendlyOnboardingError("setup", result.brokerWarning));
      }
    } catch (err) {
      setError(friendlyOnboardingError("setup", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        eyebrow="Setup · One more check"
        title="Finish setup"
        description="Scout checks the local setup of your chosen coding agent. Your first task will confirm that it can connect and reply."
      />
      <ul style={checklistStyle}>
        <Row
          label="Project settings"
          done={Boolean(onboarding?.hasProjectConfig)}
          hint={onboarding?.projectConfigPath ?? onboarding?.projectRoot ?? undefined}
        />
        <Row
          label="Scout's local service"
          done={Boolean(onboarding?.brokerReachable)}
          hint={onboarding?.brokerReachable ? "connected" : "starts when you run setup"}
        />
        <Row
          label={selected?.label ?? "Your chosen coding agent"}
          done={selected?.ready === true}
          hint={selected?.detail ?? "Scout couldn't check this agent. Check again, or choose another agent below."}
        />
      </ul>
      {command ? <div style={sectionStyle}>
        <div style={descStyle}>{selected?.state === "missing" ? "Install this agent in Terminal:" : "Sign in to this agent in Terminal:"}</div>
        <code style={{ ...inputStyle, display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{command}</code>
        <div style={hintStyle}>Then return to Scout and choose Check again.</div>
      </div> : null}
      {selected?.state === "configured" && !selected.ready ? <p style={descStyle}>
        Sign-in needs to be confirmed by the agent itself. Choose Set up later to try a task, or choose another agent below.
      </p> : null}
      {selected?.homepage ? <a href={selected.homepage} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 13 }}>
        {selected.label} setup guide ↗
      </a> : null}
      <OnboardingHarnessPicker value={harness} onChange={setHarness} observations={onboarding?.harnesses} />
      <ErrorBanner message={error} />
      <Actions
        primary={harness !== onboarding?.defaultHarness ? "Use this agent" : onboarding?.brokerReachable ? "Check again" : "Run setup"}
        onPrimary={() => { void run(); }}
        busy={busy}
      />
    </>
  );
}

/* ── Small bits ─────────────────────────────────────────────────────────── */
function Row({ label, done, hint }: { label: string; done: boolean; hint?: string }) {
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
      <span
        style={{
          marginTop: 2,
          width: 20,
          height: 20,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          backgroundColor: done ? "color-mix(in srgb, var(--hud-status-ok) 15%, transparent)" : "var(--hud-surface)",
          color: done ? "var(--hud-status-ok)" : "var(--hud-muted)",
        }}
      >
        {done ? "✓" : "•"}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: done ? "var(--hud-muted)" : "var(--hud-ink)" }}>
          {label}
        </div>
        {hint ? (
          <div style={{ fontSize: 11, fontFamily: "var(--hud-font-mono)", color: "var(--hud-muted)", marginTop: 4, wordBreak: "break-all" }}>
            {hint}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */
const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--hud-font-mono)",
  fontWeight: 300,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--hud-muted)",
};
const titleStyle: React.CSSProperties = {
  fontSize: "clamp(24px, 3vw, 28px)",
  fontWeight: 300,
  letterSpacing: "-0.025em",
  lineHeight: 1.15,
};
const descStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 300,
  lineHeight: 1.6,
  color: "var(--hud-muted)",
  maxWidth: 580,
};
const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--hud-font-mono)",
  fontWeight: 300,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--hud-muted)",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  fontSize: 12,
  fontFamily: "var(--hud-font-mono)",
  fontWeight: 300,
  letterSpacing: "-0.02em",
  color: "var(--hud-ink)",
  backgroundColor: "var(--hud-surface)",
  border: "1px solid var(--hud-border)",
  borderRadius: 8,
  boxSizing: "border-box",
};
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--hud-muted)",
  lineHeight: 1.6,
};
const primaryButtonStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: "-0.01em",
  padding: "12px 24px",
  borderRadius: 10,
  backgroundColor: "var(--hud-accent)",
  color: "oklch(var(--accent-foreground))",
  border: "none",
  transition: "opacity 0.15s ease",
};
const secondaryButtonStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  letterSpacing: "-0.01em",
  padding: "10px 14px",
  borderRadius: 8,
  backgroundColor: "var(--hud-surface)",
  border: "1px solid var(--hud-border)",
  color: "var(--hud-ink)",
  transition: "all 0.15s ease",
};
const skipLinkStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--hud-muted)",
  textDecoration: "underline dotted var(--hud-muted)",
  textUnderlineOffset: 4,
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "4px 2px",
  transition: "color 0.15s ease",
};
const footStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--hud-font-mono)",
  fontWeight: 300,
  letterSpacing: "0.01em",
  color: "var(--hud-muted)",
  lineHeight: 1.5,
};
const checklistStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  margin: 0,
  padding: 0,
  listStyle: "none",
};
