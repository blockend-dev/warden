import { NextResponse } from "next/server";
import { fromHex } from "@warden/shared";
import { findHandoff, getDemoSession } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";

export async function POST(request: Request) {
  const session = getDemoSession();
  const body = await request.json();

  const handoff = findHandoff(session, body.id);
  if (!handoff) {
    return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate with that id in this session." } }, { status: 400 });
  }

  try {
    await session.principal.revoke(fromHex(body.id));
    const status = await session.principal.status(handoff.id);
    return NextResponse.json({ revoked: true, status });
  } catch (cause) {
    return NextResponse.json({ revoked: false, error: describeError(cause) }, { status: 400 });
  }
}
