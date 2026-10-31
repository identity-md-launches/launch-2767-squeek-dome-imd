# Squeek Dome

A one-page, non-custodial Squeek holder and Keeper workbench on **Sepolia, chain 11155111 / `0xaa36a7`**. Testnet Squeeks, SQK, and ETH have no monetary value. The finished static website is in [`dist/`](dist/).

## Install, run, and rebuild

Use Node.js 22.12 or newer and npm. No API key, environment file, backend, or wallet project ID is needed.

```sh
npm ci
npm run dev
```

To rebuild and preview the production export:

```sh
npm run typecheck
npm run build
npm run preview
```

Vite uses `base: './'`. Serve the entire `dist/` directory over HTTP(S); its scripts, stylesheet, font, favicon, and share image use relative URLs. Hash anchors handle panel navigation, including when hosted below a gateway subpath. Keep the generated `dist/` files alongside the source and lockfile in the submission. A deployment does not need to rebuild them.

## Use the workbench

- **Keeper Crank:** reads public Mining and Core state immediately. Simulate without a wallet or any Squeeks. Sending requires a connected Sepolia wallet, an unpaused Core, and a settled next round. Cranking spends Sepolia gas and earns no caller reward. An unsettled round keeps simulation available and disables sending.
- **Inspect a holder:** paste an address to scan IDs 1–30, enter 1–32 explicit IDs, or select **Load Live Sepolia Sample Holder**. The sample is discovered through `ownerOf` calls in IDs 1–20, then scanned through ID 30. Burned/unminted IDs are skipped. Explicit IDs can be above 30. Without an address, the first typed ID determines the holder. Duplicate inputs are removed with a visible explanation; foreign or non-live IDs are blocked.
- **Batch Claimer:** choose up to 32 verified positions. IDs are numerically sorted and unique. The table displays singleton `claimable` values; the total is a separate batch `claimable` RPC read, retaining all 18-decimal precision. The lowest selected ID keeps the fraction. Inspect Mode permits simulations from the holder address. Only the direct owner of every selected token can send.
- **Merge Arena:** offers only distinct same-level pairs at levels 1–9, with no pending round and cooldowns complete according to `Core.state().blockHeight`. Swap updates both cards, images, amounts, and modal IDs. **Prepare Merge** opens a native blocking dialog naming the survivor and permanently burned donor. A checkbox and successful explicit simulation are required before sending. The chosen IDs are frozen inside the dialog; changed levels require reopening it.

The header uses **`window.ethereum` only**, as explicitly required by this brief. Connect a browser wallet, or open the page in a wallet’s own browser on a phone. A wrong-chain connection offers **Switch to Sepolia**. There is no WalletConnect relay, Coinbase SDK, or alternate signing provider. The pinned wallet guide’s generic connector stack is superseded by this brief’s explicit provider constraint.

## Chain and transaction integrity

All read-only methods, simulations, and receipt reads use `https://ethereum-sepolia-rpc.publicnode.com`, independent of the wallet network. Core/Mining snapshots use one Ethereum block tag. The Core/Mining summary refreshes every 30 seconds while visible, on demand, and after a receipt. Holder positions reload on demand and after transactions; every candidate is re-verified before simulation and again before signing.

| Contract | Exact Sepolia address |
| --- | --- |
| SqueekCore V3 | `0x74665dAecA35A2303e767E76a2FF1FB6F93e119f` |
| SqueekMining V6 | `0x3beE588fC20dE788Bac17d33b41Da7346cb27EC4` |
| SqueekNFT | `0x0eAF3E0d40A0a8E5a6Ac030b2459E9FB0B7905c6` |
| DotGrid, via NFT `tokenURI` only | `0x2dC7661D172fEf0FC900E0aD0f4ffCE68E8bfD75` |

Collection is always 0; Sepolia reward per Squeek block is 5,600 SQK. Mining’s 13-field state and Core’s 8-field state follow the supplied ABI order. Activation reads start at the cursor, stop before the count, and never exceed 32 entries. An empty queue makes no activation calls. NFT metadata is decoded from base64 JSON; its SVG image is rendered only in an isolated `<img>`. No owner API is used.

