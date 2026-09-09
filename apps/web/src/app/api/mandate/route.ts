import { NextResponse } from "next/server";
import { toHex } from "@warden/shared";
import { rememberMandate, resetDemoSession } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";
import { withSession } from "@/lib/with-session";

export async function POST(request: Request) {
  const body = await request.json();

  return withSession(request, async (session) => {
    try {
      const handoff = await session.principal.createMandate({
        agentPublicKey: session.agent.publicKey,
        policy: {
          maxAmount: BigInt(body.maxAmount),
          asset: body.asset,
          actionType: body.actionType,
          destinationCategory: body.destinationCategory,
          expiry: BigInt(Math.floor(Date.now() / 1000) + Number(body.expiresInSeconds)),
          actionCountLimit: BigInt(body.actionCountLimit)
        }
      });
      session.agent.importMandate(handoff);
      rememberMandate(session, handoff);

      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ id: toHex(handoff.id), status });
    } catch (cause) {
      return NextResponse.json({ error: describeError(cause) }, { status: 400 });
    }
  });
}

/** Lists every mandate created in this visitor's demo session, most recent first. */
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const ids = [...session.handoffs.keys()].reverse();
    const mandates = await Promise.all(
      ids.map(async (id) => {
        const handoff = session.handoffs.get(id)!;
        return session.principal.status(handoff.id);
      })
    );
    return NextResponse.json({ mandates });
  });
}

/** Starts a brand-new demo session: fresh principal/agent identities, no mandates. */
export async function DELETE(request: Request) {
  return withSession(request, async (_session, sessionId) => {
    resetDemoSession(sessionId);
    return NextResponse.json({ reset: true });
  });
}
