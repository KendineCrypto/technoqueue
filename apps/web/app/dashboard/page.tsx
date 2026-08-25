import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/dashboard-client";
import { currentUser, listUserWorkspaces } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your offices" };
export default async function DashboardPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  return <DashboardClient username={user.username} did={user.account_did} initialWorkspaces={listUserWorkspaces(user.id)}/>;
}
