import { NextResponse } from "next/server";
import { toHex } from "@warden/shared";
import { withSession } from "@/lib/with-session";

/** This visitor's own, real, persistent principal/agent public-key commitments. */
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    return NextResponse.json({
      principalPk: toHex(session.principal.publicKey),
      agentPk: toHex(session.agent.publicKey)
    });
  });
}
