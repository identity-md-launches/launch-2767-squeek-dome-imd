import type { Interface } from 'ethers';
import { CHAIN_ID, CONTRACTS, RPC_URL, core, mining, nft, type CheckpointStatus, type CoreState, type EthereumProvider, type MiningState, type Position, type Squeek, type World } from './contracts';
import { imageFromTokenURI, sameAddress, sortIds, validateSelection, verifyMerge } from './domain';

let requestId = 0;
export class RpcError extends Error {
  constructor(message: string, public readonly data: unknown, public readonly code: number) { super(message); }
}

export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  let response: Response;
  try {
    response = await fetch(RPC_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error('Sepolia RPC is unavailable. Check your connection and retry.'); }
  if (!response.ok) throw new Error(`Sepolia RPC returned HTTP ${response.status}. Retry in a moment.`);
  const body = await response.json();
  if (body.error) throw new RpcError(body.error.message ?? 'RPC request failed', body.error.data, body.error.code);
  if (!('result' in body)) throw new Error('Sepolia RPC returned an incomplete response. Retry.');
  return body.result as T;
}

export async function readContract(abi: Interface, to: string, name: string, args: readonly unknown[] = [], blockTag = 'latest') {
  const data = abi.encodeFunctionData(name, args);
  const raw = await rpc<string>('eth_call', [{ to, data }, blockTag]);
  return abi.decodeFunctionResult(name, raw);
}

export async function readStatus(blockTag = 'latest'): Promise<CheckpointStatus> {
  const r = await readContract(mining, CONTRACTS.mining, 'checkpointStatus', [], blockTag);
  return { corePaused: r[0], nextRound: r[1], roundSettled: r[2] };
}

export async function readWorld(): Promise<World> {
  const [chain, blockTag] = await Promise.all([rpc<string>('eth_chainId'), rpc<string>('eth_blockNumber')]);
  if (chain.toLowerCase() !== CHAIN_ID) throw new Error('The public RPC is not on Sepolia. Sending is disabled.');
  const [status, m, c] = await Promise.all([
    readStatus(blockTag), readContract(mining, CONTRACTS.mining, 'state', [], blockTag), readContract(core, CONTRACTS.core, 'state', [], blockTag),
  ]);
  const miningState = m[0].toObject() as MiningState;
  const coreState = c[0].toObject() as CoreState;
  const { weightActivationCursor: cursor, weightActivationCount: count } = miningState;
  if (cursor > count) throw new Error('The activation queue could not be verified. Refresh Sepolia state.');
  const length = Number(count - cursor > 32n ? 32n : count - cursor);
  const activations = await mapLimited(Array.from({ length }, (_, i) => cursor + BigInt(i)), async index => {
    const r = await readContract(mining, CONTRACTS.mining, 'weightActivation', [index], blockTag);
    return { index, round: r[0].round as bigint, addedWeight: r[0].addedWeight as bigint };
  });
  return { status, mining: miningState, core: coreState, activations, blockTag, readAt: Date.now() };
}

export async function mapLimited<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, limit = 4): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index]); }
  }));
  return result;
}

function isRevert(error: unknown) {
  return error instanceof RpcError && (error.code === 3 || /revert|nonexistent|invalid token/i.test(error.message));
}

export async function ownerOf(id: bigint, blockTag = 'latest'): Promise<string | null> {
  try { return (await readContract(nft, CONTRACTS.nft, 'ownerOf', [id], blockTag))[0] as string; }
  catch (error) { if (isRevert(error)) return null; throw error; }
}

export async function scanOwners(blockTag = 'latest', through = 30) {
  return mapLimited(Array.from({ length: through }, (_, i) => BigInt(i + 1)), async id => ({ id, owner: await ownerOf(id, blockTag) }));
}

export async function discoverSampleHolder(blockTag = 'latest') {
  const counts = new Map<string, number>();
  for (let id = 1n; id <= 20n; id++) {
    const owner = await ownerOf(id, blockTag);
    if (!owner) continue;
    const key = owner.toLowerCase();
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count >= 2) return owner;
  }
  throw new Error('No holder with two live Squeeks was found in IDs 1–20. Paste a holder address or enter token IDs instead.');
}

export async function readClaimable(ids: readonly bigint[], blockTag = 'latest') {
  const sorted = sortIds(ids);
  if (!sorted.length || sorted.length > 32) throw new Error('Select 1–32 different token IDs.');
  return (await readContract(mining, CONTRACTS.mining, 'claimable', [0, sorted], blockTag))[0] as bigint;
}

export async function readToken(id: bigint, blockTag = 'latest', withImage = true): Promise<Squeek | null> {
  const owner = await ownerOf(id, blockTag);
  if (!owner) return null;
  const [p, claimable, image] = await Promise.all([
    readContract(mining, CONTRACTS.mining, 'position', [0, id], blockTag),
    readClaimable([id], blockTag),
    withImage ? readContract(nft, CONTRACTS.nft, 'tokenURI', [id], blockTag).then(result => imageFromTokenURI(result[0])).catch(() => null) : Promise.resolve(null),
  ]);
  const position = { ...p[0].toObject(), level: Number(p[0].level) } as Position;
  return position.level === 0 ? null : { id, owner, position, claimable, image };
}

