import { WardenError } from "@warden/sdk";

/** Maps a thrown `WardenError` to a stable `{kind, message}` the client can
 * render (e.g. `PolicyViolationError` → the "✕ BLOCKED — POLICY VIOLATION"
 * state). Never forwards anything beyond the error's own fixed message —
 * see docs/THREAT-MODEL.md, attack #10/#11: those messages are already
 * guaranteed to never contain a private value, and this boundary doesn't
 * add anything further. */
export function describeError(cause: unknown): { kind: string; message: string } {
  if (cause instanceof WardenError) {
    return { kind: cause.name, message: cause.message };
  }
  return { kind: "UnknownError", message: cause instanceof Error ? cause.message : String(cause) };
}
