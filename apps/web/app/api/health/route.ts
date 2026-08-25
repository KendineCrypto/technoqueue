import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { assertVaultReady } from "@/lib/secure-vault";
export const dynamic = "force-dynamic";
export async function GET() {
  let database = false; try { database = one<{ ok: number }>("SELECT 1 AS ok")?.ok === 1; } catch { database = false; }
  let vault = false; try { assertVaultReady(); vault = true; } catch { vault = false; }
  const healthy = database && vault;
  return NextResponse.json({ status: healthy ? "ready" : "degraded", database, vault }, { status: healthy ? 200 : 503 });
}
