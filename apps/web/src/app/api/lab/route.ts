import { NextResponse } from "next/server";
import { runAttackSuite } from "@warden/sdk";

// Always runs on a private in-process simulator, in every deployment mode —
// never on the shared (or live) backend, so a visitor can attack freely.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const only = Array.isArray(body.only) ? (body.only as string[]) : undefined;
  const results = await runAttackSuite(only);
  return NextResponse.json({ results, backend: "in-process simulator (private to this request)" });
}
