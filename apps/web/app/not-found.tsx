import Link from "next/link";
export default function NotFound() { return <main className="not-found"><div><div className="eyebrow">404 / no record</div><h1>Task not found.</h1><p style={{ color: "var(--muted)" }}>The task may not exist, or its Technocore note may have expired.</p><Link href="/board/demo" className="button">Return to board</Link></div></main>; }
