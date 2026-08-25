import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Sign in" };
export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  return <main className="auth-shell"><section className="auth-card"><div className="auth-art"><span>TECHNOQUEUE HQ</span><h1>Clock in,<br/>boss.</h1><p>Your offices, encrypted provider keys and DID identities are waiting.</p><div className="pixel-building"><i/><i/><i/><i/><i/><i/></div></div><div className="auth-panel"><span className="eyebrow">SECURE ACCESS</span><h2>Sign in</h2><AuthForm mode="login"/></div></section></main>;
}
