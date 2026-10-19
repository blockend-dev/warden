import { NextResponse } from "next/server";
import { fromHex } from "@warden/shared";
import { findHandoff } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";
import { withSession } from "@/lib/with-session";

/** Body: `{ id, paused: boolean }`. Reversible, unlike revoke. Root mandates
 * only — a delegated mandate is frozen by pausing its parent. */
export async function POST(request: Request) {
  const body = await request.json();

  return withSession(request, async (session) => {
    const handoff = findHandoff(session, body.id);
    if (!handoff) {
      return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate with that id in this session." } }, { status: 400 });
    }
    if (handoff.parentId) {
      return NextResponse.json(
        { error: { kind: "DelegationError", message: "A delegated mandate is paused by pausing its parent; pause the root instead." } },
        { status: 400 }
      );
    }

    try {
      const id = fromHex(body.id);
      const evidence = body.paused ? await session.principal.pause(id) : await session.principal.resume(id);
      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ ok: true, status, evidence });
    } catch (cause) {
      return NextResponse.json({ ok: false, error: describeError(cause) }, { status: 400 });
    }
  });
}
