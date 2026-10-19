import { NextResponse } from "next/server";
import { fromHex, toHex } from "@warden/shared";
import { findHandoff, rememberMandate } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";
import { withSession } from "@/lib/with-session";

/** The root mandate's agent carves a bounded child out of its own authority
 * for this session's sub-agent. Body:
 * `{ parentId, maxAmount, actionCountLimit, expiresInSeconds? }`. */
export async function POST(request: Request) {
  const body = await request.json();

  return withSession(request, async (session) => {
    const parent = findHandoff(session, body.parentId);
    if (!parent) {
      return NextResponse.json({ error: { kind: "NoMandate", message: "No parent mandate with that id in this session." } }, { status: 400 });
    }

    try {
      const expiry =
        body.expiresInSeconds !== undefined && body.expiresInSeconds !== ""
          ? BigInt(Math.floor(Date.now() / 1000) + Number(body.expiresInSeconds))
          : parent.context.policy.expiry;
      const handoff = await session.agent.delegate({
        parentId: fromHex(body.parentId),
        subAgentPublicKey: session.sub.publicKey,
        maxAmount: BigInt(body.maxAmount),
        actionCountLimit: BigInt(body.actionCountLimit),
        expiry
      });
      session.sub.importMandate(handoff);
      rememberMandate(session, handoff);

      const status = await session.principal.status(handoff.id);
      const parentStatus = await session.principal.status(parent.id);
      return NextResponse.json({ id: toHex(handoff.id), status, parentStatus, evidence: handoff.evidence });
    } catch (cause) {
      return NextResponse.json({ error: describeError(cause) }, { status: 400 });
    }
  });
}
