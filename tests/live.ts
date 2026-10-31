// Read-only integration validation against the exact public Sepolia endpoint.
// No wallet, private key, eth_sendTransaction, or state-changing RPC method is used.
import { mining } from '../src/contracts';
import { eligiblePairs, sortIds } from '../src/domain';
import { discoverSampleHolder, explainError, loadHolder, readClaimable, readWorld, simulate, verifyClaim, verifyPair } from '../src/rpc';

async function main() {
  const world = await readWorld();
  console.log('Public Sepolia snapshot:', JSON.stringify(world, (_, value) => typeof value === 'bigint' ? String(value) : value));
  const holder = await discoverSampleHolder(world.blockTag);
  const loaded = await loadHolder(holder);
  console.log('Live sample holder:', holder, 'verified IDs:', loaded.tokens.map(t => String(t.id)).join(','));
  if (loaded.tokens.length < 2) throw new Error('Sample holder no longer has two live Squeeks in the scan.');
  const ids = sortIds(loaded.tokens.map(token => token.id));
  console.log('Batch claimable (18-decimal base units):', String(await readClaimable(ids)));
  await simulate(await verifyClaim(ids, holder), holder);
  console.log('Claim simulation: OK');
  const pair = eligiblePairs(loaded.tokens, world.core.blockHeight)[0];
  if (pair) { await simulate(await verifyPair(pair[0].id, pair[1].id, holder, pair[0].position.level), holder); console.log('Merge simulation: OK for', pair.map(t => String(t.id)).join(',')); }
  else console.log('Merge simulation: not performed; no eligible live pair.');
  try { await simulate(mining.encodeFunctionData('checkpoint')); console.log('Checkpoint simulation: OK'); }
  catch (error) { console.log('Checkpoint simulation:', await explainError(error, world.status)); }
  console.log('Live validation complete. No transactions sent.');
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