Each send checks/switches the wallet chain, checks the current account, re-reads authorization and eligibility, runs a fresh public-RPC `eth_call`, re-checks chain/account, then requests real `eth_sendTransaction` with `from`, `to=Mining`, ABI calldata, and `value: '0x0'`. No approvals, operators, private keys, minting, staking, or new contracts are involved. Claim/merge require direct `ownerOf`, even if the connected wallet is an approved operator.

Success requires a real receipt with `status: '0x1'`. Reverted receipts are labeled as failures. A receipt read failure preserves the submitted hash and offers **Check receipt**; it never invents confirmation. Polling lasts up to three minutes and only spaces real RPC calls. The exact hash links to Sepolia Etherscan. Page reload clears local selection and transaction notices; use wallet activity/Etherscan to follow a previously submitted transaction.

## Validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium webkit
npm run test:browser
npm run test:live
```

`tests/browser.mjs` serves the production export at `/preview/`, uses isolated RPC fixtures and a test wallet provider to exercise otherwise unavailable signing and receipt states, and runs in Chromium and WebKit. Those fixtures are exclusively test files and are absent from the production bundle. `SKIP_WEBKIT=1 npm run test:browser` is available for environments that only have Chromium. `tests/live.ts` uses the real RPC, with no signing or state-changing method.

Actual worker results on 2026-10-31:

- Production build and TypeScript typecheck passed.
- All **31** domain/RPC tests passed.
- Chromium and WebKit production-export interaction suites passed (**38 assertion groups per engine**), including sorted claims, duplicate/unowned filtering, swap rendering with distinct test amounts, burn gates, focus trapping/return, chain switching, changed ownership, receipt recovery, reverted receipts, and Keeper use without NFT reads.
- Axe scans of populated workbench and merge-dialog states found **0 violations** in both browser suites. Reflow checks passed at 320, 375, 390, 768, and 1440px.
- Live RPC validation found a sample holder with IDs 1–10; claim and merge `eth_call` simulations passed. Checkpoint simulation correctly decoded `RoundNotSettled(1974)`.
- The final pinned `taste@1` probe passed **16/16** checks. The 390px first screen shows the product, sample loader, wallet connect, and checkpoint simulation. Main simulation button bottom: approximately **673px** in an 844px viewport.
- Final production preview loaded local assets successfully, with no page-script or local-resource failures. The inspected console initially had 0 errors/warnings; final tab teardown reported two `ERR_CONNECTION_CLOSED` entries for public-RPC requests. RPC transport errors are surfaced with retry guidance.

No funded owner wallet was supplied, so **no actual wallet signature, broadcast, permanent burn, or live receipt confirmation was performed**. The send/receipt paths were validated in isolated tests; live reads and simulations were validated against Sepolia. Native screen-reader sessions, physical phones, and browser-native 200% zoom were not tested. See [`artifacts/validation.md`](artifacts/validation.md) for evidence, design review, fixes, and limitations, and [`DESIGN.md`](DESIGN.md) for the implemented design system.

## Source map and attribution

`src/contracts.ts` holds the exact chain/ABI definitions; `src/rpc.ts` handles public reads, verification, errors, chain switching, and receipts; `src/domain.ts` holds sorting, ownership, merge rules, and image parsing; `src/App.tsx` owns one shared state and all three panels; `src/styles.css` defines the design tokens and responsive layouts.

Built to the [Squeek Dome brief](https://github.com/0xtakoyaki22/squeek-dome). Design guidance is adapted from Jakub Krehel’s [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT; documentation guidance from Paul Bakaus’s [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0. Retained design-guide licenses are in `artifacts/licenses/design-guides.txt`. DM Sans is bundled locally under `public/fonts/OFL.txt`; browser-library notices are in `public/THIRD_PARTY_NOTICES.txt`, copied into `dist/` by the build.
