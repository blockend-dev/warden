import { WardenError } from "@warden/sdk";

/** Maps a thrown `WardenError` to a stable `{kind, message}` for the client. */
export function describeError(cause: unknown): { kind: string; message: string } {
  if (cause instanceof WardenError) {
    return { kind: cause.name, message: cause.message };
  }
  return { kind: "UnknownError", message: cause instanceof Error ? cause.message : String(cause) };
}
