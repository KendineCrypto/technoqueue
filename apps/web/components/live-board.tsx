"use client";

import type { AgentEvent, AgentProfile, ParsedEvent, ProviderKind, Task, TaskIntegrity, Workflow } from "@technoqueue/core";
import { Activity, Bot, Check, KeyRound, Plus, RefreshCw, Settings2, ShieldAlert, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TaskView = Task & { integrity: TaskIntegrity };
type ProviderConnection = { id: string; provider: ProviderKind; label: string; maskedKey: string; createdAt: string };
type OfficeAgent = AgentProfile & { sessionOwned: boolean; configured: boolean; connectionLabel?: string; connectionMaskedKey?: string; runningTaskId?: string; lastError?: string };
type AgentView = { did: string; label: string; role: string; lastSeen: string; state: "active" | "recent" | "offline"; profile?: OfficeAgent };
type EmployeeMood = "working" | "reviewing" | "done" | "idle" | "offline";

const eventLabels: Record<AgentEvent["type"], string> = {
  agent_online: "clocked in", task_created: "created a new assignment", task_claimed: "picked up",
  task_reclaimed: "reclaimed", task_submitted: "sent to review", review_claimed: "started reviewing",
  task_approved: "approved", task_changes_requested: "sent back for changes", task_failed: "marked as failed",
  office_step_started: "started a workflow step", office_step_completed: "completed a workflow step"
};
const statusLabels: Record<Task["status"], string> = { open: "INBOX", running: "IN PROGRESS", review: "REVIEW", done: "DONE", failed: "FAILED" };
const agentsPerFloor = 8;
let workerAtlasPromise: Promise<string> | undefined;

function buildTransparentWorkerAtlas(): Promise<string> {
  if (workerAtlasPromise) return workerAtlasPromise;
  workerAtlasPromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const cellWidth = Math.floor(canvas.width / 4); const cellHeight = Math.floor(canvas.height / 2);
        const lightBackground = (index: number) => {
          const offset = index * 4; const red = pixels.data[offset]!; const green = pixels.data[offset + 1]!; const blue = pixels.data[offset + 2]!;
          return red >= 235 && green >= 235 && blue >= 235 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 12;
        };
        for (let row = 0; row < 2; row += 1) for (let column = 0; column < 4; column += 1) {
          const left = column * cellWidth; const top = row * cellHeight; const right = left + cellWidth - 1; const bottom = top + cellHeight - 1;
          const visited = new Uint8Array(cellWidth * cellHeight); const queue = new Int32Array(cellWidth * cellHeight); let head = 0; let tail = 0;
          const enqueue = (x: number, y: number) => {
            const local = (y - top) * cellWidth + (x - left); const global = y * canvas.width + x;
            if (visited[local] || !lightBackground(global)) return; visited[local] = 1; queue[tail++] = global;
          };
          for (let x = left; x <= right; x += 1) { enqueue(x, top); enqueue(x, bottom); }
          for (let y = top + 1; y < bottom; y += 1) { enqueue(left, y); enqueue(right, y); }
          while (head < tail) {
            const index = queue[head++]!; const x = index % canvas.width; const y = Math.floor(index / canvas.width); pixels.data[index * 4 + 3] = 0;
            if (x > left) enqueue(x - 1, y); if (x < right) enqueue(x + 1, y); if (y > top) enqueue(x, y - 1); if (y < bottom) enqueue(x, y + 1);
          }
        }
        context.putImageData(pixels, 0, 0); resolve(canvas.toDataURL("image/png"));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error("Worker atlas could not be loaded"));
    image.src = "/game/office-workers.png";
  });
  return workerAtlasPromise;
}

function shortDid(did: string) { return did.length > 26 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did; }
function time(ts: string) { const date = new Date(ts); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }); }
function displayId(id: string) { return id.replace("task-", "TQ-").slice(0, 10).toUpperCase(); }

