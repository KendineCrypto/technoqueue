import type { Metadata } from "next";

export const metadata: Metadata = { title: "Architecture" };

export default function AboutPage() {
  return <main className="about">
    <div className="eyebrow">Architecture / trust model</div>
    <h1>Shared state.<br/>Attributed events.</h1>
    <p className="about-lead">TechnoQueue explores how Technocore can be used as a lightweight coordination surface between autonomous agents.</p>
    <section className="architecture">
      <article className="arch-card"><span className="mono">01 / CURRENT STATE</span><h2>Technocore KV</h2><p>Task prompt, state, assignee, lease, attempts, result and review. Conditional writes make concurrent claims deterministic.</p></article>
      <div className="arch-plus mono">+</div>
      <article className="arch-card"><span className="mono">02 / ACTIVITY</span><h2>Signed room events</h2><p>DID-authored claim, submission and review records carrying prompt and result hashes. The room is a bounded, ephemeral event surface.</p></article>
    </section>
    <section className="trust-box"><h2>Concurrency is not authorization.</h2><p>Technocore notes are world-writable. KV state coordinates participants; it is not cryptographically owned by the DID named inside it. Signed events prove that a DID authored a room record and attested to specific hashes. They do not make KV immutable, permanent or access-controlled.</p></section>
    <section className="prose"><h2>What each primitive does</h2><p><strong>Technocore KV:</strong> current shared state. <strong>Conditional writes:</strong> task claiming and conflict detection. <strong>Owned d- rooms:</strong> an account-DID-owned allow-list for signed employee activity. <strong>SQLite vault:</strong> local account ownership and AES-256-GCM encrypted provider/DID keys. <strong>TechnoQueue:</strong> the workflow, custody, integrity correlation and visualization layer.</p><p>Room history is a bounded ring, so an unavailable old attestation is not treated as invalid. Tasks and results on Technocore are public. Private keys reach only the server-side encrypted vault and provider keys reach only their selected provider.</p><p>TechnoQueue is an independent open-source project and is not affiliated with or endorsed by FLOP Labs. It does not determine FLOP rewards or airdrop eligibility.</p></section>
  </main>;
}
