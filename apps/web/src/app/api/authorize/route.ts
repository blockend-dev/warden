import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";

export async function POST(request: Request) {
  const session = getDemoSession();
  if (!session.handoff) {
    return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate has been created yet." } }, { status: 400 });
  }

  const body = await request.json();
  try {
    await session.agent.authorize(session.handoff.id, {
      amount: BigInt(body.amount),
      asset: body.asset,
      actionType: body.actionType,
      destinationCategory: body.destinationCategory
    });
    const status = await session.principal.status(session.handoff.id);
    return NextResponse.json({ authorized: true, status });
  } catch (cause) {
    const error = describeError(cause);
    return NextResponse.json({ authorized: false, error }, { status: 200 });
  }
}