export function LiveBoard({ workspace }: { workspace: string }) {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [degraded, setDegraded] = useState(false);
  const [integrityAlert, setIntegrityAlert] = useState("");
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [floor, setFloor] = useState(0);
  const [officeAgents, setOfficeAgents] = useState<OfficeAgent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [providers, setProviders] = useState<ProviderConnection[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [eventRoom, setEventRoom] = useState(`tq-${workspace}`);
  const [setupOpen, setSetupOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<OfficeAgent>();
  const [workerAtlas, setWorkerAtlas] = useState<{ url: string; cutout: boolean }>();
  const lastRuntimeWake = useRef(0);

  const refresh = useCallback(async () => {
    const endpoints = ["tasks", "events", "office"].map((name) => fetch(`/api/workspaces/${encodeURIComponent(workspace)}/${name}`, { cache: "no-store" }));
    try {
      const [taskRes, eventRes, officeRes] = await Promise.all(endpoints);
      if (!taskRes?.ok || !eventRes?.ok || !officeRes?.ok) {
        const failed = [taskRes, eventRes, officeRes].find((response) => response && !response.ok);
        const body = failed ? await failed.json().catch(() => ({})) as { error?: string; integrityViolation?: boolean } : {};
        if (body.integrityViolation) setIntegrityAlert(body.error ?? "An unauthorized Technocore change was quarantined.");
        throw new Error(body.error ?? "Refresh failed");
      }
      const taskData = await taskRes.json() as { tasks: TaskView[]; updatedAt: string };
      const eventData = await eventRes.json() as { events: ParsedEvent[] };
      const officeData = await officeRes.json() as { agents: OfficeAgent[]; workflows: Workflow[]; providers: ProviderConnection[]; canManage?: boolean; eventRoom?: string; integrity?: { requiresConfirmation?: boolean } };
      setTasks(taskData.tasks); setEvents(eventData.events); setOfficeAgents(officeData.agents); setWorkflows(officeData.workflows); setProviders(officeData.providers); setAgents(deriveAgents(eventData.events, officeData.agents));
      setCanManage(Boolean(officeData.canManage));
      if (officeData.eventRoom) setEventRoom(officeData.eventRoom);
      setConfirmationRequired(Boolean(officeData.integrity?.requiresConfirmation));
      setUpdatedAt(taskData.updatedAt); setDegraded(false); setIntegrityAlert("");
    } catch { setDegraded(true); } finally { setLoading(false); }
  }, [workspace]);

  const repairIntegrity = useCallback(async () => {
    setRepairing(true);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/integrity/repair`, { method: "POST" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Repair failed");
      setIntegrityAlert(""); await refresh();
    } catch (error) { setIntegrityAlert(error instanceof Error ? error.message : "Repair failed"); }
    finally { setRepairing(false); }
  }, [refresh, workspace]);

  const confirmIntegrity = useCallback(async () => {
    setRepairing(true); setIntegrityAlert("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/integrity/confirm`, { method: "POST" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Confirmation failed");
      setConfirmationRequired(false); await refresh();
    } catch (error) { setIntegrityAlert(error instanceof Error ? error.message : "Confirmation failed"); }
    finally { setRepairing(false); }
  }, [refresh, workspace]);

  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), 6000); return () => window.clearInterval(interval); }, [refresh]);
  useEffect(() => {
    if (!canManage) return;
    const hasPendingWork = tasks.some((task) => task.status === "open" || task.status === "running" || task.status === "review");
    const hasEmployeeWithoutPresence = officeAgents.some((employee) => !employee.paused && !agents.some((agent) => agent.did === employee.did && agent.state === "active"));
    if (!hasPendingWork && !hasEmployeeWithoutPresence) return;
    const now = Date.now();
    if (now - lastRuntimeWake.current < 15_000) return;
    lastRuntimeWake.current = now;
    void fetch(`/api/workspaces/${encodeURIComponent(workspace)}/runtime`, { method: "POST" }).catch(() => undefined);
  }, [agents, canManage, officeAgents, tasks, workspace]);
  useEffect(() => { let active = true; void buildTransparentWorkerAtlas().then((url) => { if (active) setWorkerAtlas({ url, cutout: true }); }).catch(() => { if (active) setWorkerAtlas({ url: "/game/office-workers.png", cutout: false }); }); return () => { active = false; }; }, []);
  const floorCount = Math.max(1, Math.ceil(agents.length / agentsPerFloor));
  useEffect(() => { setFloor((current) => Math.min(current, floorCount - 1)); }, [floorCount]);
  const counts = useMemo(() => Object.fromEntries(["open", "running", "review", "done", "failed"].map((status) => [status, tasks.filter((task) => task.status === status).length])), [tasks]);
  const openTasks = tasks.filter((task) => task.status === "open");
  const visibleAgents = agents.slice(floor * agentsPerFloor, (floor + 1) * agentsPerFloor);
  const firstDayComplete = providers.length > 0 && officeAgents.length > 0 && workflows.length > 0 && tasks.length > 0;

  return <main className={`game-shell ${workerAtlas ? "atlas-ready" : ""} ${workerAtlas && !workerAtlas.cutout ? "atlas-fallback" : ""}`} style={{ "--worker-atlas": workerAtlas ? `url(${workerAtlas.url})` : "none" } as CSSProperties}>
    <header className="game-topbar">
      <div className="game-brand"><span className="game-logo" aria-hidden="true"><i/><i/><i/><i/></span><div><span className="game-kicker">AI OFFICE SIMULATOR</span><h1>TechnoQueue HQ</h1></div></div>
      <div className="game-workspace"><span>WORKSPACE</span><strong>{workspace}</strong></div>
      <div className="game-top-actions"><div className={`server-chip ${degraded ? "is-degraded" : ""}`}><span/>{degraded ? "CONNECTION DEGRADED" : "TECHNOCORE ONLINE"}</div>{canManage ? <><button className="pixel-button" onClick={() => setSetupOpen(true)}><Settings2 size={14}/> OFFICE SETUP</button><button className="pixel-button hire" onClick={() => setHireOpen(true)}><UserPlus size={14}/> HIRE</button><button className="pixel-button primary" onClick={() => setDialog(true)}><Plus size={15}/> NEW TASK</button></> : <Link className="pixel-button hire" href="/signup">CREATE YOUR OFFICE</Link>}</div>
    </header>

    {integrityAlert ? <div className="game-alert"><ShieldAlert size={18}/><strong>UNAUTHORIZED CHANGE BLOCKED</strong><span>{integrityAlert} No AI provider was called.</span><button className="pixel-button" disabled={repairing} onClick={() => void repairIntegrity()}>{repairing ? "REPAIRING…" : "RESTORE TRUSTED STATE"}</button></div> : confirmationRequired ? <div className="game-alert"><ShieldAlert size={18}/><strong>ONE-TIME SECURITY REVIEW</strong><span>This office predates the state firewall. Review the employees, workflows and task files shown below, then activate protected execution.</span><button className="pixel-button" disabled={repairing} onClick={() => void confirmIntegrity()}>{repairing ? "VERIFYING…" : "I REVIEWED IT · ACTIVATE"}</button></div> : degraded && <div className="game-alert"><strong>CONNECTION LOST!</strong><span>Showing the last known state of the office.</span><small>{updatedAt ? `Last synced ${time(updatedAt)}` : "No cached state"}</small></div>}

    {canManage && !loading && !firstDayComplete && <FirstDayChecklist
      providers={providers.length}
      employees={officeAgents.length}
      workflows={workflows.length}
      tasks={tasks.length}
      onSetup={() => setSetupOpen(true)}
      onHire={() => providers.length ? setHireOpen(true) : setSetupOpen(true)}
      onWorkflow={() => setSetupOpen(true)}
      onTask={() => workflows.length ? setDialog(true) : setSetupOpen(true)}
    />}

    <section className="game-dashboard">
      <div className="office-card">
        <div className="office-card-head"><div><span className="tiny-label">LIVE OFFICE</span><strong>{agents.length} EMPLOYEES · {counts.running ?? 0} ACTIVE TASKS</strong></div><div className="floor-switcher"><button onClick={() => setFloor((value) => Math.max(0, value - 1))} disabled={floor === 0} aria-label="Previous floor">‹</button><span>FLOOR {floor + 1} / {floorCount}</span><button onClick={() => setFloor((value) => Math.min(floorCount - 1, value + 1))} disabled={floor === floorCount - 1} aria-label="Next floor">›</button></div><div className="office-legend"><span><i className="legend-dot working"/> Working</span><span><i className="legend-dot review"/> Reviewing</span><span><i className="legend-dot idle"/> Available</span></div></div>
        <div className="office-room" aria-label={`Live pixel art agent office, floor ${floor + 1} of ${floorCount}`}>
          <div className="sun-stripe"/><BossDesk tasks={openTasks} onCreate={() => canManage && setDialog(true)}/><div className="paper-route route-one" aria-hidden="true"/><div className="paper-route route-two" aria-hidden="true"/>
          <div className={`employee-floor employee-count-${Math.min(visibleAgents.length, agentsPerFloor)}`}>
            {agents.length ? visibleAgents.map((agent, index) => <EmployeeDesk key={agent.did} agent={agent} index={index} tasks={tasks} workspace={workspace} onEdit={() => canManage && agent.profile && setEditingAgent(agent.profile)}/>) : <div className="empty-office"><div className="empty-office-icon"><span/><span/><span/></div><strong>{loading ? "OPENING THE OFFICE…" : "THE OFFICE IS EMPTY"}</strong><p>{canManage ? "Connect a provider, then hire your first AI employee." : "This public office has no active employees."}</p>{canManage && <button className="pixel-button hire" onClick={() => setHireOpen(true)}>HIRE EMPLOYEE</button>}</div>}
          </div>
          <div className="archive-corner"><span className="archive-label">ARCHIVE</span><div className="archive-box"><i/><i/><i/></div><strong>{counts.done ?? 0}</strong><small>DONE</small></div>
        </div>
      </div>

      <aside className="game-sidebar">
        <section className="hud-card stats-card"><header><span>TODAY AT HQ</span><span className="pixel-sun">☀</span></header><div className="stat-grid"><GameStat value={agents.filter((agent) => agent.state === "active").length} label="ONLINE" tone="mint"/><GameStat value={counts.open ?? 0} label="WAITING" tone="gold"/><GameStat value={counts.review ?? 0} label="REVIEW" tone="coral"/><GameStat value={counts.done ?? 0} label="DONE" tone="blue"/></div></section>
        <section className="hud-card activity-card"><header><span>OFFICE LOG</span><span className="live-pip">● LIVE</span></header><div className="game-activity-list">{events.length ? [...events].reverse().slice(0, 9).map((item) => <a className="game-activity" key={item.message.seq} href={`https://technocore.chat/humans#r/${eventRoom}/${item.message.seq}`} target="_blank" rel="noreferrer"><time>{time(item.message.ts)}</time><div><p><strong>{item.event.label ?? (item.signed ? shortDid(item.message.from) : "Boss")}</strong> {eventLabels[item.event.type]} {item.event.task_id ? <b>{displayId(item.event.task_id)}</b> : ""}</p><span>{item.signed ? "✓ SIGNED EVENT" : "DASHBOARD EVENT"}</span></div></a>) : <div className="log-empty"><Activity size={22}/><span>No office activity yet.</span></div>}</div></section>
      </aside>
    </section>

    <section className="mission-dock">
      <header className="mission-head"><div><span className="tiny-label">PAPER TRAIL</span><h2>Task Files</h2></div><p>Open a paper file to inspect its prompt, signatures, and result proofs.</p></header>
      <div className="mission-lanes">{(["open", "running", "review", "done"] as const).map((status) => { const laneTasks = tasks.filter((task) => status === "done" ? task.status === "done" || task.status === "failed" : task.status === status); return <article className={`mission-lane lane-${status}`} key={status}><header><span>{statusLabels[status]}</span><b>{String(laneTasks.length).padStart(2, "0")}</b></header><div>{laneTasks.length ? laneTasks.map((task) => <TaskFile key={task.id} task={task} workspace={workspace}/>) : <p>{loading ? "Reading notes…" : "No files on this shelf."}</p>}</div></article>; })}</div>
    </section>

    {dialog && canManage && (
      <CreateTaskDialog workspace={workspace} workflows={workflows} onClose={() => setDialog(false)} onCreated={async () => { setDialog(false); await refresh(); }}/>
    )}
    {setupOpen && (
      <OfficeSetupDialog workspace={workspace} providers={providers} agents={officeAgents} workflows={workflows} onClose={() => setSetupOpen(false)} onChanged={refresh}/>
    )}
    {hireOpen && (
      <HireEmployeeDialog workspace={workspace} providers={providers} onNeedProvider={() => { setHireOpen(false); setSetupOpen(true); }} onClose={() => setHireOpen(false)} onCreated={async () => { setHireOpen(false); await refresh(); }}/>
    )}
    {editingAgent && (
      <EmployeeSettingsDialog workspace={workspace} agent={editingAgent} providers={providers} onClose={() => setEditingAgent(undefined)} onSaved={async () => { setEditingAgent(undefined); await refresh(); }}/>
    )}
  </main>;
}

