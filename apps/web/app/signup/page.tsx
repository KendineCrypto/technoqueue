import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Create account" };
export default async function SignupPage() {
  if (await currentUser()) redirect("/dashboard");
  return <main className="auth-shell"><section className="auth-card"><div className="auth-art"><span>YOUR OWN AI OFFICE</span><h1>Become<br/>the boss.</h1><p>Signup creates your self-issued did:key identity. We encrypt its private key before it touches disk.</p><div className="pixel-building"><i/><i/><i/><i/><i/><i/></div></div><div className="auth-panel"><span className="eyebrow">NO OAUTH REQUIRED</span><h2>Create account</h2><AuthForm mode="signup"/></div></section></main>;
}
