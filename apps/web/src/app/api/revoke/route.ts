import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";

export async function POST() {
  const session = getDemoSession();
  if (!session.handoff) {
    return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate has been created yet." } }, { status: 400 });
  }

  try {
    await session.principal.revoke(session.handoff.id);
    const status = await session.principal.status(session.handoff.id);
    return NextResponse.json({ revoked: true, status });
  } catch (cause) {
    return NextResponse.json({ revoked: false, error: describeError(cause) }, { status: 400 });
  }
}
