// Runs once when the Next.js server boots. Importing the network module starts
// the live Preprod connection (wallet sync, deploy-on-boot) immediately instead
// of waiting for the first API request, so a restart resumes syncing on its own.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/server/network");
  }
}
