/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The live Preprod backend (apps/web/src/server/preprod/preprod-network.ts,
  // server-only) pulls in classic-level (native LevelDB bindings, via
  // @midnight-ntwrk/midnight-js-level-private-state-provider) and the
  // midnight-js/wallet-sdk stack. Native addons can't be webpack-bundled —
  // trying to breaks their runtime binary-path resolution ("No native build
  // was found..."), surfacing during Next's own build-time page-data
  // collection, not just at request time. Keeping the whole live-network
  // dependency chain external (a plain `require()` at runtime, same as any
  // other Node CommonJS package) is what actually fixes it.
  serverExternalPackages: [
    "classic-level",
    "@midnight-ntwrk/compact-runtime",
    "@midnight-ntwrk/ledger-v8",
    "@midnight-ntwrk/midnight-js",
    "@midnight-ntwrk/midnight-js-contracts",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider",
    "@midnight-ntwrk/midnight-js-level-private-state-provider",
    "@midnight-ntwrk/midnight-js-node-zk-config-provider",
    "@midnight-ntwrk/midnight-js-protocol",
    "@midnight-ntwrk/wallet-sdk-abstractions",
    "@midnight-ntwrk/wallet-sdk-address-format",
    "@midnight-ntwrk/wallet-sdk-dust-wallet",
    "@midnight-ntwrk/wallet-sdk-facade",
    "@midnight-ntwrk/wallet-sdk-hd",
    "@midnight-ntwrk/wallet-sdk-shielded",
    "@midnight-ntwrk/wallet-sdk-unshielded-wallet"
  ]
};

export default nextConfig;
