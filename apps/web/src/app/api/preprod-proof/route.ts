import { NextResponse } from "next/server";
import { PREPROD_CONTRACT } from "@/lib/preprod-evidence";

// Asks the live Midnight Preprod indexer whether the deployed contract exists,
// and for the current chain height. Runs server-side so the Blockfrost project
// id (BLOCKFROST_PROJECT_ID) never reaches the browser. When it is not
// configured the route says so — it never fabricates a result.
export const dynamic = "force-dynamic";

export async function GET() {
  const projectId = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (!projectId) {
    return NextResponse.json({ configured: false, contract: PREPROD_CONTRACT });
  }

  const url = `https://midnight-preprod.blockfrost.io/api/v0?project_id=${encodeURIComponent(projectId)}`;
  // One retry: the first connection from a cold container occasionally fails fast.
  for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ block { height } contractAction(address: "${PREPROD_CONTRACT}") { __typename } }`
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store"
    });
    if (!res.ok) return NextResponse.json({ configured: true, reachable: false, status: res.status, contract: PREPROD_CONTRACT });
    const json = (await res.json()) as { data?: { block?: { height?: number }; contractAction?: { __typename?: string } | null } };
    return NextResponse.json({
      configured: true,
      reachable: true,
      contract: PREPROD_CONTRACT,
      contractFound: Boolean(json.data?.contractAction),
      actionType: json.data?.contractAction?.__typename ?? null,
      chainHeight: json.data?.block?.height ?? null,
      checkedAt: new Date().toISOString()
    });
  } catch (e) {
    if (attempt === 2) {
      const err = e as Error & { cause?: { code?: string } };
      return NextResponse.json({ configured: true, reachable: false, contract: PREPROD_CONTRACT, error: `${err.name}: ${err.cause?.code ?? err.message}`.slice(0, 120) });
    }
  }
  }
  return NextResponse.json({ configured: true, reachable: false, contract: PREPROD_CONTRACT });
}
