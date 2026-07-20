"use client";

import { useMemo, useState } from "react";
import catalog from "@/catalog/blocklists.json";

type Platform = "macos" | "linux" | "windows";
type Protection = "balanced" | "heavy" | "maximum";
type ServerCheck = "idle" | "checking" | "auth-required" | "passed" | "failed";
type ApplyState = "idle" | "applying" | "passed" | "failed" | "rolling-back";
type CompatibilityState = "idle" | "checking" | "passed" | "failed";

type PiHoleSession = {
  baseUrl: string;
  sid: string;
  version: string;
};

type CatalogList = (typeof catalog.lists)[number];
type CatalogProfile = (typeof catalog.profiles)[number];

const steps = [
  { label: "Requirements", detail: "Check and install what is missing" },
  { label: "Tailscale", detail: "Authenticate before appliance setup" },
  { label: "Find server", detail: "Connect to your shelf device" },
  { label: "Protection", detail: "Choose a blocklist profile" },
  { label: "Test & finish", detail: "Verify and save access links" },
];

const profiles = Object.fromEntries(catalog.profiles.map((profile) => [profile.id, profile])) as Record<Protection, CatalogProfile>;
const lists = Object.fromEntries(catalog.lists.map((list) => [list.id, list])) as Record<string, CatalogList>;

const platformData: Record<Platform, { label: string; file: string; runLabel: string }> = {
  macos: { label: "macOS", file: "bootstrap-macos.sh", runLabel: "Terminal" },
  linux: { label: "Linux appliance", file: "bootstrap-linux.sh", runLabel: "Terminal" },
  windows: { label: "Windows", file: "bootstrap-windows.ps1", runLabel: "PowerShell" },
};

function ShieldMark() {
  return <span className="shield-mark" aria-hidden="true">P</span>;
}

