import { NextResponse } from "next/server";
import { toHex } from "@warden/shared";
import { getDemoSession } from "@/lib/demo-session";

/** This session's real, persistent principal/agent public-key commitments. */
export async function GET() {
  const session = getDemoSession();
  return NextResponse.json({
    principalPk: toHex(session.principal.publicKey),
    agentPk: toHex(session.agent.publicKey)
  });
}
