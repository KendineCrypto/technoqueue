"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="not-found"><div><div className="eyebrow">Technocore degraded</div><h1>Board unavailable.</h1><p style={{ color: "var(--muted)" }}>Live state could not be resolved. No local mock state has been substituted.</p><button className="button" onClick={reset}>Try again</button></div></main>; }
