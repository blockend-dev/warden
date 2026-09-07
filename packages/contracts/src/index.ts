// Public entry point — import from here, not `src/managed/**` directly.

export {
  Contract,
  ledger,
  pureCircuits,
  expectedVk,
  type Ledger,
  type Witnesses,
  type ImpureCircuits,
  type PureCircuits
} from "./managed/warden/contract/index.js";

export type { Policy, MandateContext } from "./types.js";

export {
  witnesses,
  emptyWardenPrivateState,
  withMandate,
  idHex,
  type WardenPrivateState,
  type MandateRecord
} from "./witnesses.js";
