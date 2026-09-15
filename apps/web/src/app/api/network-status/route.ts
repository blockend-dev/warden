// Backs the environment badge's honest LIVE / initializing / unavailable /
// simulator state — see apps/web/src/components/ui/environment-badge.tsx.
// A direct read of the real server-side connection state, never a
// client-side guess: the badge must not claim LIVE unless this route says
// the Preprod connection actually finished initializing.

import { NextResponse } from "next/server";
import { getNetworkStatus } from "@/server/network";

export async function GET() {
  return NextResponse.json(getNetworkStatus());
}