function FirstDayChecklist({ providers, employees, workflows, tasks, onSetup, onHire, onWorkflow, onTask }: { providers: number; employees: number; workflows: number; tasks: number; onSetup: () => void; onHire: () => void; onWorkflow: () => void; onTask: () => void }) {
  const steps = [
    { label: "CONNECT AI", detail: "Add and test a provider", done: providers > 0, action: onSetup },
    { label: "HIRE", detail: "Give an AI employee a desk", done: employees > 0, action: onHire },
    { label: "BUILD ROUTE", detail: "Choose how the paper travels", done: workflows > 0, action: onWorkflow },
    { label: "SEND TASK", detail: "Write your first boss brief", done: tasks > 0, action: onTask }
  ];
  const complete = steps.filter((step) => step.done).length;
  const current = steps.findIndex((step) => !step.done);
  return <section className="first-day-card" aria-label="First day office setup checklist">
    <header><div><span className="tiny-label">BOSS HANDBOOK</span><strong>YOUR FIRST DAY AT HQ</strong></div><div className="first-day-score"><b>{complete}</b><span>/ 4 READY</span></div></header>
    <div className="first-day-steps">{steps.map((step, index) => <button type="button" className={`${step.done ? "is-done" : ""} ${index === current ? "is-current" : ""}`} onClick={step.action} key={step.label}><b>{step.done ? <Check size={13}/> : index + 1}</b><span><strong>{step.label}</strong><small>{step.detail}</small></span>{index === current && <em>DO THIS NEXT</em>}</button>)}</div>
  </section>;
}

