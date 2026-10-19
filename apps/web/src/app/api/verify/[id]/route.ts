import { NextResponse } from "next/server";
import { createWarden } from "@warden/sdk";
import { fromHex } from "@warden/shared";
import { getNetwork } from "@/server/network";

export const dynamic = "force-dynamic";

/** What a third party sees for ANY mandate id: public ledger state only. No
 * session, no secrets — a fresh anonymous observer client reads the ledger. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{64}$/i.test(id)) {
    return NextResponse.json({ error: { kind: "BadId", message: "A mandate id is 64 hex characters." } }, { status: 400 });
  }
  const observer = createWarden({ role: "principal", network: getNetwork() });
  const status = await observer.status(fromHex(id));
  const children = status.status === "unknown" ? [] : await observer.children(fromHex(id));
  const childStatuses = await Promise.all(children.map((c) => observer.status(fromHex(c))));
  return NextResponse.json({ status, children: childStatuses });
}
