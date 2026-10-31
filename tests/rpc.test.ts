import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRACTS, core, mining, nft, type EthereumProvider } from '../src/contracts';
import { RpcError, ensureSepolia, explainError, ownerOf, readWorld, verifyClaim, verifyPair } from '../src/rpc';

const holder = '0x7f8Cd6A535072AC099623a879cF93cBdAA4F513d';
const calls: { method: string; params: unknown[] }[] = [];
function fixture(cursor = 0n, count = cursor, otherOwner = false) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    calls.push(request);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0xaa36a7';
    else if (request.method === 'eth_blockNumber') result = '0x100';
    else if (request.method === 'eth_call') {
      const transaction = request.params[0];
      const abi = transaction.to === CONTRACTS.core ? core : transaction.to === CONTRACTS.nft ? nft : mining;
      const call = abi.parseTransaction({ data: transaction.data })!;
      switch (call.name) {
        case 'checkpointStatus': result = mining.encodeFunctionResult(call.name, [false, 100n, false]); break;
        case 'state': result = abi === core ? core.encodeFunctionResult('state', [[99n, 123n, 9000000000n, 9n, 0n, 11266n, 3n, false]]) : mining.encodeFunctionResult('state', [[1000n, 500n, 2000n, 77n, 9n, 44n, cursor, count, true, 99n, 123n, 9000000000n, 11266n]]); break;
        case 'weightActivation': result = mining.encodeFunctionResult(call.name, [[100n + call.args[0], 1000n]]); break;
        case 'ownerOf': result = nft.encodeFunctionResult(call.name, [otherOwner ? CONTRACTS.core : holder]); break;
        case 'position': result = mining.encodeFunctionResult(call.name, [[1000n, 0n, 0n, 9n, 1, 55n, 2n ** 128n]]); break;
        case 'claimable': result = mining.encodeFunctionResult(call.name, [123n]); break;
        default: throw new Error(`Unexpected fixture call: ${call.name}`);
      }
    } else throw new Error(`Unexpected method: ${request.method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('exact snapshots and bounded queue', () => {
  it('decodes all 13 Mining and 8 Core fields in the specified order; no empty queue calls', async () => {
    fixture(235n);
    const world = await readWorld();
    expect(world.core.blockHeight).toBe(9n);
    expect(world.core.workPerThousandBlocks).toBe(11266n);
    expect(world.mining.processedThroughRound).toBe(99n);
    expect(world.mining.closedWorkPerThousandBlocks).toBe(11266n);
    expect(world.activations).toEqual([]);
    expect(calls.filter(c => c.method === 'eth_call')).toHaveLength(3);
    expect(calls.filter(c => c.method === 'eth_call').every(c => c.params[1] === '0x100')).toBe(true);
  });
  it('queries only cursor through cursor+31 for a large queue', async () => {
    fixture(235n, 300n);
    const world = await readWorld();
    expect(world.activations).toHaveLength(32);
    expect(world.activations[0].index).toBe(235n);
    expect(world.activations[31].index).toBe(266n);
  });
  it('never reads beyond a short queue', async () => {
    fixture(235n, 237n);
    expect((await readWorld()).activations.map(a => a.index)).toEqual([235n, 236n]);
  });
});

describe('fresh authorization', () => {
  it('re-reads each owner, position, singleton claimable and batch claimable before claim encoding', async () => {
    fixture();
    const data = await verifyClaim([2n, 1n], holder);
    expect(mining.decodeFunctionData('claim', data)[1].map(String)).toEqual(['1', '2']);
    expect(calls.filter(c => c.method === 'eth_call')).toHaveLength(7);
  });
  it('blocks an operator or changed owner even when claimable succeeds', async () => {
    fixture(0n, 0n, true);
    await expect(verifyClaim([1n], holder)).rejects.toThrow(/another holder/);
  });
  it('rechecks both positions against Core height and the level shown in the burn dialog', async () => {
    fixture();
    expect(mining.decodeFunctionData('merge', await verifyPair(2n, 1n, holder, 1)).map(String)).toEqual(['0', '2', '1']);
    await expect(verifyPair(2n, 1n, holder, 2)).rejects.toThrow(/level changed/);
  });
});

describe('RPC failure and wallet handling', () => {
  it('skips ownerOf reverts while surfacing transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 3, message: 'execution reverted', data: '0x' } }))));
    expect(await ownerOf(999n)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(ownerOf(1n)).rejects.toThrow(/unavailable/);
  });
  it.each(['RoundNotSettled', 'CorePaused', 'InvalidClaim', 'InvalidPosition', 'InvalidMerge', 'Unauthorized'])('decodes %s', async name => {
    const data = mining.encodeErrorResult(name, name === 'RoundNotSettled' ? [1974n] : []);
    const message = await explainError(new RpcError('execution reverted', data, 3));
    expect(message).toBe(`${name}(${name === 'RoundNotSettled' ? '1974' : ''})`);
  });
  it('uses checkpointStatus context for an unknown revert', async () => {
    fixture();
    const message = await explainError(new RpcError('execution reverted', '0x12345678', 3));
    expect(message).toContain('nextRound=100');
    expect(message).toContain('roundSettled=false');
    expect(message).not.toContain('0x12345678');
  });
  it('switches a wrong wallet chain and verifies the result', async () => {
    let network = '0x1';
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return network;
      if (method === 'wallet_switchEthereumChain') { network = '0xaa36a7'; return null; }
      throw new Error('Unexpected wallet request');
    });
    await ensureSepolia({ request } as EthereumProvider);
    expect(request.mock.calls.map(call => call[0].method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId']);
  });
  it('rejects a wallet that stays on the wrong chain', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x1' : null);
    await expect(ensureSepolia({ request } as EthereumProvider)).rejects.toThrow(/Switch the wallet/);
  });
});
