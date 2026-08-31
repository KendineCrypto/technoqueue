"use client";

export default function TaskError({ reset }: { reset: () => void }) {
  return <main className="not-found"><div><div className="eyebrow">TASK FILE UNAVAILABLE</div><h1>The file cabinet is locked.</h1><p>The live Technocore task record could not be verified. TechnoQueue has not replaced it with sample or cached task content.</p><div className="actions" style={{ justifyContent: "center" }}><button className="button primary" onClick={reset}>TRY AGAIN</button><a className="button" href="/dashboard">MY OFFICES</a></div></div></main>;
}