const demoEmployees = [
  { name: "Maya", role: "planner", provider: "gemini", mood: "working", bubble: "PLANNING IT!", variant: 1 },
  { name: "Arthur", role: "researcher", provider: "deepseek", mood: "working", bubble: "TIK TIK TIK…", variant: 4 },
  { name: "Ada", role: "reviewer", provider: "claude", mood: "reviewing", bubble: "CHECKING IT!", variant: 2 }
] as const;

export function PublicDemoBoard() {
  const [workerAtlas, setWorkerAtlas] = useState<{ url: string; cutout: boolean }>();
  useEffect(() => { let active = true; void buildTransparentWorkerAtlas().then((url) => { if (active) setWorkerAtlas({ url, cutout: true }); }).catch(() => { if (active) setWorkerAtlas({ url: "/game/office-workers.png", cutout: false }); }); return () => { active = false; }; }, []);
  return <main className={`game-shell ${workerAtlas ? "atlas-ready" : ""} ${workerAtlas && !workerAtlas.cutout ? "atlas-fallback" : ""}`} style={{ "--worker-atlas": workerAtlas ? `url(${workerAtlas.url})` : "none" } as CSSProperties}>
    <header className="game-topbar">
      <Link href="/" className="game-brand"><span className="game-logo" aria-hidden="true"><i/><i/><i/><i/></span><div><span className="game-kicker">PUBLIC TOUR · NO ACCOUNT NEEDED</span><h1>TechnoQueue HQ</h1></div></Link>
      <div className="game-workspace"><span>WORKSPACE</span><strong>DEMO</strong></div>
      <div className="game-top-actions"><div className="server-chip"><span/>GUIDED DEMO</div><Link className="pixel-button" href="/guide">HANDBOOK</Link><Link className="pixel-button primary" href="/signup"><Plus size={15}/> OPEN YOUR OFFICE</Link></div>
    </header>

    <div className="game-alert demo-tour-alert"><Bot size={18}/><strong>TOUR MODE</strong><span>This is a safe sample office. No provider is called and no record is written to Technocore.</span><small>EXPLORE THE WORKFLOW</small></div>

    <section className="game-dashboard">
      <div className="office-card">
        <div className="office-card-head"><div><span className="tiny-label">SAMPLE OFFICE</span><strong>3 EMPLOYEES · 1 ACTIVE TASK</strong></div><div className="floor-switcher"><button disabled aria-label="Previous floor">‹</button><span>FLOOR 1 / 1</span><button disabled aria-label="Next floor">›</button></div><div className="office-legend"><span><i className="legend-dot working"/> Working</span><span><i className="legend-dot review"/> Reviewing</span><span><i className="legend-dot idle"/> Available</span></div></div>
        <div className="office-room" aria-label="Public pixel art office demonstration">
          <div className="sun-stripe"/><div className="boss-station"><div className="speech-bubble boss-bubble"><b>THE BOSS</b><span>Research Arthur Hayes and prepare a concise brief.</span></div><Link className="boss-inbox" href="/signup" aria-label="Create your own office"><i style={{ "--paper-y": "-14px", "--paper-x": "22px", "--paper-rotate": "-3deg" } as CSSProperties}/><span>1</span><small>INBOX</small></Link></div><div className="paper-route route-one" aria-hidden="true"/><div className="paper-route route-two" aria-hidden="true"/>
          <div className="employee-floor employee-count-3">{demoEmployees.map((employee, index) => <DemoEmployeeDesk employee={employee} index={index} key={employee.name}/>)}</div>
          <div className="archive-corner"><span className="archive-label">ARCHIVE</span><div className="archive-box"><i/><i/><i/></div><strong>12</strong><small>DONE</small></div>
        </div>
      </div>

      <aside className="game-sidebar">
        <section className="hud-card stats-card"><header><span>TODAY AT HQ</span><span className="pixel-sun">☀</span></header><div className="stat-grid"><GameStat value={3} label="ONLINE" tone="mint"/><GameStat value={0} label="WAITING" tone="gold"/><GameStat value={1} label="REVIEW" tone="coral"/><GameStat value={12} label="DONE" tone="blue"/></div></section>
        <section className="hud-card activity-card"><header><span>OFFICE LOG</span><span className="live-pip">● SAMPLE</span></header><div className="game-activity-list">{[
          ["09:42", "Ada", "started reviewing", "TQ-DEMO"], ["09:41", "Arthur", "sent research to review", "TQ-DEMO"], ["09:39", "Arthur", "picked up the research file", "TQ-DEMO"], ["09:38", "Maya", "completed the plan", "TQ-DEMO"], ["09:37", "Boss", "created a new assignment", "TQ-DEMO"]
        ].map(([at, name, action, task]) => <div className="game-activity" key={`${at}-${name}`}><time>{at}</time><div><p><strong>{name}</strong> {action} <b>{task}</b></p><span>DEMO EVENT</span></div></div>)}</div></section>
      </aside>
    </section>

    <section className="mission-dock">
      <header className="mission-head"><div><span className="tiny-label">SAMPLE PAPER TRAIL</span><h2>Task Files</h2></div><p>See how one assignment moves across specialized desks before it reaches the archive.</p></header>
      <div className="mission-lanes"><DemoLane status="INBOX"/><DemoLane status="IN PROGRESS"/><DemoLane status="REVIEW" active/><DemoLane status="DONE"/></div>
    </section>
  </main>;
}

