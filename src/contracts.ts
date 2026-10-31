import { Interface } from 'ethers';

export const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
export const CHAIN_ID = '0xaa36a7';
export const CONTRACTS = {
  core: '0x74665dAecA35A2303e767E76a2FF1FB6F93e119f',
  mining: '0x3beE588fC20dE788Bac17d33b41Da7346cb27EC4',
  nft: '0x0eAF3E0d40A0a8E5a6Ac030b2459E9FB0B7905c6',
  dotGrid: '0x2dC7661D172fEf0FC900E0aD0f4ffCE68E8bfD75',
} as const;

export const mining = new Interface([
  'function checkpoint()',
  'function checkpointStatus() view returns (bool corePaused, uint64 nextRound, bool roundSettled)',
  'function state() view returns (tuple(uint256 minted, uint256 paid, uint256 totalWeight, uint256 rewardIndex, uint64 closedThroughBlock, uint64 lastActivationRound, uint256 weightActivationCursor, uint256 weightActivationCount, bool bootstrapped, uint64 processedThroughRound, uint64 closedCumulativeWork, uint96 closedCumulativeBlockUnits, uint32 closedWorkPerThousandBlocks))',
  'function weightActivation(uint256 index) view returns (tuple(uint64 round, uint192 addedWeight))',
  'function position(uint8 collection, uint256 tokenId) view returns (tuple(uint64 activeWeight, uint64 pendingWeight, uint40 pendingRound, uint48 nextMergeBlock, uint8 level, uint256 lastIndex, uint256 accruedScaled))',
  'function claimable(uint8 collection, uint256[] tokenIds) view returns (uint256)',
  'function claim(uint8 collection, uint256[] tokenIds)',
  'function merge(uint8 collection, uint256 survivorId, uint256 donorId)',
  'function weightForLevel(uint8 collection, uint8 level) view returns (uint64)',
  'error RoundNotSettled(uint64 round)',
  'error CorePaused()',
  'error InvalidClaim()',
  'error InvalidPosition()',
  'error InvalidMerge()',
  'error Unauthorized()',
]);

export const core = new Interface([
  'function state() view returns (tuple(uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))',
]);

export const nft = new Interface([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
]);

export interface CheckpointStatus {
  corePaused: boolean;
  nextRound: bigint;
  roundSettled: boolean;
}

export interface MiningState {
  minted: bigint;
  paid: bigint;
  totalWeight: bigint;
  rewardIndex: bigint;
  closedThroughBlock: bigint;
  lastActivationRound: bigint;
  weightActivationCursor: bigint;
  weightActivationCount: bigint;
  bootstrapped: boolean;
  processedThroughRound: bigint;
  closedCumulativeWork: bigint;
  closedCumulativeBlockUnits: bigint;
  closedWorkPerThousandBlocks: bigint;
}

export interface CoreState {
  settledThroughRound: bigint;
  cumulativeWork: bigint;
  cumulativeBlockUnits: bigint;
  blockHeight: bigint;
  blockProgress: bigint;
  workPerThousandBlocks: bigint;
  authorizationNonce: bigint;
  paused: boolean;
}

export interface Position {
  activeWeight: bigint;
  pendingWeight: bigint;
  pendingRound: bigint;
  nextMergeBlock: bigint;
  level: number;
  lastIndex: bigint;
  accruedScaled: bigint;
}

export interface Squeek {
  id: bigint;
  owner: string;
  position: Position;
  claimable: bigint;
  image: string | null;
}

export interface World {
  status: CheckpointStatus;
  mining: MiningState;
  core: CoreState;
  activations: { index: bigint; round: bigint; addedWeight: bigint }[];
  blockTag: string;
  readAt: number;
}

export type Action = 'checkpoint' | 'claim' | 'merge';
export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
declare global { interface Window { ethereum?: EthereumProvider } }
