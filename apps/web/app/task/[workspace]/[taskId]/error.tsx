"use client";

export default function TaskError({ reset }: { reset: () => void }) {
  return <main className="not-found"><div><div className="eyebrow">Task view degraded</div><h1>Unable to render this task.</h1><p style={{ color: "var(--muted)", maxWidth: 560, lineHeight: 1.6 }}>The live Technocore record could not be resolved. The application has not substituted mock state.</p><button className="button primary" onClick={reset}>Try again</button></div></main>;
}