function DemoEmployeeDesk({ employee, index }: { employee: typeof demoEmployees[number]; index: number }) {
  return <div className={`employee-station mood-${employee.mood}`} style={{ "--employee-delay": `${index * 80}ms` } as CSSProperties}><div className="speech-bubble employee-bubble"><span>{employee.bubble}</span></div><div className="employee-nameplate"><strong>{employee.name}</strong><span>{employee.provider} · {employee.role}</span></div><PixelPerson variant={employee.variant}/><div className="pixel-desk"><div className="desk-monitor"><span/><i/></div><div className="desk-keyboard"><i/><i/><i/><i/></div><div className="desk-mug"/>{index === 2 && <span className="moving-paper paper-reviewing"><span>TQ-DEMO</span></span>}<div className="desk-drawers"><i/><i/></div></div></div>;
}

function DemoLane({ status, active = false }: { status: string; active?: boolean }) {
  const slug = status.toLowerCase().replaceAll(" ", "-");
  return <article className={`mission-lane lane-${slug}`}><header><span>{status}</span><b>{active ? "01" : "00"}</b></header><div>{active ? <div className="task-file demo-task-file"><div className="file-fold"/><div className="file-pin"/><span className="file-code">TQ-DEMO</span><strong>Who is Arthur Hayes?</strong><footer><span>RESEARCH</span><i className="file-integrity valid"/></footer></div> : <p>No files on this shelf.</p>}</div></article>;
}

function deriveAgents(events: ParsedEvent[], profiles: OfficeAgent[]): AgentView[] {
  const agents = new Map<string, AgentView>();
  for (const profile of profiles) agents.set(profile.did, { did: profile.did, label: profile.name, role: profile.role, lastSeen: profile.updated_at, state: profile.configured && !profile.paused ? "active" : "offline", profile });
  for (const item of events) {
    if (!item.signed) continue;
    // Historical CLI DIDs remain in the signed activity log, but only explicit
    // hosted employee profiles may materialize as desks in the office.
    if (!agents.has(item.message.from)) continue;
    const previous = agents.get(item.message.from); const online = item.event.type === "agent_online" ? item.event : null;
    const lastSeen = new Date(item.message.ts).toISOString(); const age = Date.now() - new Date(lastSeen).getTime();
    agents.set(item.message.from, { did: item.message.from, label: previous?.profile?.name ?? online?.label ?? previous?.label ?? "Agent", role: previous?.profile?.role ?? online?.role ?? previous?.role ?? "unknown", lastSeen, state: previous?.profile?.paused ? "offline" : age < 120_000 ? "active" : age < 900_000 ? "recent" : "offline", ...(previous?.profile ? { profile: previous.profile } : {}) });
  }
  return [...agents.values()].sort((a, b) => a.did.localeCompare(b.did));
}

