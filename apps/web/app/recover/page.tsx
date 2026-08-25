import { RecoveryForm } from "@/components/recovery-form";

export const metadata = { title: "Recover account" };
export default function RecoverPage() {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-art"><span>CRYPTOGRAPHIC RECOVERY</span><h1>Your key.<br/>Your office.</h1><p>Your encrypted account DID backup proves possession without email, OAuth or a third-party identity provider.</p><div className="pixel-building"><i/><i/><i/><i/><i/><i/></div></div><div className="auth-panel"><span className="eyebrow">IDENTITY VAULT</span><h2>Recover account</h2><RecoveryForm/></div></section></main>;
}