function normalizeServerAddress(entered: string) {
  const candidate = entered.match(/^https?:\/\//i) ? entered : `http://${entered}`;
  const parsed = new URL(candidate);
  return `${parsed.protocol}//${parsed.host}`;
}

function versionLabel(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Pi-hole v6";
  const version = payload as { version?: { core?: { local?: { version?: string } }; ftl?: { local?: { version?: string } } } };
  return version.version?.core?.local?.version || version.version?.ftl?.local?.version || "Pi-hole v6";
}

export default function Home() {
  const [activeStep, setActiveStep] = useState(0);
  const [platform, setPlatform] = useState<Platform>("macos");
  const [copied, setCopied] = useState(false);
  const [bootstrapConfirmed, setBootstrapConfirmed] = useState(false);
  const [tailscaleConfirmed, setTailscaleConfirmed] = useState(false);
  const [protection, setProtection] = useState<Protection>("heavy");
  const [serverAddress, setServerAddress] = useState("");
  const [verifiedAdminUrl, setVerifiedAdminUrl] = useState("");
  const [serverCheck, setServerCheck] = useState<ServerCheck>("idle");
  const [serverError, setServerError] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [piHoleSession, setPiHoleSession] = useState<PiHoleSession | null>(null);
  const [appleTelemetry, setAppleTelemetry] = useState(false);
  const [windowsTelemetry, setWindowsTelemetry] = useState(false);
  const [manualLists, setManualLists] = useState("");
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [applyMessage, setApplyMessage] = useState("");
  const [lastAddedUrls, setLastAddedUrls] = useState<string[]>([]);
  const [compatibility, setCompatibility] = useState<Record<string, CompatibilityState>>(() => Object.fromEntries(catalog.compatibilityChecks.map((check) => [check.id, "idle"])));
  const [finished, setFinished] = useState(false);

  const percent = useMemo(() => finished ? 100 : Math.round(((activeStep + 1) / steps.length) * 100), [activeStep, finished]);

  const installCommand = () => {
    const origin = window.location.origin;
    if (platform === "windows") {
      return `$url='${origin}/install/bootstrap-windows.ps1'; $out="$env:TEMP\\pie-bootstrap.ps1"; Invoke-WebRequest $url -OutFile $out; powershell -ExecutionPolicy Bypass -File $out`;
    }
    const file = platformData[platform].file;
    const role = platform === "linux" ? " --role appliance" : "";
    return `curl -fsSL ${origin}/install/${file} -o /tmp/pie-bootstrap.sh && bash /tmp/pie-bootstrap.sh${role}`;
  };

  const copyInstallCommand = async () => {
    await navigator.clipboard.writeText(installCommand());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const piHoleFetch = async (path: string, init: RequestInit = {}) => {
    if (!piHoleSession) throw new Error("Connect to Pi-hole first.");
    const headers = new Headers(init.headers);
    if (piHoleSession.sid) headers.set("X-FTL-SID", piHoleSession.sid);
    return fetch(`${piHoleSession.baseUrl}/api${path}`, { ...init, headers, cache: "no-store" });
  };

  const verifyVersion = async (baseUrl: string, sid = "") => {
    const headers = sid ? { "X-FTL-SID": sid } : undefined;
    const response = await fetch(`${baseUrl}/api/info/version`, { headers, cache: "no-store" });
    if (!response.ok) throw new Error("Pi-hole accepted the login but its version endpoint did not respond.");
    return versionLabel(await response.json());
  };

  const testServerAddress = async () => {
    const entered = serverAddress.trim();
    if (!entered) {
      setServerCheck("failed");
      setServerError("Enter the Tailscale IP, MagicDNS name, or LAN address printed by the installer.");
      return;
    }

    setServerCheck("checking");
    setServerError("");
    setVerifiedAdminUrl("");
    let baseUrl: string;
    try {
      baseUrl = normalizeServerAddress(entered);
    } catch {
      setServerCheck("failed");
      setServerError("That address is not valid.");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const authResponse = await fetch(`${baseUrl}/api/auth`, { signal: controller.signal, cache: "no-store" });
      const authPayload = await authResponse.json().catch(() => null) as { session?: { valid?: boolean; sid?: string | null } } | null;
      if (authResponse.ok && authPayload?.session?.valid) {
        const sid = authPayload.session.sid || "";
        const version = await verifyVersion(baseUrl, sid);
        setPiHoleSession({ baseUrl, sid, version });
        setVerifiedAdminUrl(`${baseUrl}/admin/`);
        setServerCheck("passed");
      } else if (authResponse.status === 401 && authPayload?.session) {
        setPiHoleSession({ baseUrl, sid: "", version: "" });
        setServerCheck("auth-required");
      } else {
        throw new Error("The address responded, but it did not identify itself as Pi-hole v6.");
      }
    } catch {
      setServerCheck("failed");
      setServerError("Could not reach the Pi-hole v6 API. Confirm Tailscale is connected and the address is correct.");
    } finally {
      window.clearTimeout(timer);
    }
  };

  const authenticatePiHole = async () => {
    if (!piHoleSession?.baseUrl || !adminPassword) return;
    setServerCheck("checking");
    setServerError("");
    try {
      const response = await fetch(`${piHoleSession.baseUrl}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
        cache: "no-store",
      });
      const payload = await response.json() as { session?: { valid?: boolean; sid?: string | null }; error?: { message?: string } };
      if (!response.ok || !payload.session?.valid || !payload.session.sid) throw new Error(payload.error?.message || "Pi-hole rejected that password.");
      const version = await verifyVersion(piHoleSession.baseUrl, payload.session.sid);
      setPiHoleSession({ baseUrl: piHoleSession.baseUrl, sid: payload.session.sid, version });
      setAdminPassword("");
      setVerifiedAdminUrl(`${piHoleSession.baseUrl}/admin/`);
      setServerCheck("passed");
    } catch (error) {
      setServerCheck("auth-required");
      setServerError(error instanceof Error ? error.message : "Pi-hole authentication failed.");
    }
  };

  const selectedListUrls = () => {
    const ids = [...profiles[protection].listIds];
    if (appleTelemetry) ids.push("hagezi-native-apple");
    if (windowsTelemetry) ids.push("hagezi-native-windows");
    const curated = ids.map((id) => lists[id].url);
    const manual = manualLists.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    for (const url of manual) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error(`Manual list must use HTTPS: ${url}`);
    }
    if (manual.length > 10) throw new Error("Add no more than 10 manual lists at a time.");
    return [...new Set([...curated, ...manual])];
  };

  const runCompatibilityChecks = async () => {
    setCompatibility(Object.fromEntries(catalog.compatibilityChecks.map((check) => [check.id, "checking"])));
    const outcomes = await Promise.all(catalog.compatibilityChecks.map(async (check) => {
      try {
        await fetch(check.url, { mode: "no-cors", cache: "no-store" });
        return [check.id, "passed"] as const;
      } catch {
        return [check.id, "failed"] as const;
      }
    }));
    setCompatibility(Object.fromEntries(outcomes));
  };

  const runGravity = async () => {
    const response = await piHoleFetch("/action/gravity", { method: "POST" });
    if (!response.ok) throw new Error("Pi-hole could not update gravity.");
    await response.text();
  };

  const rollbackAddedLists = async (urls = lastAddedUrls) => {
    if (!urls.length) return;
    setApplyState("rolling-back");
    try {
      const response = await piHoleFetch("/lists:batchDelete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(urls.map((item) => ({ item, type: "block" }))),
      });
      if (!response.ok && response.status !== 404) throw new Error("Pi-hole could not remove the newly added lists.");
      await runGravity();
      setLastAddedUrls([]);
      setApplyState("idle");
      setApplyMessage("The lists added by the last profile change were removed and gravity was rebuilt.");
    } catch (error) {
      setApplyState("failed");
      setApplyMessage(error instanceof Error ? error.message : "Rollback failed.");
    }
  };

  const applyProtectionProfile = async () => {
    setApplyState("applying");
    setApplyMessage("Reading the current Pi-hole lists…");
    let added: string[] = [];
    try {
      const urls = selectedListUrls();
      const currentResponse = await piHoleFetch("/lists?type=block");
      if (!currentResponse.ok) throw new Error("Could not read the existing Pi-hole lists.");
      const currentPayload = await currentResponse.json() as { lists?: Array<{ address?: string }> };
      const existing = new Set((currentPayload.lists || []).map((item) => item.address).filter(Boolean));
      added = urls.filter((url) => !existing.has(url));
      if (added.length) {
        setApplyMessage(`Adding ${added.length} verified blocklist${added.length === 1 ? "" : "s"}…`);
        const addResponse = await piHoleFetch("/lists?type=block", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: added, comment: `Pie AES256 Hole: ${profiles[protection].title}`, groups: [0], enabled: true }),
        });
        if (!addResponse.ok) throw new Error("Pi-hole rejected one or more blocklists.");
      }
      setLastAddedUrls(added);
      setApplyMessage("Rebuilding Pi-hole gravity. Large threat feeds can take a few minutes…");
      await runGravity();
      setApplyState("passed");
      setApplyMessage(`${profiles[protection].title} protection is active. ${added.length ? `${added.length} new list${added.length === 1 ? " was" : "s were"} added.` : "All selected lists were already installed."}`);
      await runCompatibilityChecks();
    } catch (error) {
      if (added.length) await rollbackAddedLists(added);
      else setApplyState("failed");
      setApplyMessage(error instanceof Error ? error.message : "Protection profile installation failed.");
    }
  };

  const advance = () => {
    if (activeStep === steps.length - 1) { setFinished(true); return; }
    setActiveStep((step) => Math.min(step + 1, steps.length - 1));
  };

  const compatibilityComplete = Object.values(compatibility).every((state) => state === "passed" || state === "failed");
  const continueDisabled = (activeStep === 0 && !bootstrapConfirmed) || (activeStep === 1 && !tailscaleConfirmed) || (activeStep === 2 && serverCheck !== "passed") || (activeStep === 3 && applyState !== "passed") || (activeStep === 4 && !compatibilityComplete);

  if (finished) {
    return (
      <main className="finish-page">
        <section className="finish-card">
          <ShieldMark />
          <p className="eyebrow">SETUP HANDOFF</p>
          <h1>Ready for <em>the shelf.</em></h1>
          <p className="lede">Your Pi-hole API was verified, the selected lists were applied, gravity was rebuilt, and your service checks were recorded. Keep these private access links.</p>
          <div className="access-links">
            <a href={verifiedAdminUrl} target="_blank" rel="noreferrer"><span>Verified appliance</span><strong>{verifiedAdminUrl}</strong><small>Open Pi-hole admin →</small></a>
            <a href="https://login.tailscale.com/admin/machines" target="_blank" rel="noreferrer"><span>Tailscale</span><strong>Machines & private addresses</strong><small>Open Tailscale admin →</small></a>
          </div>
          <div className="success-banner"><strong>{profiles[protection].title} protection is active.</strong> Passwords stayed in browser memory only, and the Pi-hole session can expire normally. Use Query Log when a specific app stops working.</div>
          <button className="primary-button finish-button" onClick={() => { setFinished(false); setActiveStep(0); }}>Review setup</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div className="brand-lockup"><ShieldMark /><div><p className="brand-name">Pie AES256 Hole</p><p className="brand-subtitle">Private network guardian</p></div></div>
        <nav className="step-list" aria-label="Setup progress">
          {steps.map((step, index) => {
            const state = index < activeStep ? "done" : index === activeStep ? "active" : "waiting";
            return (
              <button className={`step-item ${state}`} key={step.label} onClick={() => setActiveStep(index)} aria-current={state === "active" ? "step" : undefined}>
                <span className="step-number">{state === "done" ? "✓" : index + 1}</span>
                <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              </button>
            );
          })}
        </nav>
        <div className="privacy-note"><span className="privacy-icon" aria-hidden="true">⌁</span><div><strong>Private by default</strong><p>Authentication happens with Tailscale. Passwords are never collected by this console.</p></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="progress-copy"><span>SETUP PROGRESS</span><strong>{percent}%</strong></div>
          <div className="progress-track" aria-label={`${percent}% complete`}><span style={{ width: `${percent}%` }} /></div>
          <a className="help-button" href="https://github.com/AES256Afro/PieAES256Hole/issues" target="_blank" rel="noreferrer">Need help?</a>
        </header>

        <div className="content-wrap">
          {activeStep === 0 && (
            <section className="setup-view compact-view">
              <p className="eyebrow">STEP 1 · REQUIREMENTS</p>
              <h1>Check once. Install <em>what is missing.</em></h1>
              <p className="lede">The bootstrap checks platform support, installs Tailscale and Docker when needed, deploys Pi-hole with persistent storage, starts everything, and saves a machine-readable status report.</p>
              <div className="platform-tabs" role="group" aria-label="Choose a platform">
                {(Object.keys(platformData) as Platform[]).map((id) => <button key={id} className={platform === id ? "selected" : ""} onClick={() => { setPlatform(id); setBootstrapConfirmed(false); }}>{platformData[id].label}</button>)}
              </div>
              <div className="bootstrap-card">
                <div className="bootstrap-head"><span className="mode-symbol" aria-hidden="true">⌘</span><div><span className="mode-eyebrow">AUTOMATED PRE-FLIGHT</span><h2>Run in {platformData[platform].runLabel}</h2></div></div>
                <p>One administrator approval may appear for system software. Docker displays its separate license terms before installation. Pi-hole receives a generated admin password, persistent configuration, automatic restart, and a verified admin address.</p>
                <div className="bootstrap-actions">
                  <button className="primary-button" onClick={copyInstallCommand}>{copied ? "Copied" : "Copy & run command"}</button>
                  <a className="secondary-button download-link" href={`/install/${platformData[platform].file}`} download>Download script</a>
                </div>
                <code className="command-preview">{platform === "windows" ? "PowerShell bootstrap with winget" : `bootstrap-${platform}.sh`}</code>
              </div>
              <label className="confirmation-box"><input type="checkbox" checked={bootstrapConfirmed} onChange={(event) => setBootstrapConfirmed(event.target.checked)} /><span><strong>The bootstrap reports Docker and Pi-hole are running</strong><small>Use the exact admin URL printed by the script in the Find server step.</small></span></label>
            </section>
          )}

          {activeStep === 1 && (
            <section className="setup-view compact-view">
              <p className="eyebrow">STEP 2 · TAILSCALE AUTHENTICATION</p>
              <h1>Authenticate first. Then <em>build the network.</em></h1>
              <p className="lede">The bootstrap invokes Tailscale’s own client before it deploys Pi-hole. Sign-in happens only on Tailscale’s official page, and provisioning pauses until the device is connected.</p>
              <div className="provider-card auth-card">
                <div className="provider-logo">∞</div>
                <div><span className="mode-eyebrow">OFFICIAL TAILSCALE SIGN-IN</span><h2>Connect this device</h2><p>Open the admin page to confirm the device appears and is connected. The bootstrap-generated login URL is the authoritative device authorization.</p></div>
                <a className="secondary-button provider-link" href="https://login.tailscale.com/admin/machines" target="_blank" rel="noreferrer">Open secure sign-in</a>
              </div>
              <label className="confirmation-box"><input type="checkbox" checked={tailscaleConfirmed} onChange={(event) => setTailscaleConfirmed(event.target.checked)} /><span><strong>I see this device as connected in Tailscale</strong><small>Do not continue if it is still waiting for approval or authentication.</small></span></label>
              <div className="safety-banner"><strong>Why this comes first:</strong> setup can use the private Tailscale path for discovery, testing, and recovery instead of exposing the appliance publicly.</div>
            </section>
          )}

          {activeStep === 2 && (
            <section className="setup-view compact-view">
              <p className="eyebrow">STEP 3 · FIND SERVER</p><h1>Let’s find your <em>shelf device.</em></h1>
              <p className="lede">Enter the appliance’s existing LAN IP, Tailscale IP, or MagicDNS name. The console verifies Pi-hole’s v6 API before it enables any configuration action.</p>
              <div className="form-card">
                <label htmlFor="server-address">Existing device address</label>
                <div className="address-row">
                  <input id="server-address" placeholder="Example: 100.101.102.103 or my-pi.tailnet.ts.net" value={serverAddress} onChange={(event) => { setServerAddress(event.target.value); setServerCheck("idle"); setVerifiedAdminUrl(""); setPiHoleSession(null); setApplyState("idle"); }} />
                  <button className="secondary-button" onClick={testServerAddress} disabled={serverCheck === "checking"}>{serverCheck === "checking" ? "Testing…" : "Test address"}</button>
                </div>
                {serverCheck === "auth-required" && (
                  <div className="password-row">
                    <div><label htmlFor="pihole-password">Pi-hole administrator password</label><small>Sent directly from this browser to Pi-hole. It is never saved by this console.</small></div>
                    <input id="pihole-password" type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void authenticatePiHole(); }} />
                    <button className="secondary-button" onClick={authenticatePiHole} disabled={!adminPassword}>Authenticate</button>
                  </div>
                )}
                <div className={`discovery-result ${serverCheck}`}>
                  <span className="status-dot" />
                  <div>
                    <strong>{serverCheck === "passed" ? `${piHoleSession?.version || "Pi-hole v6"} verified` : serverCheck === "auth-required" ? "Pi-hole found — authentication required" : serverCheck === "failed" ? "Pi-hole could not be verified" : serverCheck === "checking" ? "Checking the Pi-hole API" : "Waiting for a real address"}</strong>
                    <p>{serverCheck === "passed" ? verifiedAdminUrl : serverCheck === "auth-required" ? (serverError || "Enter the administrator password generated by the installer.") : serverCheck === "failed" ? serverError : serverAddress || "No appliance has been discovered yet."}</p>
                  </div>
                  <span className="safe-label">{serverCheck === "passed" ? "Verified" : serverCheck === "auth-required" ? "Private" : "Required"}</span>
                </div>
              </div>
              <div className="safety-banner"><strong>No false links.</strong> Continue remains locked until the address authenticates against Pi-hole’s supported API and returns its version.</div>
            </section>
          )}

          {activeStep === 3 && (
            <section className="setup-view compact-view">
              <p className="eyebrow">STEP 4 · PROTECTION</p><h1>Choose your <em>protection level.</em></h1><p className="lede">Profiles use reviewed HaGeZi sources. The console adds only missing lists, rebuilds gravity, and remembers exactly what it added so the change can be rolled back.</p>
              <div className="profile-list">{(Object.keys(profiles) as Protection[]).map((id) => <button key={id} className={`profile-row ${protection === id ? "selected" : ""}`} onClick={() => { setProtection(id); setApplyState("idle"); }}><span className="profile-radio" /><span className="profile-copy"><strong>{profiles[id].title}</strong><small>{profiles[id].description}</small></span><span className="domain-count">{profiles[id].coverage}</span>{id === "heavy" && <span className="recommended-badge">Recommended</span>}</button>)}</div>
              <div className="privacy-options">
                <div className="option-heading"><div><strong>OS telemetry extensions</strong><small>More privacy, with a higher chance of affecting connected operating-system features.</small></div><span>Optional</span></div>
                <label><input type="checkbox" checked={appleTelemetry} onChange={(event) => { setAppleTelemetry(event.target.checked); setApplyState("idle"); }} /><span><strong>Apple native trackers</strong><small>macOS, iOS and tvOS telemetry. Test App Store, iCloud and device services afterward.</small></span></label>
                <label><input type="checkbox" checked={windowsTelemetry} onChange={(event) => { setWindowsTelemetry(event.target.checked); setApplyState("idle"); }} /><span><strong>Windows and Office native trackers</strong><small>Test Steam, Xbox/Game Pass, achievements, Store and Microsoft 365 afterward.</small></span></label>
              </div>
              <div className="manual-lists">
                <label htmlFor="manual-lists">Manual HTTPS blocklists <span>one URL per line · optional</span></label>
                <textarea id="manual-lists" rows={3} value={manualLists} onChange={(event) => { setManualLists(event.target.value); setApplyState("idle"); }} placeholder="https://example.org/maintained-list.txt" />
              </div>
              <div className={`apply-panel ${applyState}`}>
                <div><strong>{applyState === "passed" ? "Protection applied" : applyState === "applying" ? "Applying protection…" : applyState === "rolling-back" ? "Rolling back…" : applyState === "failed" ? "Protection was not applied" : "Ready to apply safely"}</strong><small>{applyMessage || `${profiles[protection].listIds.length} curated lists selected. Existing Pi-hole lists will be preserved.`}</small></div>
                <div className="apply-actions"><button className="primary-button" onClick={applyProtectionProfile} disabled={applyState === "applying" || applyState === "rolling-back"}>{applyState === "applying" ? "Working…" : applyState === "passed" ? "Reapply profile" : "Apply profile"}</button>{lastAddedUrls.length > 0 && <button className="back-button rollback-button" onClick={() => void rollbackAddedLists()} disabled={applyState === "applying" || applyState === "rolling-back"}>Rollback added lists</button>}</div>
              </div>
              <p className="catalog-note">Catalog reviewed {catalog.reviewedAt} · {catalog.maintainer.name} · {catalog.maintainer.license} · URLs are fetched by Pi-hole from the maintainer’s release mirror.</p>
            </section>
          )}

          {activeStep === 4 && (
            <section className="setup-view compact-view">
              <p className="eyebrow">STEP 5 · TEST & FINISH</p><h1>Keep your services. Lose <em>the surveillance.</em></h1><p className="lede">These checks make real browser requests after the gravity update. They confirm basic reachability; sign-in, playback and multiplayer should still receive a quick manual test.</p>
              <div className="test-card">
                <div className="test-row"><span className="test-state passed">✓</span><span>Pi-hole API authenticated</span><small>{piHoleSession?.version || "Verified"}</small></div>
                <div className="test-row"><span className="test-state passed">✓</span><span>{profiles[protection].title} profile and gravity update</span><small>Passed</small></div>
                {catalog.compatibilityChecks.map((check) => { const state = compatibility[check.id]; return <div className="test-row" key={check.id}><span className={`test-state ${state === "passed" ? "passed" : state === "checking" ? "running" : state === "failed" ? "failed" : ""}`}>{state === "passed" ? "✓" : state === "checking" ? "…" : state === "failed" ? "!" : "○"}</span><span>{check.name} basic reachability</span><small>{state === "passed" ? "Reachable" : state === "failed" ? "Review Query Log" : state === "checking" ? "Checking" : "Waiting"}</small></div>; })}
              </div>
              <div className="test-actions"><button className="secondary-button" onClick={runCompatibilityChecks}>Run service checks again</button><a className="secondary-button download-link" href={`${piHoleSession?.baseUrl || ""}/admin/queries`} target="_blank" rel="noreferrer">Open Query Log</a></div>
              {compatibilityComplete && <div className="success-banner"><strong>Checks complete.</strong> A failed reachability check does not automatically allow a broad domain; inspect Pi-hole’s Query Log and allow only the exact dependency you trust.</div>}
            </section>
          )}

          <footer className="action-bar">
            <button className="back-button" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>Back</button>
            <div className="action-note"><span>✓</span> Requirements and authentication come before appliance changes</div>
            <button className="primary-button" onClick={advance} disabled={continueDisabled}>{activeStep === steps.length - 1 ? "Open access handoff" : "Continue"}<span aria-hidden="true">→</span></button>
          </footer>
        </div>
      </section>
    </main>
  );
}
