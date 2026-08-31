import { workspaceSchema } from "@technoqueue/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LiveBoard, PublicDemoBoard } from "@/components/live-board";
import { currentUser, ownedWorkspace } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ workspace: string }> }): Promise<Metadata> {
  const { workspace } = await params; return { title: workspace === "demo" ? "Public office tour" : `${workspace} board` };
}
export default async function BoardPage({ params }: { params: Promise<{ workspace: string }> }) {
  const parsed = workspaceSchema.safeParse((await params).workspace); if (!parsed.success) notFound();
  if (parsed.data === "demo") return <PublicDemoBoard/>;
  const user = await currentUser(); if (!user) redirect("/login");
  try { await ownedWorkspace(parsed.data, user.id); } catch { notFound(); }
  return <LiveBoard workspace={parsed.data}/>;
}
