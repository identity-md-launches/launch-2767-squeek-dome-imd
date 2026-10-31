import { formatUnits, getAddress, isAddress } from 'ethers';
import type { Squeek } from './contracts';

export const sortIds = (ids: readonly bigint[]) => [...new Set(ids)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const integer = (value: bigint | number) => value.toLocaleString('en-US');
export const sqkExact = (value: bigint) => formatUnits(value, 18);
export function sqk(value: bigint, places = 4) {
  const [whole, fraction = ''] = sqkExact(value).split('.');
  const displayed = fraction.slice(0, places).replace(/0+$/, '');
  return `${BigInt(whole).toLocaleString('en-US')}${displayed ? `.${displayed}` : ''}`;
}

export function parseIds(text: string): { ids: bigint[]; duplicates: bigint[] } {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) throw new Error('Enter 1–32 token IDs, separated by commas.');
  if (parts.length > 128) throw new Error('Enter at most 32 different token IDs.');
  if (parts.some(id => !/^\d+$/.test(id))) throw new Error('Token IDs must be positive whole numbers, separated by commas.');
  const ids = parts.map(id => BigInt(id));
  if (ids.some(id => id < 1n || id >= 2n ** 256n)) throw new Error('Use token IDs between 1 and the uint256 maximum.');
  const unique = sortIds(ids);
  if (unique.length > 32) throw new Error('Load at most 32 different token IDs at once.');
  const seen = new Set<bigint>();
  const duplicates = sortIds(ids.filter(id => { const duplicate = seen.has(id); seen.add(id); return duplicate; }));
  return { ids: unique, duplicates };
}

export function parseHolder(text: string) {
  if (!isAddress(text.trim()) || /^0x0{40}$/i.test(text.trim())) throw new Error('Paste a valid, nonzero Ethereum holder address.');
  return getAddress(text.trim());
}

export function validateSelection(tokens: readonly Squeek[], ids: readonly bigint[], owner: string) {
  const sorted = sortIds(ids);
  if (!sorted.length || sorted.length > 32) throw new Error('Select 1–32 Squeeks.');
  if (sorted.length !== ids.length) throw new Error('Duplicate token IDs are blocked. Select each token once.');
  const selected = sorted.map(id => tokens.find(token => token.id === id));
  if (selected.some(token => !token || token.position.level === 0 || !sameAddress(token.owner, owner))) {
    throw new Error('A selected token is burned, unminted, or belongs to another holder. Reload the holder.');
  }
  return selected as Squeek[];
}

export function mergeEligible(token: Squeek, height: bigint) {
  return token.position.level >= 1 && token.position.level < 10 && token.position.pendingRound === 0n && token.position.nextMergeBlock <= height;
}

export function eligiblePairs(tokens: readonly Squeek[], height: bigint): [Squeek, Squeek][] {
  const eligible = tokens.filter(token => mergeEligible(token, height));
  return eligible.flatMap((a, i) => eligible.slice(i + 1).filter(b => a.id !== b.id && a.position.level === b.position.level && sameAddress(a.owner, b.owner)).map(b => [a, b] as [Squeek, Squeek]));
}

export function verifyMerge(survivor: Squeek, donor: Squeek, owner: string, height: bigint) {
  if (survivor.id === donor.id || !sameAddress(survivor.owner, owner) || !sameAddress(donor.owner, owner) || survivor.position.level !== donor.position.level || !mergeEligible(survivor, height) || !mergeEligible(donor, height)) {
    throw new Error('This pair is no longer eligible. Both tokens must be yours, the same level (1–9), active, and past their merge block. Reload the holder.');
  }
}

export function imageFromTokenURI(uri: string): string | null {
  if (!uri.startsWith('data:application/json;base64,')) return null;
  try {
    const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), c => c.charCodeAt(0));
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    return typeof metadata.image === 'string' && /^data:image\/svg\+xml[;,]/i.test(metadata.image) ? metadata.image : null;
  } catch { return null; }
}
