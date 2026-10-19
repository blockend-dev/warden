import { NextResponse } from "next/server";
import { fromHex } from "@warden/shared";
import { findHandoff } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";
import { withSession } from "@/lib/with-session";

/** The agent proves "cumulative spend <= ceiling" and publishes only the
 * ceiling. Body: `{ id, ceiling }`. Root mandates only. */
export async function POST(request: Request) {
  const body = await request.json();

  return withSession(request, async (session) => {
    const handoff = findHandoff(session, body.id);
    if (!handoff) {
      return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate with that id in this session." } }, { status: 400 });
    }
    if (handoff.parentId) {
      return NextResponse.json(
        { error: { kind: "DelegationError", message: "Spend attestation is available on root mandates." } },
        { status: 400 }
      );
    }

    try {
      const evidence = await session.agent.attestSpend(fromHex(body.id), BigInt(body.ceiling));
      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ ok: true, status, evidence });
    } catch (cause) {
      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ ok: false, error: describeError(cause), status }, { status: 200 });
    }
  });
}