export async function loadHolder(owner: string, ids?: readonly bigint[]) {
  const blockTag = await rpc<string>('eth_blockNumber');
  const candidates = ids ? sortIds(ids) : (await scanOwners(blockTag)).filter(token => sameAddress(token.owner, owner)).map(token => token.id);
  const checked = await mapLimited(candidates, id => readToken(id, blockTag));
  const tokens = checked.filter((token): token is Squeek => token !== null && sameAddress(token.owner, owner));
  const rejected = candidates.filter(id => !tokens.some(token => token.id === id));
  return { tokens, rejected, blockTag };
}

export async function verifyClaim(ids: readonly bigint[], owner: string) {
  const blockTag = await rpc<string>('eth_blockNumber');
  const candidates = await mapLimited(ids, id => readToken(id, blockTag, false));
  const tokens = candidates.filter((token): token is Squeek => token !== null);
  validateSelection(tokens, ids, owner);
  await readClaimable(ids, blockTag);
  return mining.encodeFunctionData('claim', [0, sortIds(ids)]);
}

export async function verifyPair(survivorId: bigint, donorId: bigint, owner: string, expectedLevel?: number) {
  const blockTag = await rpc<string>('eth_blockNumber');
  const [survivor, donor, coreResult] = await Promise.all([
    readToken(survivorId, blockTag, false), readToken(donorId, blockTag, false), readContract(core, CONTRACTS.core, 'state', [], blockTag),
  ]);
  if (!survivor || !donor) throw new Error('One token was burned or is no longer live. Reload the holder.');
  if (expectedLevel !== undefined && (survivor.position.level !== expectedLevel || donor.position.level !== expectedLevel)) throw new Error('The pair’s level changed. Close the dialog, reload the holder, and review the new merge.');
  verifyMerge(survivor, donor, owner, coreResult[0].blockHeight);
  await readClaimable(sortIds([survivorId, donorId]), blockTag);
  return mining.encodeFunctionData('merge', [0, survivorId, donorId]);
}

export async function simulate(data: string, from?: string) {
  await rpc<string>('eth_call', [{ to: CONTRACTS.mining, data, value: '0x0', ...(from ? { from } : {}) }, 'latest']);
}

function revertData(error: unknown, depth = 0): string | null {
  if (depth > 5 || !error) return null;
  if (typeof error === 'string') {
    if (/^0x[0-9a-f]{8,}$/i.test(error)) return error;
    try { return revertData(JSON.parse(error), depth + 1); } catch { return null; }
  }
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    for (const key of ['data', 'error', 'originalError', 'result', 'body', 'cause']) {
      const data = revertData(e[key], depth + 1);
      if (data) return data;
    }
  }
  return null;
}

export async function explainError(error: unknown, fallback?: CheckpointStatus) {
  const data = revertData(error);
  if (data) {
    try {
      const decoded = mining.parseError(data);
      if (decoded) return `${decoded.name}(${decoded.args.map(arg => String(arg)).join(', ')})`;
    } catch { /* Give RPC status context below rather than undecoded hex. */ }
  }
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'Request declined in the wallet. Nothing was sent.';
  if (error instanceof Error && !(error instanceof RpcError) && !/0x[0-9a-f]{8}|revert/i.test(error.message)) return error.message;
  let status = fallback;
  try { status = await readStatus(); } catch { /* Last verified status is explicitly labeled. */ }
  if (status) return `Simulation failed. Latest available checkpoint status: corePaused=${status.corePaused}, nextRound=${status.nextRound}, roundSettled=${status.roundSettled}. ${status.corePaused ? 'The Core is paused.' : !status.roundSettled ? 'The next round is not settled; checkpoint would waste gas.' : 'Reload the holder and check ownership, pending rounds, and cooldowns.'}`;
  return 'The call could not be verified or its revert decoded. Sepolia status is unavailable. Refresh and simulate again before sending.';
}

export async function ensureSepolia(provider: EthereumProvider) {
  const chain = await provider.request({ method: 'eth_chainId' });
  if (String(chain).toLowerCase() !== CHAIN_ID) {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_ID, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC_URL], blockExplorerUrls: ['https://sepolia.etherscan.io'] }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
    }
  }
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== CHAIN_ID) throw new Error('Switch the wallet to Sepolia before sending.');
}

export interface Receipt { status: string; transactionHash: string; blockNumber: string }
export async function waitForReceipt(hash: string): Promise<Receipt | null> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const receipt = await rpc<Receipt | null>('eth_getTransactionReceipt', [hash]);
    if (receipt) return receipt;
    // This timer spaces real RPC receipt reads. It never creates transaction success.
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  return null;
}
