// Encoders shared by the SDK, agent adapter, and demo UI for the fixed-width
// Bytes<32> identifiers warden.compact expects.

/** Left-pads a UTF-8 string into a fixed 32-byte identifier. Not a hash. */
export function encodeCategory(label: string): Uint8Array {
  const bytes = new TextEncoder().encode(label);
  if (bytes.length > 32) {
    throw new Error(`Warden: category label "${label}" is longer than 32 bytes once UTF-8 encoded.`);
  }
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

export function decodeCategory(bytes: Uint8Array): string {
  const trimmed = bytes.subarray(0, bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0));
  return new TextDecoder().decode(trimmed);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Warden: hex string must have an even length.");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Cryptographically random 32 bytes — never `Math.random()`. */
export function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function shortId(bytes: Uint8Array): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
