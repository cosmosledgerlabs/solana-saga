/**
 * Engine tests — run with:  node --test
 *
 * These prove the orchestrator's behaviour WITHOUT a live chain or a wallet.
 * We inject a mock `web3`, a mock `connection` and a mock `provider`, so the
 * saga / compensation logic is exercised deterministically and offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFlow, STATUS, FLOW_STATE } from '../src/orchestrator.js';

// ---- minimal mocks ---------------------------------------------------------

class MockTransaction {
  constructor() { this.instructions = []; }
  add(...ixs) { this.instructions.push(...ixs.filter(Boolean)); return this; }
}

const mockWeb3 = {
  Transaction: MockTransaction,
  // no ComputeBudgetProgram -> withPriorityFee() is a no-op
};

let sigCounter = 0;
const mockConnection = {
  async getLatestBlockhash() {
    return { blockhash: 'MOCKHASH', lastValidBlockHeight: 10_000 };
  },
  async getSignatureStatus() {
    // Always "already confirmed" so confirmation returns immediately.
    return { value: { err: null, confirmationStatus: 'confirmed' } };
  },
  async sendRawTransaction() { return 'raw-' + (++sigCounter); },
};

const mockProvider = {
  // No signTransaction -> engine uses signAndSendTransaction (simpler path).
  async signAndSendTransaction() { return { signature: 'sig-' + (++sigCounter) }; },
};

const mockPubkey = { toBase58: () => 'MockPubkey' };

// A reusable 3-step definition. step 3 needs no compensation (it is last).
function makeSteps({ compensateStep2Throws = false } = {}) {
  return [
    {
      id: 'approve', label: 'APPROVE',
      execute: () => ({ tx: new MockTransaction(), extraSigners: [] }),
      compensate: () => ({ tx: new MockTransaction(), extraSigners: [] }),
    },
    {
      id: 'vest', label: 'VESTING',
      execute: () => ({ tx: new MockTransaction(), extraSigners: [] }),
      compensate: compensateStep2Throws
        ? () => { throw new Error('escrow key unavailable'); }
        : () => ({ tx: new MockTransaction(), extraSigners: [] }),
    },
    {
      id: 'distribute', label: 'DISTRIBUTION',
      execute: () => ({ tx: new MockTransaction(), extraSigners: [] }),
      compensate: null,
    },
  ];
}

function run(opts) {
  return runFlow({
    web3: mockWeb3,
    connection: mockConnection,
    provider: mockProvider,
    pubkey: mockPubkey,
    stepDefs: opts.stepDefs,
    ctx: { flowId: 'TEST', amount: 1000 },
    failAt: opts.failAt ?? 0,
    onUpdate: () => {},
  });
}

// ---- scenarios -------------------------------------------------------------

test('happy path: all steps succeed, flow COMPLETED', async () => {
  const { flowState, steps } = await run({ stepDefs: makeSteps(), failAt: 0 });
  assert.equal(flowState, FLOW_STATE.COMPLETED);
  assert.deepEqual(steps.map(s => s.status),
    [STATUS.SUCCESS, STATUS.SUCCESS, STATUS.SUCCESS]);
  assert.ok(steps.every(s => s.signature), 'every step records a signature');
});

test('fail at step 1: nothing to compensate, later steps SKIPPED', async () => {
  const { flowState, steps } = await run({ stepDefs: makeSteps(), failAt: 1 });
  assert.equal(flowState, FLOW_STATE.FAILED_COMPENSATED);
  assert.equal(steps[0].status, STATUS.FAILED);
  assert.equal(steps[1].status, STATUS.SKIPPED);
  assert.equal(steps[2].status, STATUS.SKIPPED);
});

test('fail at step 3: completed steps COMPENSATED in reverse order', async () => {
  const { flowState, steps } = await run({ stepDefs: makeSteps(), failAt: 3 });
  assert.equal(flowState, FLOW_STATE.FAILED_COMPENSATED);
  assert.equal(steps[0].status, STATUS.COMPENSATED, 'step 1 compensated');
  assert.equal(steps[1].status, STATUS.COMPENSATED, 'step 2 compensated');
  assert.equal(steps[2].status, STATUS.FAILED,      'step 3 is the failure');
  assert.ok(steps[1].compensationSignature, 'compensation records its own signature');
});

test('compensation failure: flow ends FAILED_INCOMPLETE (manual action)', async () => {
  const { flowState, steps } = await run({
    stepDefs: makeSteps({ compensateStep2Throws: true }),
    failAt: 3,
  });
  assert.equal(flowState, FLOW_STATE.FAILED_INCOMPLETE);
  // step 2's compensation failed, so it stays SUCCESS and carries a manual-action note
  assert.equal(steps[1].status, STATUS.SUCCESS);
  assert.match(steps[1].error, /manual intervention required/i);
  // step 1 still compensated fine
  assert.equal(steps[0].status, STATUS.COMPENSATED);
});
