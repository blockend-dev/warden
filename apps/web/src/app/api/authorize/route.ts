import { NextResponse } from "next/server";
import { fromHex } from "@warden/shared";
import { findHandoff } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";
import { withSession } from "@/lib/with-session";

export async function POST(request: Request) {
  const body = await request.json();

  return withSession(request, async (session) => {
    const handoff = findHandoff(session, body.id);
    if (!handoff) {
      return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate with that id in this session." } }, { status: 400 });
    }

    try {
      const evidence = await session.agent.authorize(fromHex(body.id), {
        amount: BigInt(body.amount),
        asset: body.asset,
        actionType: body.actionType,
        destinationCategory: body.destinationCategory
      });
      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ authorized: true, status, evidence });
    } catch (cause) {
      const error = describeError(cause);
      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ authorized: false, error, status }, { status: 200 });
    }
  });
}
