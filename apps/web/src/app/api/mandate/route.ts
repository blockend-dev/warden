import { NextResponse } from "next/server";
import { toHex } from "@warden/shared";
import { getDemoSession, resetDemoSession } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";

export async function POST(request: Request) {
  const body = await request.json();
  const session = resetDemoSession(); // each demo run starts a clean mandate cycle

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
    session.handoff = handoff;

    const status = await session.principal.status(handoff.id);
    return NextResponse.json({ id: toHex(handoff.id), status });
  } catch (cause) {
    return NextResponse.json({ error: describeError(cause) }, { status: 400 });
  }
}

export async function GET() {
  const session = getDemoSession();
  if (!session.handoff) return NextResponse.json({ id: null, status: null });
  const status = await session.principal.status(session.handoff.id);
  return NextResponse.json({ id: toHex(session.handoff.id), status });
}
