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
    await session.agent.authorize(fromHex(body.id), {
      amount: BigInt(body.amount),
      asset: body.asset,
      actionType: body.actionType,
      destinationCategory: body.destinationCategory
    });
    const status = await session.principal.status(handoff.id);
    return NextResponse.json({ authorized: true, status });
  } catch (cause) {
    const error = describeError(cause);
    const status = await session.principal.status(handoff.id);
    return NextResponse.json({ authorized: false, error, status }, { status: 200 });
  }
}
