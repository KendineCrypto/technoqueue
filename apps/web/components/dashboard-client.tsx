"use client";

import { Plus, LogOut, ArrowRight, KeyRound, Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Workspace = { id: string; slug: string; name: string; created_at: string };

export function DashboardClient({ username, did, initialWorkspaces }: { username: string; did: string; initialWorkspaces: Workspace[] }) {
  const router = useRouter(); const [workspaces, setWorkspaces] = useState(initialWorkspaces); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function createWorkspace(form: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) });
      const body = await response.json() as { error?: string; workspace?: Workspace };
      if (!response.ok || !body.workspace) throw new Error(body.error ?? "Workspace creation failed");
      setWorkspaces((current) => [body.workspace!, ...current]); router.push(`/board/${body.workspace.slug}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Workspace creation failed"); } finally { setBusy(false); }
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/"); router.refresh(); }
  async function downloadIdentity(form: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/identity/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: form.get("backupPassphrase") }) });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Backup failed"); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `technoqueue-${username}-account.tqid`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Backup failed"); } finally { setBusy(false); }
  }
  async function deleteAccount(form: FormData) {
    if (!window.confirm("Delete your local TechnoQueue account, encrypted keys and offices? Public Technocore history cannot be erased.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("deleteUsername"), password: form.get("deletePassword") }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Account deletion failed"); router.push("/"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Account deletion failed"); } finally { setBusy(false); }
  }
  return <main className="dashboard-shell">
    <header className="dashboard-hero"><div><span className="eyebrow">BOSS CONSOLE</span><h1>Welcome back,<br/>{username}.</h1><p>Your account DID identifies the human owner. Every employee gets a separate DID for signed Technocore actions.</p><code>{did}</code></div><button className="button" onClick={() => void logout()}><LogOut size={14}/> Sign out</button></header>
    <section className="dashboard-grid">
      <article className="create-office-card"><span>NEW FLOOR</span><h2>Open an AI office</h2><p>Create a private management space, connect your own providers, then hire employees.</p><form action={createWorkspace}><div className="field"><label>Office name</label><input name="name" required minLength={2} maxLength={60} placeholder="Launch Studio"/></div>{error && <div className="form-error">⚠ {error}</div>}<button className="button primary" disabled={busy}><Plus size={14}/>{busy ? "OPENING…" : "CREATE OFFICE"}</button></form></article>
      <div className="workspace-list"><header><span>YOUR OFFICES</span><b>{workspaces.length}</b></header>{workspaces.length ? workspaces.map((workspace) => <Link href={`/board/${workspace.slug}`} className="workspace-row" key={workspace.id}><div><strong>{workspace.name}</strong><code>{workspace.slug}</code></div><ArrowRight size={18}/></Link>) : <div className="dashboard-empty"><span>FIRST DAY</span><strong>Your office starts here.</strong><p>Name the company on the left. Inside, the Boss Handbook will guide you through connecting an AI, hiring employees, building a paper route, and sending the first task.</p><div><i>1</i><b>CREATE</b><i>2</i><b>CONNECT</b><i>3</i><b>HIRE</b><i>4</i><b>BUILD</b></div></div>}</div>
    </section>
    <section className="identity-vault"><div><KeyRound size={22}/><span>IDENTITY VAULT</span><h2>Back up your account DID</h2><p>This password-encrypted file is the portable private key for <code>{did}</code>. Store it offline. TechnoQueue cannot recover its passphrase.</p></div><form action={downloadIdentity}><div className="field"><label>Backup passphrase · 12+ characters</label><input name="backupPassphrase" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/></div><button className="button" disabled={busy}><Download size={14}/> DOWNLOAD .TQID</button></form></section>
    <details className="danger-zone"><summary>Delete local account</summary><p>This permanently removes the local account, encrypted provider keys and hosted employee keys. Public Technocore records remain.</p><form action={deleteAccount}><div className="field"><label>Type {username}</label><input name="deleteUsername" required/></div><div className="field"><label>Current password</label><input name="deletePassword" type="password" autoComplete="current-password" required/></div><button className="button" disabled={busy}>DELETE ACCOUNT</button></form></details>
  </main>;
}
