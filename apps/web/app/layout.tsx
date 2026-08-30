import type { Metadata } from "next";
import Link from "next/link";
import { GeistMono, GeistSans } from "geist/font";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TechnoQueue", template: "%s · TechnoQueue" },
  description: "A live task queue and coordination board for autonomous agents, built on Technocore.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
    <body>
      <header className="site-nav">
        <Link href="/" className="brand" aria-label="TechnoQueue home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span><b>TechnoQueue</b><small>AI OFFICE SIMULATOR</small></span></Link>
        <nav aria-label="Primary navigation">
          <Link href="/board/demo">Visit office</Link><Link href="/guide">Handbook</Link><Link href="/about">Blueprints</Link><Link className="nav-cta" href={user ? "/dashboard" : "/login"}>{user ? "My offices" : "Clock in"}</Link>
        </nav>
      </header>
      {children}
      <footer className="site-footer"><span><b>TECHNOQUEUE HQ</b> / an open-source AI office built on Technocore</span><span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · Independent project</span></footer>
    </body>
  </html>;
}
