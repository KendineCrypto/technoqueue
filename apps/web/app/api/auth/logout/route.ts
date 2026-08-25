import { NextResponse } from "next/server";
import { assertSameOrigin, endSession } from "@/lib/auth";

export async function POST(request: Request) {
  assertSameOrigin(request);
  await endSession();
  return NextResponse.json({ ok: true });
}