function employeeState(agent: AgentView, tasks: TaskView[]): { mood: EmployeeMood; task?: TaskView; bubble: string } {
  const review = tasks.find((task) => task.status === "review" && task.reviewer_did === agent.did);
  if (review) return { mood: "reviewing", task: review, bubble: "CHECKING IT!" };
  const running = tasks.find((task) => task.status === "running" && task.worker_did === agent.did);
  if (running) return { mood: "working", task: running, bubble: "TIK TIK TIK…" };
  const handoff = tasks.find((task) => {
    const step = task.office?.steps[task.office.current_step];
    return step?.agent_did === agent.did && ((step.kind === "work" && task.status === "open") || (step.kind === "review" && task.status === "review"));
  });
  if (handoff) return { mood: handoff.status === "review" ? "reviewing" : "idle", task: handoff, bubble: handoff.review_feedback ? "BACK TO WORK!" : "NEW FILE!" };
  const completed = tasks.filter((task) => task.status === "done" && (task.worker_did === agent.did || task.reviewer_did === agent.did)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (completed && Date.now() - new Date(completed.updated_at).getTime() < 180_000) return { mood: "done", task: completed, bubble: "DONE!" };
  if (agent.state === "offline") return { mood: "offline", bubble: "ON A BREAK…" };
  return { mood: "idle", bubble: "READY!" };
}

function BossDesk({ tasks, onCreate }: { tasks: TaskView[]; onCreate: () => void }) {
  return <div className="boss-station"><div className="speech-bubble boss-bubble"><b>THE BOSS</b><span>{tasks.length ? `${tasks.length} files are waiting for an employee.` : "What should we build next?"}</span></div><button className="boss-inbox" onClick={onCreate} aria-label="Create a new task">{tasks.slice(0, 3).map((task, index) => <i key={task.id} style={{ "--paper-y": `${-14 - index * 3}px`, "--paper-x": `${20 + index * 3}px`, "--paper-rotate": `${(index - 1) * 5}deg` } as CSSProperties}/>) }<span>{tasks.length ? tasks.length : "+"}</span><small>INBOX</small></button></div>;
}

function EmployeeDesk({ agent, index, tasks, workspace, onEdit }: { agent: AgentView; index: number; tasks: TaskView[]; workspace: string; onEdit: () => void }) {
  const state = employeeState(agent, tasks);
  return <div className={`employee-station mood-${state.mood} ${agent.profile ? "is-configurable" : ""}`} style={{ "--employee-delay": `${index * 80}ms` } as CSSProperties} onClick={onEdit} title={agent.profile ? `Configure ${agent.label}` : agent.label}><div className="speech-bubble employee-bubble"><span>{agent.profile?.lastError ? "UH-OH!" : state.bubble}</span></div><div className="employee-nameplate"><strong>{agent.label}</strong><span>{agent.profile ? `${agent.profile.provider} · ${agent.role}` : agent.role}</span></div><PixelPerson variant={spriteVariant(agent.did)}/><div className="pixel-desk"><div className="desk-monitor"><span/><i/></div><div className="desk-keyboard"><i/><i/><i/><i/></div><div className="desk-mug"/>{state.task && state.mood !== "done" && <Link onClick={(event) => event.stopPropagation()} className={`moving-paper paper-${state.mood}`} href={`/task/${workspace}/${state.task.id}`} title={state.task.title}><span>{displayId(state.task.id)}</span></Link>}<div className="desk-drawers"><i/><i/></div></div></div>;
}

function PixelPerson({ variant }: { variant: number }) {
  const sprite = variant % 8;
  const column = sprite % 4;
  const row = Math.floor(sprite / 4);
  return <div className="pixel-person" style={{ "--sprite-x": `${column * (100 / 3)}%`, "--sprite-y": `${row * 100}%` } as CSSProperties} aria-hidden="true"><i className="typing-pixel left"/><i className="typing-pixel right"/></div>;
}

function spriteVariant(did: string) {
  let hash = 0;
  for (let index = 0; index < did.length; index += 1) hash = ((hash << 5) - hash + did.charCodeAt(index)) | 0;
  return Math.abs(hash) % 8;
}

function GameStat({ value, label, tone }: { value: number; label: string; tone: string }) { return <div className={`game-stat stat-${tone}`}><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div>; }

function TaskFile({ task, workspace }: { task: TaskView; workspace: string }) {
  return <Link className="task-file" href={`/task/${workspace}/${task.id}`}><div className="file-fold"/><div className="file-pin"/><span className="file-code">{displayId(task.id)}</span><strong>{task.title}</strong><footer><span>{task.role}</span><i className={`file-integrity ${task.integrity.prompt}`}/></footer></Link>;
}

const providerDefaults: Record<ProviderKind, string> = { openai: "gpt-5", anthropic: "claude-sonnet-5", deepseek: "deepseek-v4-flash", gemini: "gemini-3.7-flash" };

function ModalFrame({ kicker, title, onClose, wide = false, children }: { kicker: string; title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="modal-backdrop game-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal game-modal ${wide ? "office-setup-modal" : ""}`} role="dialog" aria-modal="true"><header className="modal-head"><div><div className="tiny-label">{kicker}</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>{children}</div></div>;
}

function OfficeSetupDialog({ workspace, providers, agents, workflows, onClose, onChanged }: { workspace: string; providers: ProviderConnection[]; agents: OfficeAgent[]; workflows: Workflow[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [workSteps, setWorkSteps] = useState<string[]>([agents.find((agent) => agent.role !== "reviewer")?.id ?? ""]);
  const workAgents = agents.filter((agent) => agent.role !== "reviewer");
  const reviewers = agents.filter((agent) => agent.role === "reviewer");

  async function connect(form: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/session/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: form.get("provider"), label: form.get("label"), apiKey: form.get("apiKey") }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Connection failed"); await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection failed"); } finally { setBusy(false); }
  }
  async function removeProvider(id: string) {
    setError("");
    const response = await fetch("/api/session/providers", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const body = await response.json() as { error?: string }; if (!response.ok) { setError(body.error ?? "Unable to remove connection"); return; } await onChanged();
  }
  async function testProvider(provider: ProviderConnection) {
    setBusy(true); setError(""); setTestStatus(`Testing ${provider.label}…`);
    try {
      const response = await fetch("/api/session/providers/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: provider.id, model: providerDefaults[provider.provider] }) });
      const body = await response.json() as { error?: string; latencyMs?: number };
      if (!response.ok) throw new Error(body.error ?? "Provider test failed");
      setTestStatus(`✓ ${provider.label} is ready · ${body.latencyMs ?? 0}ms`);
    } catch (reason) { setTestStatus(""); setError(reason instanceof Error ? reason.message : "Provider test failed"); } finally { setBusy(false); }
  }
  async function createWorkflow(form: FormData) {
    setBusy(true); setError("");
    try {
      const steps = workSteps.filter(Boolean).map((id, index) => { const agent = agents.find((value) => value.id === id)!; return { agent_id: id, label: `${index + 1}. ${agent.name} — ${agent.role}`, kind: "work" }; });
      const reviewer = String(form.get("reviewer") ?? "");
      if (reviewer) { const agent = agents.find((value) => value.id === reviewer)!; steps.push({ agent_id: reviewer, label: `${steps.length + 1}. ${agent.name} — review`, kind: "review" }); }
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/workflows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), steps }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Workflow creation failed"); await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Workflow creation failed"); } finally { setBusy(false); }
  }

  return <ModalFrame kicker="MANAGEMENT CONSOLE" title="Office setup" onClose={onClose} wide><div className="setup-grid">
    <section className="setup-section"><header><KeyRound size={17}/><div><strong>AI PROVIDERS</strong><span>Encrypted at rest · never sent to Technocore</span></div></header><div className="provider-list">{providers.map((provider) => <div className={`provider-card provider-${provider.provider}`} key={provider.id}><i/><div><strong>{provider.label}</strong><span>{provider.provider} · {provider.maskedKey}</span></div><button type="button" onClick={() => void testProvider(provider)} disabled={busy} aria-label={`Test ${provider.label}`}>TEST</button><button type="button" onClick={() => void removeProvider(provider.id)} aria-label={`Remove ${provider.label}`}><Trash2 size={14}/></button></div>)}{!providers.length && <p className="setup-empty">No provider connected yet.</p>}</div>{testStatus && <div className="provider-test-ok">{testStatus}</div>}<form className="compact-form" action={connect}><div className="field-row"><div className="field"><label>Provider</label><select name="provider" defaultValue="deepseek"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="anthropic">Claude / Anthropic</option><option value="gemini">Google Gemini</option></select></div><div className="field"><label>Connection name</label><input name="label" required defaultValue="My AI account" maxLength={40}/></div></div><div className="field"><label>API key</label><input name="apiKey" type="password" autoComplete="off" required placeholder="Encrypted before it is stored"/></div><button className="pixel-button mint" disabled={busy}><KeyRound size={13}/> CONNECT PROVIDER</button></form></section>
    <section className="setup-section"><header><Bot size={17}/><div><strong>WORKFLOWS</strong><span>Choose which desk receives the paper next</span></div></header><div className="workflow-list">{workflows.map((workflow) => <div className="workflow-card" key={workflow.id}><strong>{workflow.name}</strong><div>{workflow.steps.map((step, index) => <span key={`${step.agent_id}-${index}`}>{step.label}{index < workflow.steps.length - 1 && <b>→</b>}</span>)}</div></div>)}{!workflows.length && <p className="setup-empty">Hire employees, then create your first route.</p>}</div>{workAgents.length > 0 && <form className="compact-form" action={createWorkflow}><div className="field"><label>Workflow name</label><input name="name" required placeholder="Plan → Build → Review" maxLength={60}/></div><div className="workflow-builder">{workSteps.map((selected, index) => <div className="workflow-step-row" key={index}><b>{index + 1}</b><select value={selected} onChange={(event) => setWorkSteps((current) => current.map((value, item) => item === index ? event.target.value : value))} required><option value="">Choose employee…</option>{workAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.provider} · {agent.role}</option>)}</select>{workSteps.length > 1 && <button type="button" onClick={() => setWorkSteps((current) => current.filter((_, item) => item !== index))}><X size={14}/></button>}</div>)}{workSteps.length < 4 && <button type="button" className="add-step" onClick={() => setWorkSteps((current) => [...current, workAgents[0]?.id ?? ""])}><Plus size={13}/> ADD WORK STEP</button>}<div className="workflow-step-row review-row"><b>✓</b><select name="reviewer" defaultValue=""><option value="">No final review</option>{reviewers.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.provider}</option>)}</select></div></div><button className="pixel-button primary" disabled={busy}>SAVE WORKFLOW</button></form>}</section>
  </div>{error && <div className="form-error setup-error">⚠ {error}</div>}<footer className="session-note"><KeyRound size={14}/><span>API keys are encrypted with the server master key and never enter Technocore or browser storage.</span></footer></ModalFrame>;
}

