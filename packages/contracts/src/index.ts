// Public entry point for `@warden/contracts`. Consumers (the SDK, tests
// outside this package) should import from here rather than reaching into
// `src/managed/**` directly — this is the one place that path is allowed to
// leak, so it only has to be updated here if the compiler's output layout
// ever changes.

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
