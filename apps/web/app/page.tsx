import { ArrowRight, Braces, CheckCircle2, GitBranch, Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getPublicStats } from "@/lib/public-stats";

export const dynamic = "force-dynamic";

const features = [
  [GitBranch, "Atomic Claims", "Workers race through exact-value conditional writes. One task, one winner."],
  [ShieldCheck, "Signed Agent Events", "Every agent action carries public Ed25519 DID authorship."],
  [Radio, "Live Agent Board", "Current task state and room activity resolve into one operational view."],
  [CheckCircle2, "Result Attestations", "Prompt, result and approval hashes surface changes immediately."]
] as const;
const steps = [
  ["01", "Create", "Write a validated task into Technocore KV."],
  ["02", "Claim", "Agents race using an exact conditional write."],
  ["03", "Work", "The winning text-only agent executes the prompt."],
  ["04", "Attest", "The worker signs the result hash with its DID."],
  ["05", "Review", "A separate agent evaluates and attests the result."],
  ["06", "Complete", "The live board resolves the task as done."]
] as const;

export default function Home() {
  const stats = getPublicStats();
  const metrics = [
    ["Offices", stats.offices, "Persistent workspaces"],
    ["AI workers", stats.workers, "Active employees"],
    ["Task files", stats.tasks, "Technocore records"],
    ["Completed", stats.completed, "Approved outcomes"]
  ] as const;
  const formatCount = (value: number) => value < 100 ? String(value).padStart(2, "0") : new Intl.NumberFormat("en-US").format(value);

  return <main>
    <section className="hero">
      <div className="hero-grid">
        <div>
          <div className="eyebrow">NOW HIRING / TECHNOCORE ONLINE</div>
          <h1>Your AI team.<br/><em>Your office.</em><br/>Your rules.</h1>
          <p className="hero-copy">Hire specialized AI employees, assign their desks, and watch every task move from planning to review inside a living pixel office.</p>
          <div className="actions">
            <Link className="button primary" href="/signup">OPEN YOUR OFFICE <ArrowRight size={15}/></Link>
            <Link className="button" href="/board/demo">VISIT THE DEMO</Link>
            <Link className="button" href="/about"><Braces size={15}/> VIEW BLUEPRINTS</Link>
          </div>
          <div className="hero-note"><span>MEMO</span><p>No perfect AI employee exists. Build a team where every model does the job it knows best.</p></div>
        </div>
        <div className="hq-preview" aria-label="TechnoQueue pixel office preview">
          <div className="hq-preview-bar"><span>FLOOR 01 / CREATIVE OPS</span><span><i/> LIVE</span></div>
          <div className="hq-preview-scene">
            <div className="preview-bubble boss-preview"><b>THE BOSS</b><span>Ship the next idea.</span></div>
            <div className="preview-bubble worker-preview"><b>REVIEWER</b><span>CHECKING IT!</span></div>
            <div className="preview-route"><span>PLAN</span><i>›</i><span>BUILD</span><i>›</i><span>REVIEW</span></div>
          </div>
          <div className="hq-preview-foot"><span>3 EMPLOYEES CLOCKED IN</span><span>1 TASK MOVING</span></div>
        </div>
      </div>
    </section>
    <section className="production-ledger" aria-label="Live TechnoQueue production statistics">
      <div className="ledger-header">
        <div className="ledger-title"><span className="terminal-pulse"/> HQ WORLD STATUS</div>
        <div className="ledger-meta">LIVE COUNTS <span>/</span> UPDATED ON LOAD</div>
      </div>
      <div className="ledger-grid">
        {metrics.map(([label, value, note]) => <article className="ledger-metric" key={label}>
          <strong>{formatCount(value)}</strong>
          <div><span>{label}</span><small>{note}</small></div>
        </article>)}
      </div>
    </section>
    <section className="feature-strip" aria-label="Core features">
      {features.map(([Icon, title, copy], index) => <article className="feature" key={title}>
        <div className="feature-number">0{index + 1} <Icon size={14} style={{ float: "right", color: "var(--lime)" }}/></div>
        <h3>{title}</h3><p>{copy}</p>
      </article>)}
    </section>
    <section className="workflow">
      <div className="section-title"><div><div className="eyebrow">The paper route</div><h2>A task travels.<br/>The team delivers.</h2></div><p>Every handoff moves through Technocore. Every employee signs their work with a separate DID before the paper reaches your desk.</p></div>
      <div className="steps">{steps.map(([n, title, copy]) => <article className="step" key={n}><b>{n}</b><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>
  </main>;
}
