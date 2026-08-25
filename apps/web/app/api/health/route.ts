import { TechnocoreClient } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { assertVaultReady } from "@/lib/secure-vault";
export const dynamic = "force-dynamic";
export async function GET() {
  const connected = await new TechnocoreClient().health();
  let database = false; try { database = one<{ ok: number }>("SELECT 1 AS ok")?.ok === 1; } catch { database = false; }
  let vault = false; try { assertVaultReady(); vault = true; } catch { vault = false; }
  const healthy = connected && database && vault;
  return NextResponse.json({ status: healthy ? "connected" : "degraded", technocore: connected, database, vault }, { status: healthy ? 200 : 503 });
}
