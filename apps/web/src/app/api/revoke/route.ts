import { NextResponse } from "next/server";
import { fromHex } from "@warden/shared";
import { controllingClient, findHandoff } from "@/lib/demo-session";
import { describeError } from "@/lib/api-error";
import { withSession } from "@/lib/with-session";

/** Permanent. Root mandate: the principal revokes. Delegated mandate: the
 * delegating agent (the child's principal) revokes. */
export async function POST(request: Request) {
  const body = await request.json();

  return withSession(request, async (session) => {
    const handoff = findHandoff(session, body.id);
    if (!handoff) {
      return NextResponse.json({ error: { kind: "NoMandate", message: "No mandate with that id in this session." } }, { status: 400 });
    }

    try {
      const evidence = await controllingClient(session, handoff).revoke(fromHex(body.id));
      const status = await session.principal.status(handoff.id);
      return NextResponse.json({ revoked: true, status, evidence });
    } catch (cause) {
      return NextResponse.json({ revoked: false, error: describeError(cause) }, { status: 400 });
    }
  });
}
