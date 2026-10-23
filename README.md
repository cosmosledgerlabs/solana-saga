# solana-saga

**Run a sequence of Solana transactions as a saga.** A single Solana
transaction is atomic — the chain guarantees it. A *sequence* of transactions
is not. If step 3 of a 3-step operation fails, steps 1 and 2 have already
confirmed and cannot be undone. `solana-saga` closes that gap: when any step
fails, it **compensates** the completed steps in reverse order — a confirmed
transaction is offset by a new one, never "rolled back."

It also ships the unglamorous-but-essential part most teams rewrite by hand:
a **hardened send/confirm engine** — poll-based confirmation (doesn't give up
the instant the blockhash expires), rebroadcast under network load,
fresh-blockhash retries on expiry, and a duplicate-send guard that proves the
previous attempt didn't land before resending.

- **Zero required runtime dependencies in the core.** You inject
  `@solana/web3.js`; the engine never imports it. Works with any wallet
  provider that exposes `signTransaction` or `signAndSendTransaction`.
- **Wallet-agnostic, cluster-agnostic.** Devnet, testnet or mainnet; Phantom
  or any compatible provider.
- **MIT licensed.** Public good, free to use, modify and ship.

> Maintained by [COSMOS Ledger Labs](https://cosmosledgerlabs.com). Live demo
> of the engine running real on-chain compensation on Solana devnet:
> **https://cosmosledgerlabs.com/flow**

---

## Why "compensate", not "rollback"

An on-chain transaction that has confirmed is permanent. You cannot delete it.
The only honest way to "undo" a confirmed transfer is to send a *new* transfer
that moves the value back. That is a **compensating transaction**, and running
them in reverse order for the steps that already succeeded is the
[saga pattern](https://microservices.io/patterns/data/saga.html). This library
never claims to roll back the chain — it compensates.

---

## Install

```bash
npm install @cosmosledgerlabs/solana-saga @solana/web3.js
```

(The core needs only `@solana/web3.js`, and even that is injected by you — see
below. `@solana/spl-token` is only needed if your steps move SPL tokens, as the
bundled example does.)

---

## Quick start

You define **steps**. Each step is an object with an `execute` builder and an
optional `compensate` builder. A builder returns `{ tx, extraSigners }`.

```js
import * as web3 from '@solana/web3.js';
import { runFlow, FLOW_STATE } from '@cosmosledgerlabs/solana-saga';

const connection = new web3.Connection(RPC_URL, 'confirmed');

const steps = [
  {
    id: 'approve',
    label: 'Approve',
    execute: (web3, pubkey, ctx) => ({ tx: buildApproveTx(web3, pubkey, ctx), extraSigners: [] }),
    compensate: (web3, pubkey, ctx) => ({ tx: buildRevokeTx(web3, pubkey, ctx), extraSigners: [] }),
  },
  {
    id: 'transfer',
    label: 'Transfer',
    execute: (web3, pubkey, ctx) => ({ tx: buildTransferTx(web3, pubkey, ctx), extraSigners: [] }),
    compensate: (web3, pubkey, ctx) => ({ tx: buildReverseTransferTx(web3, pubkey, ctx), extraSigners: [ctx.escrowKeypair] }),
  },
  // last step needs no compensation of its own
  { id: 'finalize', label: 'Finalize', execute: /* ... */, compensate: null },
];

const { flowState, steps: result } = await runFlow({
  web3,                 // the @solana/web3.js module (injected)
  connection,           // a Connection instance
  provider: window.solana, // wallet provider (Phantom etc.)
  pubkey: window.solana.publicKey,
  stepDefs: steps,
  ctx: { flowId: 'ABC-123', amount: 1000 /* , your accounts... */ },
  onUpdate: (steps, state) => renderProgress(steps, state), // live UI updates
  onNotice: (msg) => toast(msg),                            // human-readable status
});

if (flowState === FLOW_STATE.COMPLETED) {
  // all steps succeeded
} else if (flowState === FLOW_STATE.FAILED_COMPENSATED) {
  // a step failed; everything before it was compensated — funds are back
} else if (flowState === FLOW_STATE.FAILED_INCOMPLETE) {
  // a compensation itself failed — a step needs manual intervention
}
```

---

## API

### `runFlow(opts) → Promise<{ flowState, steps }>`

| option       | type       | meaning |
|--------------|------------|---------|
| `web3`       | module     | the `@solana/web3.js` module |
| `connection` | Connection | an RPC connection |
| `provider`   | object     | wallet provider (`signTransaction` preferred, `signAndSendTransaction` fallback) |
| `pubkey`     | PublicKey  | the fee payer / signer |
| `stepDefs`   | Step[]     | your step definitions (see below) |
| `ctx`        | object     | passed to every builder — put your amounts, accounts, flowId here |
| `failAt`     | number     | 1-based step to fail *deliberately* (demo/testing); `0` = off |
| `onUpdate`   | function   | `(steps, flowState) => void`, called on every state change |
| `onNotice`   | function   | `(message) => void`, human-readable progress (retries, waits) |

### A **Step**

```
{
  id: string,
  label: string,
  execute:    (web3, pubkey, ctx) => ({ tx, extraSigners }),
  compensate: (web3, pubkey, ctx) => ({ tx, extraSigners })  // or null
}
```

### Exports

`runFlow`, `initSteps`, `readableError`, and the enums `STATUS`
(`pending · running · success · failed · compensating · compensated · skipped`)
and `FLOW_STATE`
(`idle · running · completed · failed_compensated · failed_incomplete`).

---

## Worked example

[`examples/spl-vesting-saga/`](examples/spl-vesting-saga/) is a complete,
real example taken from the COSMOS `/flow` demo: a three-step
**approve → vesting → distribution** flow that moves real SPL tokens on
devnet (owner → escrow → recipient), with compensation that transfers the
tokens back if a later step fails.

---

## Tests

The engine is tested **offline** — no chain, no wallet, no tokens — by
injecting mock `web3` / `connection` / `provider` objects:

```bash
npm test
```

Covers: the happy path; failure at the first step (nothing to compensate);
failure at the last step (earlier steps compensated in reverse order); and a
compensation that itself fails (ends `failed_incomplete`, flagging manual
action).

---

## License

MIT © 2026 COSMOS Ledger Labs Inc. See [LICENSE](LICENSE).
