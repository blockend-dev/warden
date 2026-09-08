import { NextResponse } from "next/server";
import { toHex } from "@warden/shared";
import { getDemoSession, rememberMandate, resetDemoSession } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";

export async function POST(request: Request) {
  const body = await request.json();
  const session = getDemoSession();

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
}

/** Lists every mandate created in this browser's demo session, most recent first. */
export async function GET() {
  const session = getDemoSession();
  const ids = [...session.handoffs.keys()].reverse();
  const mandates = await Promise.all(
    ids.map(async (id) => {
      const handoff = session.handoffs.get(id)!;
      const status = await session.principal.status(handoff.id);
      return status;
    })
  );
  return NextResponse.json({ mandates });
}

/** Starts a brand-new demo session: fresh principal/agent identities, no mandates. */
export async function DELETE() {
  resetDemoSession();
  return NextResponse.json({ reset: true });
}
