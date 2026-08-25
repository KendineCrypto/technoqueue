"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecoveryForm() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(form: FormData) {
    setBusy(true); setError("");
    try {
      const file = form.get("identityBackup"); if (!(file instanceof File) || !file.size) throw new Error("Choose your account .tqid file");
      const response = await fetch("/api/auth/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identityBackup: await file.text(), backupPassphrase: form.get("backupPassphrase"), password: form.get("password"), confirmPassword: form.get("confirmPassword") }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Recovery failed"); router.push("/dashboard"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Recovery failed"); } finally { setBusy(false); }
  }
  return <form className="auth-form" action={submit}><div className="field"><label>Account .tqid backup</label><input name="identityBackup" type="file" accept=".tqid,application/json" required/></div><div className="field"><label>Backup passphrase</label><input name="backupPassphrase" type="password" minLength={12} maxLength={200} required/></div><div className="field"><label>New account password</label><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/></div><div className="field"><label>Confirm new password</label><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required/></div>{error && <div className="form-error">⚠ {error}</div>}<button className="button primary" disabled={busy}>{busy ? "VERIFYING DID…" : "RECOVER ACCOUNT"}</button><p><Link href="/login">Back to sign in</Link></p></form>;
}
