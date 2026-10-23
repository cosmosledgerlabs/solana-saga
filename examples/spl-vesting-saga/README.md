# Example: SPL vesting saga (approve → vesting → distribution)

This is the real flow behind the COSMOS `/flow` demo, kept here as a worked
example of `solana-saga`. It moves **real SPL tokens on Solana devnet** through
three steps, and compensates if a later step fails.

| Step | `execute` | `compensate` |
|------|-----------|--------------|
| 1. Approve | Memo transaction recording the approval | Memo recording a revocation |
| 2. Vesting | SPL transfer: **owner → escrow** | SPL transfer back: **escrow → owner** |
| 3. Distribution | SPL transfer: **escrow → recipient** | none (final step) |

If step 3 fails, step 2 is compensated (escrow → owner) and step 1's approval
is revoked — the tokens end up back where they started.

## Files

- `steps.js` — the three step definitions, in the shape `solana-saga` expects
  (`execute` / `compensate` returning `{ tx, extraSigners }`).
- `spl.js` — helpers that create a test mint and the owner/escrow/recipient
  token accounts, and build the SPL transfer instructions.

## Honest note on the escrow

The escrow account here is held by a keypair generated in the browser and kept
in page state. That is enough to show funds genuinely leaving and returning,
**but it is not a trustless escrow.** A production version would use a
program-derived address (PDA) owned by an on-chain program. Do not describe
this example as a trustless escrow.

## Running it

This example is browser-oriented (it uses a wallet provider such as Phantom and
generates a keypair in the page). See the live, runnable version at
**https://cosmosledgerlabs.com/flow**, and `pages/flow.js` in the COSMOS website
repo for the full wiring (SETUP, wallet connection, run log, and UI).
