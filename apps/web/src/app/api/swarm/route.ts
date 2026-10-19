import { NextResponse } from "next/server";
import { runSwarm } from "@warden/sdk";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) : 7;
  const steps = Math.min(40, Math.max(8, Number(body.steps) || 24));
  const result = await runSwarm(seed, steps);
  return NextResponse.json(result);
}
