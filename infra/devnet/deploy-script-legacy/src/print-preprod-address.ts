// One-off utility: derive the Preprod wallet from .preprod-seed (generated
// once, kept local, never committed — see .gitignore) and print its
// unshielded receiving address, so it can be pasted into the Preprod faucet
// (https://midnight-tmnight-preprod.nethermind.dev/). Not part of the
// deploy-and-call-legacy.ts flow itself.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";

import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore, PublicKey } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const seed = fs.readFileSync(path.resolve(currentDir, "..", ".preprod-seed"), "utf8").trim();

setNetworkId("preprod");

const hdWallet = HDWallet.fromSeed(Buffer.from(seed, "hex"));
if (hdWallet.type !== "seedOk") throw new Error("bad seed");
const derived = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
if (derived.type !== "keysDerived") throw new Error("key derivation failed");
hdWallet.hdWallet.clear();

const keystore = createKeystore(derived.keys[Roles.NightExternal], "preprod" as any);
const pk = PublicKey.fromKeyStore(keystore);

console.log("Preprod unshielded address (paste into the faucet):");
console.log(pk.address);
