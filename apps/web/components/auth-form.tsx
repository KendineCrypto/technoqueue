"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(form: FormData) {
    setBusy(true); setError("");
    try {
      const backupFile = signup ? form.get("identityBackup") : undefined;
      const identityBackup = backupFile instanceof File && backupFile.size ? await backupFile.text() : undefined;
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password"), ...(mode === "signup" ? { confirmPassword: form.get("confirmPassword"), ...(identityBackup ? { identityBackup, backupPassphrase: form.get("backupPassphrase") } : {}) } : {}) }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Request failed");
      router.push("/dashboard"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed"); } finally { setBusy(false); }
  }
  const signup = mode === "signup";
  return <form className="auth-form" action={submit}>
    <div className="field"><label>Username</label><input name="username" autoComplete="username" minLength={3} maxLength={32} required placeholder="pixelboss"/></div>
    <div className="field"><label>Password</label><input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={12} maxLength={200} required placeholder="At least 12 characters"/></div>
    {signup && <div className="field"><label>Confirm password</label><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/></div>}
    {signup && <details className="restore-identity"><summary>Restore an existing account DID</summary><div className="field"><label>.tqid backup file</label><input name="identityBackup" type="file" accept=".tqid,application/json"/></div><div className="field"><label>Backup passphrase</label><input name="backupPassphrase" type="password" autoComplete="off" minLength={12} maxLength={200}/></div><small>Leave empty to create a brand-new self-issued DID.</small></details>}
    {error && <div className="form-error">⚠ {error}</div>}
    <button className="button primary auth-submit" disabled={busy}>{busy ? "PLEASE WAIT…" : signup ? "CREATE MY OFFICE" : "SIGN IN"}</button>
    <p>{signup ? <>Already have an account? <Link href="/login">Sign in</Link></> : <>New here? <Link href="/signup">Create an account</Link> · <Link href="/recover">Recover with DID</Link></>}</p>
  </form>;
}