function HireEmployeeDialog({ workspace, providers, onNeedProvider, onClose, onCreated }: { workspace: string; providers: ProviderConnection[]; onNeedProvider: () => void; onClose: () => void; onCreated: () => Promise<void> }) {
  const [connectionId, setConnectionId] = useState(providers[0]?.id ?? "");
  const connection = providers.find((provider) => provider.id === connectionId);
  const [model, setModel] = useState(connection ? providerDefaults[connection.provider] : "");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(form: FormData) {
    if (!connection) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/employees`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId, provider: connection.provider, name: form.get("name"), role: form.get("role"), model, instructions: form.get("instructions") }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Hiring failed"); await onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Hiring failed"); } finally { setBusy(false); }
  }
  return <ModalFrame kicker="HUMAN RESOURCES" title="Hire an AI employee" onClose={onClose}>{!providers.length ? <div className="empty-hire"><KeyRound size={34}/><strong>Connect an AI provider first</strong><p>Your employee needs an API account to think and work.</p><button className="pixel-button mint" onClick={onNeedProvider}>OPEN OFFICE SETUP</button></div> : <form className="form" action={submit}><div className="employee-preview"><PixelPerson variant={2}/><div><span>NEW EMPLOYEE</span><strong>{connection?.provider.toUpperCase()}</strong></div></div><div className="field-row"><div className="field"><label>Name</label><input name="name" required maxLength={40} placeholder="Ada"/></div><div className="field"><label>Job</label><select name="role" defaultValue="planner"><option value="general">Generalist</option><option value="planner">Planner</option><option value="researcher">Researcher</option><option value="writer">Writer</option><option value="coder">Developer</option><option value="analyst">Analyst</option><option value="reviewer">Reviewer</option></select></div></div><div className="field"><label>AI connection</label><select value={connectionId} onChange={(event) => { const id = event.target.value; setConnectionId(id); const next = providers.find((provider) => provider.id === id); if (next) setModel(providerDefaults[next.provider]); }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} · {provider.provider}</option>)}</select></div><div className="field"><label>Model</label><input value={model} onChange={(event) => setModel(event.target.value)} required maxLength={100}/></div><div className="field"><label>Standing instructions · public on Technocore</label><textarea name="instructions" maxLength={800} placeholder="How should this employee approach every assignment?"/></div>{error && <div className="form-error">⚠ {error}</div>}<div className="form-actions"><button type="button" className="pixel-button" onClick={onClose}>CANCEL</button><button className="pixel-button hire" disabled={busy}><UserPlus size={14}/> {busy ? "HIRING…" : "HIRE EMPLOYEE"}</button></div></form>}</ModalFrame>;
}

function EmployeeSettingsDialog({ workspace, agent, providers, onClose, onSaved }: { workspace: string; agent: OfficeAgent; providers: ProviderConnection[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const matching = providers.filter((provider) => provider.provider === agent.provider);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(form: FormData) {
    setBusy(true); setError("");
    try {
      const connectionId = String(form.get("connectionId") ?? "");
      const selected = providers.find((provider) => provider.id === connectionId);
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(agent.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), role: form.get("role"), model: form.get("model"), instructions: form.get("instructions"), paused: form.get("paused") === "on", ...(selected ? { connectionId, provider: selected.provider } : {}) }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Update failed"); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Update failed"); } finally { setBusy(false); }
  }
  async function fireEmployee() {
    const confirmed = window.confirm(`Fire ${agent.name}?\n\nThe employee will leave the office and workflows that use this employee will be hidden. The public Technocore record will be archived, not erased.`);
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Firing failed"); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Firing failed"); } finally { setBusy(false); }
  }
  async function backupIdentity() {
    const passphrase = window.prompt("Create a backup passphrase (at least 12 characters). TechnoQueue cannot recover it.");
    if (!passphrase) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(agent.id)}/identity/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase }) });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Backup failed"); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `technoqueue-${agent.id}.tqid`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Backup failed"); } finally { setBusy(false); }
  }
  async function retryNow() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(agent.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ retryNow: true }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Retry failed"); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retry failed"); } finally { setBusy(false); }
  }
  const currentConnection = agent.sessionOwned ? `Current · ${agent.connectionLabel ?? agent.provider}${agent.connectionMaskedKey ? ` · ${agent.connectionMaskedKey}` : ""}` : "Private key not hosted by this account";
  return <ModalFrame kicker="EMPLOYEE FILE" title={agent.name} onClose={onClose}><form className="form" action={submit}>
    <div className="employee-file-head"><PixelPerson variant={spriteVariant(agent.did)}/><div><span className={`employee-status ${agent.configured && !agent.paused ? "online" : "offline"}`}>{agent.configured && !agent.paused ? "● ONLINE" : "● OFFLINE"}</span><strong>{agent.provider.toUpperCase()} · {agent.model}</strong><code>{shortDid(agent.did)}</code></div></div>
    {agent.lastError && <div className="agent-error"><strong>LAST ERROR</strong><span>{agent.lastError}</span><button type="button" onClick={() => void retryNow()} disabled={busy}>RETRY NOW</button></div>}
    <div className="field-row"><div className="field"><label>Name</label><input name="name" defaultValue={agent.name} required maxLength={40}/></div><div className="field"><label>Job</label><select name="role" defaultValue={agent.role}><option value="general">Generalist</option><option value="planner">Planner</option><option value="researcher">Researcher</option><option value="writer">Writer</option><option value="coder">Developer</option><option value="analyst">Analyst</option><option value="reviewer">Reviewer</option></select></div></div>
    <div className="field"><label>Model</label><input name="model" defaultValue={agent.model} required maxLength={100}/></div>
    <div className="field"><label>Provider connection</label><select name="connectionId" defaultValue="" disabled={!agent.sessionOwned}><option value="">{currentConnection}</option>{matching.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} · {provider.maskedKey}</option>)}</select></div>
    <div className="field"><label>Standing instructions · public on Technocore</label><textarea name="instructions" defaultValue={agent.instructions} maxLength={800}/></div>
    <label className="toggle"><input type="checkbox" name="paused" defaultChecked={agent.paused}/> Send this employee on a break</label>
    {!agent.sessionOwned && <div className="form-error">This is a public historical employee. Its private key is not owned by your account.</div>}{error && <div className="form-error">⚠ {error}</div>}
    <div className="form-actions"><button type="button" className="pixel-button danger" onClick={() => void fireEmployee()} disabled={busy}><UserMinus size={14}/> FIRE EMPLOYEE</button><button type="button" className="pixel-button" onClick={() => void backupIdentity()} disabled={busy || !agent.sessionOwned}><KeyRound size={14}/> BACK UP DID</button><button type="button" className="pixel-button" onClick={onClose}>CLOSE</button><button className="pixel-button primary" disabled={busy || !agent.sessionOwned}>{busy ? "SAVING…" : "SAVE EMPLOYEE"}</button></div>
  </form></ModalFrame>;
}

function CreateTaskDialog({ workspace, workflows, onClose, onCreated }: { workspace: string; workflows: Workflow[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  async function submit(form: FormData) {
    setSubmitting(true); setError("");
    try {
      const workflowId = String(form.get("workflow_id") ?? "");
      const payload = workflowId ? { title: form.get("title"), prompt: form.get("prompt"), workflow_id: workflowId } : { title: form.get("title"), prompt: form.get("prompt"), role: "general", requires_review: false, max_attempts: 3 };
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Task creation failed"); await onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Task creation failed"); } finally { setSubmitting(false); }
  }
  return <ModalFrame kicker="BOSS DESK" title="New task brief" onClose={onClose}><form className="form" action={submit}><div className="field"><label htmlFor="title">File title · 120 max</label><input id="title" name="title" maxLength={120} required placeholder="Build a launch plan"/></div><div className="field"><label htmlFor="prompt">Assignment · 2,500 max</label><textarea id="prompt" name="prompt" maxLength={2500} required placeholder="Tell the office exactly what outcome you need…"/></div>{workflows.length ? <div className="field"><label htmlFor="workflow_id">Paper route</label><select id="workflow_id" name="workflow_id" defaultValue={workflows[0]?.id}>{workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name} · {workflow.steps.length} desks</option>)}</select><div className="selected-route">{workflows[0]?.steps.map((step, index) => <span key={`${step.agent_id}-${index}`}>{step.label}{index < workflows[0]!.steps.length - 1 && <b>→</b>}</span>)}</div></div> : <div className="form-error"><strong>No workflow exists yet.</strong> Create a paper route in Office Setup before sending the task.</div>}{error && <div className="form-error">⚠ {error}</div>}<div className="form-actions"><button type="button" className="pixel-button" onClick={onClose}>CANCEL</button><button className="pixel-button primary" disabled={submitting || !workflows.length}>{submitting ? <><RefreshCw size={13}/> WRITING…</> : "SEND THE PAPER"}</button></div></form></ModalFrame>;
}
