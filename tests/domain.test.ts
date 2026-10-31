import { describe, expect, it } from 'vitest';
import { eligiblePairs, imageFromTokenURI, mergeEligible, parseHolder, parseIds, sqkExact, validateSelection, verifyMerge } from '../src/domain';
import { CONTRACTS, type Squeek } from '../src/contracts';

const holder = '0x7f8Cd6A535072AC099623a879cF93cBdAA4F513d';
const token = (id: bigint, extra: Partial<Squeek['position']> = {}): Squeek => ({
  id, owner: holder, claimable: 123456789123456789n, image: null,
  position: { level: 1, activeWeight: 1000n, pendingWeight: 0n, pendingRound: 0n, nextMergeBlock: 100n, lastIndex: 0n, accruedScaled: 2n ** 128n, ...extra },
});

describe('ID normalization and ownership', () => {
  it('sorts numerically, deduplicates, and reports duplicates before calldata', () => {
    expect(parseIds('10, 2, 1, 2, 10')).toEqual({ ids: [1n, 2n, 10n], duplicates: [2n, 10n] });
    expect(parseIds('9007199254740994 9007199254740993').ids).toEqual([9007199254740993n, 9007199254740994n]);
  });
  it.each(['', '0', '-1', '1.5', '1e2', 'one', String(2n ** 256n)])('rejects invalid IDs: %s', text => expect(() => parseIds(text)).toThrow());
  it('rejects a batch above 32 IDs', () => expect(() => parseIds(Array.from({ length: 33 }, (_, i) => i + 1).join(','))).toThrow(/32/));
  it('blocks duplicate, missing, level-zero, and unowned transaction candidates', () => {
    const tokens = [token(1n), token(2n), token(3n, { level: 0 }), { ...token(4n), owner: CONTRACTS.core }];
    for (const ids of [[1n, 1n], [99n], [3n], [4n], []]) expect(() => validateSelection(tokens, ids, holder)).toThrow();
    expect(validateSelection(tokens, [2n, 1n], holder.toLowerCase()).map(t => t.id)).toEqual([1n, 2n]);
  });
  it('validates addresses and never accepts a zero owner', () => {
    expect(parseHolder(holder)).toBe(holder);
    expect(() => parseHolder('0x' + '0'.repeat(40))).toThrow();
    expect(() => parseHolder('not an address')).toThrow();
  });
});

describe('merge safety', () => {
  it('uses the Squeek block height, checks cooldown inclusively, and excludes pending/max levels', () => {
    expect(mergeEligible(token(1n), 100n)).toBe(true);
    expect(mergeEligible(token(1n), 99n)).toBe(false);
    expect(mergeEligible(token(1n, { pendingRound: 1n }), 1000n)).toBe(false);
    expect(mergeEligible(token(1n, { level: 10 }), 1000n)).toBe(false);
    expect(mergeEligible(token(1n, { level: 0 }), 1000n)).toBe(false);
  });
  it('only offers distinct, same-level pairs belonging to one direct owner', () => {
    const tokens = [token(1n), token(2n), token(3n, { level: 2 }), { ...token(4n), owner: CONTRACTS.core }, token(5n, { pendingRound: 9n })];
    expect(eligiblePairs(tokens, 100n).map(pair => pair.map(t => t.id))).toEqual([[1n, 2n]]);
    expect(() => verifyMerge(tokens[0], tokens[0], holder, 100n)).toThrow();
    expect(() => verifyMerge(tokens[0], tokens[3], holder, 100n)).toThrow();
    expect(() => verifyMerge(tokens[0], tokens[2], holder, 100n)).toThrow();
  });
});

describe('display integrity', () => {
  it('keeps all 18 decimal SQK places independent of Q128 accrued credit', () => {
    expect(sqkExact(token(1n).claimable)).toBe('0.123456789123456789');
  });
  it('decodes JSON but only admits isolated SVG data images', () => {
    const metadata = (image: string) => 'data:application/json;base64,' + btoa(JSON.stringify({ image }));
    expect(imageFromTokenURI(metadata('data:image/svg+xml;base64,PHN2Zy8+'))).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    expect(imageFromTokenURI(metadata('javascript:alert(1)'))).toBeNull();
    expect(imageFromTokenURI(metadata('https://untrusted.example/image.svg'))).toBeNull();
    expect(imageFromTokenURI('data:application/json;base64,broken')).toBeNull();
  });
});
