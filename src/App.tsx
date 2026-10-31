import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAddress } from 'ethers';
import { CHAIN_ID, CONTRACTS, mining, type Action, type Squeek, type World } from './contracts';
import { eligiblePairs, integer, parseHolder, parseIds, sameAddress, sortIds, sqk, sqkExact, validateSelection } from './domain';
import { discoverSampleHolder, ensureSepolia, explainError, loadHolder, ownerOf, readClaimable, readContract, readStatus, readWorld, rpc, simulate, verifyClaim, verifyPair, waitForReceipt, type Receipt } from './rpc';

type IconName = 'arrow' | 'refresh' | 'wallet' | 'check' | 'external' | 'swap' | 'close' | 'grid' | 'flame' | 'chevron';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" /></>,
    wallet: <><path d="M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7" /><path d="M20 12h-6v4h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    external: <><path d="M14 3h7v7m0-7L11 13" /><path d="M10 3H3v18h18v-7" /></>,
    swap: <><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    flame: <path d="M12 3c0 6-7 7-7 12a7 7 0 0 0 14 0c0-3-2-5-3-6 0 4-3 5-3 5 2-5-1-8-1-11Z" />,
    chevron: <path d="m8 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Logo() {
  return <svg width="38" height="38" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect width="64" height="64" rx="18" fill="currentColor" /><g stroke="#fffaf5" strokeWidth="3.5" strokeLinecap="round"><path d="M12 43a20 20 0 0 1 40 0M9 49h46M32 21v22M19 28l26 15M45 28 19 43" /></g></svg>;
}

function Modal({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog?.open && !dialog.contains(document.activeElement)) dialog.focus();
  }, [locked]);
  return <dialog ref={ref} tabIndex={-1} className="modal" aria-label={title} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')].filter(control => control.getClientRects().length > 0);
    const first = controls[0]; const last = controls.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === e.currentTarget)) { e.preventDefault(); first.focus(); }
  }} onCancel={e => { e.preventDefault(); if (!locked) onClose(); }} onClick={e => { if (e.target === e.currentTarget && !locked) onClose(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" disabled={locked} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

interface Job { phase: 'idle' | 'busy' | 'ok' | 'error' | 'pending'; message: string; hash?: string; simulated?: boolean }
const idle: Job = { phase: 'idle', message: '' };
function Feedback({ job, onReceipt }: { job: Job; onReceipt: () => void }) {
  return <div className={`feedback ${job.phase}`} role="status" aria-live="polite">
    {job.message && <p>{job.phase === 'ok' && <Icon name="check" size={16} />}{job.message}</p>}
    {job.hash && <a className="tx-link" href={`https://sepolia.etherscan.io/tx/${job.hash}`} target="_blank" rel="noreferrer">View transaction on Etherscan <Icon name="external" size={14} /><span className="hash">{job.hash}</span></a>}
    {job.hash && job.phase === 'pending' && <button className="button small" onClick={onReceipt}>Check receipt</button>}
  </div>;
}

function TokenImage({ token, large = false }: { token: Squeek; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [token.image]);
  return <div className={`token-image ${large ? 'large' : ''}`}>
    {token.image && !failed ? <img src={token.image} alt={`DotGrid image of Squeek #${token.id}`} onError={() => setFailed(true)} /> : <span className="image-missing"><Icon name="grid" size={large ? 32 : 20} />{large && 'Image unavailable'}</span>}
  </div>;
}

function Amount({ value, exact = false }: { value: bigint; exact?: boolean }) {
  const full = sqkExact(value);
  return <span className="amount" title={`${full} SQK`}>{exact ? full : sqk(value)}<span className="unit"> SQK</span></span>;
}

export default function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [worldLoading, setWorldLoading] = useState(true);
  const [worldError, setWorldError] = useState('');
  const [wallet, setWallet] = useState<string | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [holderText, setHolderText] = useState('');
  const [idsText, setIdsText] = useState('');
  const [holder, setHolder] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Squeek[]>([]);
  const [holderBusy, setHolderBusy] = useState(false);
  const [holderError, setHolderError] = useState('');
  const [holderNote, setHolderNote] = useState('');
  const [selectedIds, setSelectedIds] = useState<bigint[]>([]);
  const [batch, setBatch] = useState<{ value?: bigint; error?: string }>({});
  const [pairIndex, setPairIndex] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [pairCredit, setPairCredit] = useState<{ key: string; value: bigint; target: bigint } | null>(null);
  const [pairError, setPairError] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeIntent, setMergeIntent] = useState<{ survivor: Squeek; donor: Squeek } | null>(null);
  const [burnAccepted, setBurnAccepted] = useState(false);
  const [jobs, setJobs] = useState<Record<Action, Job>>({ checkpoint: idle, claim: idle, merge: idle });
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const actionLock = useRef(false);
  const refreshLock = useRef(false);
  const loaderRef = useRef<HTMLDetailsElement>(null);
  const holderInputRef = useRef<HTMLInputElement>(null);
  const idsInputRef = useRef<HTMLInputElement>(null);

  const refreshWorld = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setWorldLoading(true);
    try { setWorld(await readWorld()); setWorldError(''); }
    catch (error) { setWorldError(await explainError(error)); }
    finally { setWorldLoading(false); refreshLock.current = false; }
  }, []);

  useEffect(() => {
    void refreshWorld();
    const interval = setInterval(() => { if (!document.hidden && !actionLock.current) void refreshWorld(); }, 30_000);
    return () => clearInterval(interval);
  }, [refreshWorld]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accountChange = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setWallet(accounts?.[0] ? getAddress(accounts[0]) : null);
      setJobs(current => ({ ...current, claim: { ...current.claim, simulated: false }, merge: { ...current.merge, simulated: false } }));
    };
    const chainChange = (...args: unknown[]) => setChain(String(args[0]).toLowerCase());
    void Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]).then(([accounts, network]) => { accountChange(accounts); chainChange(network); }).catch(() => {});
    provider.on?.('accountsChanged', accountChange);
    provider.on?.('chainChanged', chainChange);
    return () => { provider.removeListener?.('accountsChanged', accountChange); provider.removeListener?.('chainChanged', chainChange); };
  }, []);

  async function connectWallet() {
    if (!window.ethereum) return;
    setWalletBusy(true); setWalletError('');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      if (!accounts[0]) throw new Error('The wallet did not provide an account. Try connecting again.');
      setWallet(getAddress(accounts[0]));
      setChain(String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase());
      setWalletOpen(false);
    } catch (error) { setWalletError(await explainError(error, world?.status)); }
    finally { setWalletBusy(false); }
  }

  async function switchNetwork() {
    if (!window.ethereum) return;
    setWalletBusy(true); setWalletError('');
    try { await ensureSepolia(window.ethereum); setChain(CHAIN_ID); }
    catch (error) { setWalletError(await explainError(error, world?.status)); setWalletOpen(true); }
    finally { setWalletBusy(false); }
  }

  async function inspect(mode: 'typed' | 'sample' | 'wallet') {
    if (holderBusy || actionLock.current) return;
    setHolderError(''); setHolderNote(''); setHolderBusy(true);
    try {
      let address: string;
      let ids: bigint[] | undefined;
      let duplicateNote = '';
      if (mode === 'sample') address = await discoverSampleHolder();
      else if (mode === 'wallet') {
        if (!wallet) throw new Error('Connect a wallet to scan its Squeeks.');
        address = wallet;
      } else {
        if (idsText.trim()) {
          const parsed = parseIds(idsText); ids = parsed.ids;
          if (parsed.duplicates.length) duplicateNote = `Duplicate IDs removed: ${parsed.duplicates.map(id => `#${id}`).join(', ')}. Each ID is included once. `;
        }
        if (holderText.trim()) address = parseHolder(holderText);
        else if (ids?.length) {
          const owner = await ownerOf(ids[0]);
          if (!owner) throw new Error(`Token #${ids[0]} is burned or unminted. Enter a live ID or paste its holder address.`);
          address = owner;
        } else throw new Error('Paste a holder address or enter token IDs to inspect.');
      }
      const loaded = await loadHolder(address, ids);
      setHolder(address); setHolderText(address); setTokens(loaded.tokens);
      setSelectedIds(loaded.tokens.slice(0, 32).map(token => token.id));
      setPairIndex(0); setSwapped(false); setPairCredit(null);
      setJobs(current => ({ ...current, claim: idle, merge: idle }));
      setHolderNote(`${duplicateNote}${loaded.rejected.length ? `Blocked burned, unminted, or unowned IDs: ${loaded.rejected.map(id => `#${id}`).join(', ')}. ` : ''}${ids ? 'Only the requested IDs were checked.' : 'Scanned IDs 1–30. Enter IDs above 30 to check them.'}`);
      if (ids) setIdsText(ids.join(', '));
      if (loaderRef.current) loaderRef.current.open = false;
    } catch (error) {
      setHolderError(await explainError(error, world?.status));
      if (mode === 'typed' && loaderRef.current) { loaderRef.current.open = true; (idsText.trim() ? idsInputRef : holderInputRef).current?.focus(); }
    } finally { setHolderBusy(false); }
  }

  const sortedSelection = useMemo(() => sortIds(selectedIds), [selectedIds]);
  const selectionKey = sortedSelection.join(',');
  const pairs = useMemo(() => eligiblePairs(tokens, world?.core.blockHeight ?? 0n), [tokens, world]);
  const currentPair = pairs[Math.min(pairIndex, pairs.length - 1)];
  const survivor = mergeOpen ? mergeIntent?.survivor : currentPair?.[swapped ? 1 : 0];
  const donor = mergeOpen ? mergeIntent?.donor : currentPair?.[swapped ? 0 : 1];
  const pairKey = currentPair?.map(token => token.id).join(',') ?? '';
  const ownSelection = !!wallet && !!holder && sortedSelection.length > 0 && sortedSelection.every(id => tokens.some(token => token.id === id && sameAddress(token.owner, wallet) && token.position.level > 0));
  const ownPair = !!wallet && !!survivor && !!donor && sameAddress(survivor.owner, wallet) && sameAddress(donor.owner, wallet);
  const locked = !!activeAction || holderBusy;
  const canSend = !!wallet && chain === CHAIN_ID && !worldError && !!world && !locked;
  const pendingTransaction = Object.values(jobs).some(job => job.phase === 'pending');

  useEffect(() => {
    let cancelled = false;
    setBatch({});
    setJobs(current => ({ ...current, claim: current.claim.hash ? current.claim : idle }));
    if (!holder || !sortedSelection.length) return;
    try { validateSelection(tokens, sortedSelection, holder); }
    catch (error) { setBatch({ error: (error as Error).message }); return; }
    void readClaimable(sortedSelection).then(value => { if (!cancelled) setBatch({ value }); }).catch(async error => { const message = await explainError(error); if (!cancelled) setBatch({ error: message }); });
    return () => { cancelled = true; };
  // The key is canonical: selecting out of order always reads one sorted, unique batch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, holder, tokens]);

  useEffect(() => {
    let cancelled = false;
    setPairError(''); setPairCredit(null);
    if (!currentPair) return;
    void Promise.all([
      readClaimable(currentPair.map(token => token.id)),
      readContract(mining, CONTRACTS.mining, 'weightForLevel', [0, currentPair[0].position.level + 1]),
    ]).then(([value, target]) => { if (!cancelled) setPairCredit({ key: pairKey, value, target: target[0] as bigint }); }).catch(async error => { const message = await explainError(error); if (!cancelled) setPairError(message); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey, tokens]);

  function selectToken(id: bigint) {
    if (locked || pendingTransaction) return;
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : sortIds([...current, id]).slice(0, 32));
  }

  function setJob(action: Action, job: Job) { setJobs(current => ({ ...current, [action]: job })); }

  async function prepare(action: Action, owner?: string) {
    if (action === 'checkpoint') {
      const status = await readStatus();
      setWorld(current => current ? { ...current, status } : current);
      return mining.encodeFunctionData('checkpoint');
    }
    if (!holder) throw new Error('Load a holder before simulating.');
    const directOwner = owner ?? holder;
    if (action === 'claim') return verifyClaim(sortedSelection, directOwner);
    if (!mergeOpen || !burnAccepted || !survivor || !donor) throw new Error('Open Prepare Merge and confirm the permanent donor burn first.');
    return verifyPair(survivor.id, donor.id, directOwner, survivor.position.level);
  }

  async function simulateAction(action: Action) {
    if (actionLock.current) return;
    actionLock.current = true; setActiveAction(action);
    setJob(action, { phase: 'busy', message: 'Verifying live Sepolia state and simulating…' });
    try {
      const data = await prepare(action);
      await simulate(data, action === 'checkpoint' ? wallet ?? undefined : holder ?? undefined);
      setJob(action, { phase: 'ok', message: action === 'checkpoint' ? 'Simulation OK. Ready to advance the round.' : 'Simulation OK. No transaction was sent.', simulated: true });
    } catch (error) { setJob(action, { phase: 'error', message: await explainError(error, world?.status) }); }
    finally { actionLock.current = false; setActiveAction(null); }
  }

  async function refreshAfterReceipt() {
    await refreshWorld();
    if (holder) {
      try {
        const loaded = await loadHolder(holder, tokens.map(token => token.id));
        setTokens(loaded.tokens);
        setSelectedIds(current => current.filter(id => loaded.tokens.some(token => token.id === id)));
      } catch (error) { setHolderError(await explainError(error)); }
    }
  }

  async function reloadHolder() {
    if (!holder || holderBusy || actionLock.current) return;
    setHolderBusy(true); setHolderError('');
    try {
      const loaded = await loadHolder(holder, tokens.map(token => token.id));
      setTokens(loaded.tokens);
      setSelectedIds(current => current.filter(id => loaded.tokens.some(token => token.id === id)));
      setHolderNote(loaded.rejected.length ? `No longer live or owned by this holder: ${loaded.rejected.map(id => `#${id}`).join(', ')}. Use the loader to scan other IDs.` : 'Reloaded the inspected IDs from Sepolia. Use the holder loader to scan other IDs.');
      await refreshWorld();
    } catch (error) { setHolderError(await explainError(error)); }
    finally { setHolderBusy(false); }
  }

  async function finishReceipt(action: Action, hash: string, receipt: Receipt | null) {
    if (!receipt) { setJob(action, { phase: 'pending', message: 'Still awaiting a Sepolia receipt. Check Etherscan or check the receipt again.', hash }); return; }
    const success = receipt.status === '0x1';
    setJob(action, { phase: success ? 'ok' : 'error', message: success ? `Transaction confirmed in Sepolia block ${BigInt(receipt.blockNumber)}.` : 'Transaction reverted on-chain. Sepolia gas was spent; no action completed.', hash });
    if (success && action === 'merge') { setMergeOpen(false); setBurnAccepted(false); }
    await refreshAfterReceipt();
  }

  async function sendAction(action: Action) {
    if (actionLock.current || pendingTransaction || !window.ethereum || !wallet) return;
    if (action === 'merge' && (!mergeOpen || !burnAccepted || !jobs.merge.simulated)) return;
    actionLock.current = true; setActiveAction(action);
    let hash: string | undefined;
    setJob(action, { phase: 'busy', message: 'Checking the wallet network and re-verifying the transaction…' });
    try {
      const provider = window.ethereum;
      await ensureSepolia(provider); setChain(CHAIN_ID);
      const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
      if (!sameAddress(accounts[0], wallet)) throw new Error('The wallet account changed. Reconnect and review the selection.');
      const data = await prepare(action, wallet);
      if (action === 'checkpoint') {
        const status = await readStatus();
        if (status.corePaused) throw new Error('CorePaused(): the Core is paused. No transaction was sent.');
        if (!status.roundSettled) throw new Error(`RoundNotSettled(${status.nextRound}): sending now would revert and waste gas. No transaction was sent.`);
      }
      await simulate(data, wallet);
      await ensureSepolia(provider);
      const finalAccounts = await provider.request({ method: 'eth_accounts' }) as string[];
      if (!sameAddress(finalAccounts[0], wallet)) throw new Error('The wallet account changed. Review and simulate again.');
      setJob(action, { phase: 'busy', message: 'Simulation passed. Confirm the transaction in your wallet.' });
      const result = await provider.request({ method: 'eth_sendTransaction', params: [{ from: wallet, to: CONTRACTS.mining, data, value: '0x0' }] });
      if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(result)) throw new Error('The wallet did not return a transaction hash. Check wallet activity before trying again.');
      hash = result;
      setJob(action, { phase: 'pending', message: 'Transaction submitted. Waiting for a real Sepolia receipt…', hash });
      await finishReceipt(action, hash, await waitForReceipt(hash));
    } catch (error) {
      setJob(action, { phase: hash ? 'pending' : 'error', message: hash ? 'The transaction was submitted, but its receipt could not be read. Check Etherscan or check the receipt again.' : await explainError(error, world?.status), hash });
    } finally { actionLock.current = false; setActiveAction(null); }
  }

  async function checkReceipt(action: Action) {
    const hash = jobs[action].hash;
    if (!hash || actionLock.current) return;
    actionLock.current = true; setActiveAction(action);
    try { await finishReceipt(action, hash, await rpc<Receipt | null>('eth_getTransactionReceipt', [hash])); }
    catch { setJob(action, { phase: 'pending', message: 'The Sepolia receipt is unavailable. Check Etherscan or retry.', hash }); }
    finally { actionLock.current = false; setActiveAction(null); }
  }

  const status = world?.status;
  const waiting = world ? world.mining.weightActivationCount - world.mining.weightActivationCursor : null;
  const feedback = (action: Action) => <Feedback job={jobs[action]} onReceipt={() => void checkReceipt(action)} />;

  return <>
    <a className="skip-link" href="#keeper">Skip to workbench</a>
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand-row">
          <a className="brand" href="#" aria-label="Squeek Dome home"><Logo /><span>Squeek<span className="brand-light"> Dome</span></span></a>
          <nav className="section-nav" aria-label="Workbench panels"><a href="#keeper">Keeper</a><a href="#claim">Claim</a><a href="#merge">Merge</a></nav>
          <div className="wallet-controls"><span className="network"><span className="network-dot" />Sepolia</span><button className="button dark" disabled={walletBusy || !!activeAction} onClick={() => wallet && chain !== CHAIN_ID ? void switchNetwork() : setWalletOpen(true)}><Icon name="wallet" />{walletBusy ? 'Opening wallet…' : wallet ? chain !== CHAIN_ID ? 'Switch to Sepolia' : `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button></div>
        </div>
        <div className="holder-toolbar">
          <details className="holder-loader" ref={loaderRef}>
            <summary><Icon name="grid" /><span>{holder ? 'Change inspected holder' : 'Inspect a holder'}</span><Icon name="chevron" size={14} /></summary>
            <form className="loader-form" onSubmit={e => { e.preventDefault(); void inspect('typed'); }}>
              <p>Paste a holder address to scan IDs 1–30, or enter up to 32 specific IDs. Without an address, the first ID determines the holder.</p>
              <label htmlFor="holder-address">Holder address<input id="holder-address" ref={holderInputRef} value={holderText} onChange={e => setHolderText(e.target.value)} placeholder="0x…" autoComplete="off" name="holder" spellCheck={false} disabled={locked || pendingTransaction} aria-invalid={!!holderError} aria-describedby="holder-message" /></label>
              <label htmlFor="token-ids">Token IDs <span className="muted">(optional)</span><input id="token-ids" ref={idsInputRef} value={idsText} onChange={e => setIdsText(e.target.value)} placeholder="1, 2, 3" inputMode="text" autoComplete="off" name="tokenIds" disabled={locked || pendingTransaction} aria-invalid={!!holderError} aria-describedby="holder-message" /></label>
              <div className="button-row"><button type="submit" className="button primary" disabled={locked || pendingTransaction}>{holderBusy ? 'Reading Sepolia…' : 'Load holder & IDs'}<Icon name="arrow" /></button>{wallet && <button type="button" className="button" onClick={() => void inspect('wallet')} disabled={locked || pendingTransaction}>Scan connected wallet</button>}</div>
            </form>
          </details>
          <button className="button sample-button" disabled={locked || pendingTransaction} onClick={() => void inspect('sample')}><Icon name={holderBusy ? 'refresh' : 'arrow'} />{holderBusy ? 'Loading live holder…' : 'Load Live Sepolia Sample Holder'}</button>
          <span className="inspect-tag"><span>{holder && sameAddress(holder, wallet) ? 'Owner mode' : 'Inspect Mode'}</span><span className="subtle-dot" /><span>{holder ? `${tokens.length} verified Squeeks` : 'No wallet needed'}</span></span>
        </div>
        <div id="holder-message" className="holder-message" role="status">{holderError && <p className="error-text">{holderError}</p>}{holderNote && <p>{holderNote}</p>}</div>
      </div>
    </header>

    <main className="workbench">
      <div className="intro"><div><h1>Your Squeek workbench.</h1><p>Crank checkpoints. Claim SQK. Give Squeeks room to grow.</p></div><p className="testnet-note"><span className="status-dot testnet-symbol" aria-hidden="true" /> Sepolia testnet only.<br /> Testnet assets have no value.</p></div>

      <section id="keeper" className="panel keeper-panel" aria-labelledby="keeper-title">
        <div className="keeper-main">
          <div className="section-heading"><div className="section-title"><span className="step-number">01</span><h2 id="keeper-title">Keeper Crank</h2></div><span className={`status-label ${status ? status.corePaused ? 'warning' : status.roundSettled ? 'ready' : 'neutral' : 'neutral'}`}><span className="status-dot" />{!status ? 'Reading Sepolia' : status.corePaused ? 'Core paused' : status.roundSettled ? 'Ready to crank' : 'Waiting for settlement'}</span></div>
          <p className="panel-description">A public good. Anyone can advance a settled round.</p>
          <div className="round-display"><div><span className="data-label">Mining processed round</span><strong>{world ? integer(world.mining.processedThroughRound) : '…'}</strong></div><Icon name="arrow" size={28} /><div><span className="data-label">Core settled frontier</span><strong>{world ? integer(world.core.settledThroughRound) : '…'}</strong></div></div>
          <div className="keeper-actions"><button className="button primary" disabled={locked || pendingTransaction} onClick={() => void simulateAction('checkpoint')}>{activeAction === 'checkpoint' ? 'Checking Sepolia…' : 'Simulate Checkpoint (eth_call)'}<Icon name="arrow" /></button><button className="button" disabled={!canSend || pendingTransaction || !status?.roundSettled || status.corePaused} onClick={() => void sendAction('checkpoint')}>Crank Checkpoint (Send Tx)</button></div>
          <p className={`action-note ${status && !status.roundSettled ? 'caution' : ''}`}>{status?.corePaused ? 'The Core is paused. Simulation remains available; sending is disabled.' : status && !status.roundSettled ? `Sending now would revert with RoundNotSettled(${status.nextRound}) and waste gas. You can still simulate.` : 'Cranking pays Sepolia gas and earns no caller reward. No Squeeks required.'}</p>
          {!wallet && <p className="muted small-text">Connect a wallet to send when a round is ready.</p>}
          {worldError && <div className="error-block" role="alert"><p>{worldError}{world && ' Displayed state may be stale; sending is disabled.'}</p><button className="button small" onClick={() => void refreshWorld()}>Retry Sepolia reads</button></div>}
          {feedback('checkpoint')}
        </div>
        <aside className="chain-state" aria-label="Live Sepolia mining state">
          <div className="state-head"><h3>From the chain</h3><button className="icon-button" aria-label="Refresh Sepolia state" disabled={worldLoading || !!activeAction} onClick={() => void refreshWorld()}><Icon name="refresh" /></button></div>
          <dl className="state-list">
            <div><dt>Next round</dt><dd>{status ? integer(status.nextRound) : '…'}</dd></div>
            <div><dt>Round settled</dt><dd>{status ? String(status.roundSettled) : '…'}</dd></div>
            <div><dt>Core paused</dt><dd>{status ? String(status.corePaused) : '…'}</dd></div>
            <div><dt>Squeek block height</dt><dd>{world ? integer(world.core.blockHeight) : '…'}</dd></div>
            <div><dt>Mining closed block</dt><dd>{world ? integer(world.mining.closedThroughBlock) : '…'}</dd></div>
            <div><dt>Total active weight</dt><dd>{world ? integer(world.mining.totalWeight) : '…'}</dd></div>
            <div><dt>Minted SQK</dt><dd>{world ? <Amount value={world.mining.minted} /> : '…'}</dd></div>
            <div><dt>Paid SQK</dt><dd>{world ? <Amount value={world.mining.paid} /> : '…'}</dd></div>
          </dl>
          <p className="state-source"><span className={`status-dot ${world && !worldError ? 'live-dot' : ''}`} />{world ? `RPC read at ${new Date(world.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : 'Connecting to public RPC'}<br />5,600 SQK per Squeek block</p>
        </aside>
        <div className="activation-section"><details><summary>Waiting weight activations <span className="count">{waiting === null ? '…' : integer(waiting)}</span><Icon name="chevron" size={14} /></summary><div className="activation-content">{!world ? <p>Waiting for Sepolia state.</p> : world.activations.length ? <><p>Showing {world.activations.length} of {integer(waiting!)} waiting activations.</p><ul className="activation-list">{world.activations.map(activation => <li key={String(activation.index)}><span>Queue #{String(activation.index)}</span><span>Round {integer(activation.round)}</span><strong>+{integer(activation.addedWeight)} weight</strong></li>)}</ul></> : <p>No activations are waiting. The queue is clear.</p>}</div></details></div>
      </section>

      <section id="claim" className="panel claim-panel" aria-labelledby="claim-title">
        <div className="section-heading"><div className="section-title"><span className="step-number">02</span><h2 id="claim-title">Batch Claimer</h2></div><span className="muted small-text">Collection 0 · Up to 32 Squeeks</span></div>
        <p className="panel-description">Gather the SQK your Squeeks have earned. One sorted batch.</p>
        {holder && <div className="holder-address"><span className="data-label">{sameAddress(holder, wallet) ? 'Connected owner' : 'Inspecting holder'}</span><a href={`https://sepolia.etherscan.io/address/${holder}`} target="_blank" rel="noreferrer">{holder}<Icon name="external" size={14} /></a></div>}
        {holderBusy ? <div className="empty-state" role="status"><Icon name="refresh" size={28} /><h3>Reading live Squeeks…</h3><p>Checking owners, positions, claimable SQK, and images on Sepolia.</p></div> : !tokens.length ? <div className="empty-state"><div className="empty-icon"><Icon name="grid" size={28} /></div><h3>{holder ? 'No live Squeeks in this scan.' : 'Meet your Squeeks.'}</h3><p>{holder ? 'IDs 1–30 may not include this holder’s Squeeks. Enter specific token IDs in the holder loader.' : 'Load a holder above to see live positions, or explore a sample holder without connecting.'}</p><button className="button" disabled={locked || pendingTransaction} onClick={() => { if (loaderRef.current) loaderRef.current.open = true; holderInputRef.current?.focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }}>Enter holder or IDs<Icon name="arrow" /></button></div> : <>
          <div className="selection-toolbar"><label className="check-label"><input type="checkbox" checked={sortedSelection.length === tokens.length} onChange={e => setSelectedIds(e.target.checked ? tokens.slice(0, 32).map(token => token.id) : [])} disabled={locked || pendingTransaction} />Select all</label><span>{sortedSelection.length} of {tokens.length} selected</span><button className="text-button" disabled={locked || pendingTransaction} onClick={() => void reloadHolder()}>Reload holder<Icon name="refresh" size={14} /></button></div>
          <table className="token-table"><caption className="sr-only">RPC verified Squeek positions and unclaimed SQK</caption><thead><tr><th scope="col">Squeek</th><th scope="col">Level</th><th scope="col">Active weight</th><th scope="col">Pending weight / round</th><th scope="col">Next merge block</th><th scope="col">Unclaimed SQK</th></tr></thead><tbody>{tokens.map(token => <tr key={String(token.id)} className={sortedSelection.includes(token.id) ? 'selected' : ''}>
            <td className="token-cell"><label className="token-selector"><input type="checkbox" checked={sortedSelection.includes(token.id)} onChange={() => selectToken(token.id)} aria-label={`Select Squeek #${token.id}`} disabled={locked || pendingTransaction || (!sortedSelection.includes(token.id) && sortedSelection.length >= 32)} /><TokenImage token={token} /><span><strong>#{String(token.id)}</strong>{sortedSelection[0] === token.id && <span className="fraction-badge">Keeps fraction</span>}</span></label></td>
            <td data-label="Level"><span className="level-value">{token.position.level}</span></td><td data-label="Active weight">{integer(token.position.activeWeight)}</td><td data-label="Pending weight / round">{token.position.pendingRound === 0n ? <span className="muted">None</span> : `${integer(token.position.pendingWeight)} / ${integer(token.position.pendingRound)}`}</td><td data-label="Next merge block">{integer(token.position.nextMergeBlock)}</td><td data-label="Unclaimed SQK"><span className="exact-amount">{sqkExact(token.claimable)}</span></td>
          </tr>)}</tbody></table>
          <div className="claim-summary"><div><span className="data-label">Selected batch claimable</span><strong className="batch-amount">{batch.value !== undefined ? <Amount value={batch.value} exact /> : sortedSelection.length ? batch.error ? 'Unavailable' : 'Reading…' : 'Select a Squeek'}</strong><p className="muted small-text">{sortedSelection.length ? `Sorted IDs: ${sortedSelection.map(id => `#${id}`).join(', ')}. Fraction stays on #${sortedSelection[0]}.` : 'Select 1–32 Squeeks to simulate a claim.'}</p></div><div className="claim-actions"><button className="button" disabled={locked || pendingTransaction || !sortedSelection.length || batch.value === undefined} onClick={() => void simulateAction('claim')}>Simulate claim</button><button className="button primary" disabled={!canSend || pendingTransaction || !ownSelection || batch.value === undefined} onClick={() => void sendAction('claim')}>Claim Selected SQK (Send Tx)<Icon name="arrow" /></button></div></div>
          {!ownSelection && <p className="action-note">Inspect Mode: simulations use the holder address. Connect the direct owner of every selected ID to send a claim.</p>}
          {batch.error && <p className="error-text" role="alert">{batch.error}</p>}
        </>}
        {feedback('claim')}
      </section>

      <section id="merge" className="panel merge-panel" aria-labelledby="merge-title">
        <div className="section-heading"><div className="section-title"><span className="step-number">03</span><h2 id="merge-title">Merge Arena</h2></div><span className="merge-warning"><Icon name="flame" size={16} />A permanent decision</span></div>
        <p className="panel-description">Two at the same level. One stronger Squeek.</p>
        {!survivor || !donor ? <div className="merge-empty"><div className="empty-pair" aria-hidden="true"><Icon name="grid" size={32} /><span>+</span><Icon name="grid" size={32} /></div><div><h3>{holder ? 'No eligible pair in this holder.' : 'Find a pair with potential.'}</h3><p>Load two Squeeks at the same level (1–9), with no pending round and both merge cooldowns complete.</p><p className="muted small-text">Eligibility uses the Core’s Squeek block height, not the Ethereum block number.</p></div></div> : <>
          <div className="arena-controls"><label htmlFor="merge-pair">Eligible pair<select id="merge-pair" value={Math.min(pairIndex, pairs.length - 1)} disabled={locked || pendingTransaction} onChange={e => { setPairIndex(Number(e.target.value)); setSwapped(false); setBurnAccepted(false); setJobs(current => ({ ...current, merge: idle })); }}>{pairs.map(([a, b], index) => <option value={index} key={`${a.id},${b.id}`}>#{String(a.id)} + #{String(b.id)} · Level {a.position.level}</option>)}</select></label><button className="button" disabled={locked || pendingTransaction} onClick={() => { setSwapped(current => !current); setBurnAccepted(false); setJobs(current => ({ ...current, merge: idle })); }}><Icon name="swap" />Swap survivor & donor</button></div>
          <div className="arena" data-testid="arena">
            <ArenaCard token={survivor} role="Survivor" target={pairCredit?.key === pairKey ? pairCredit.target : undefined} />
            <div className="arena-join" aria-hidden="true"><Icon name="arrow" size={24} /></div>
            <ArenaCard token={donor} role="Donor" />
          </div>
          <div className="merge-summary"><div><span className="data-label">Combined unclaimed credit</span><strong className="batch-amount">{pairCredit?.key === pairKey ? <Amount value={pairCredit.value} exact /> : pairError ? 'Unavailable' : 'Reading…'}</strong><p className="muted small-text">#{String(survivor.id)} keeps its image and inherits both credits.</p></div><button className="button dark" disabled={locked || pendingTransaction || !pairCredit || !!pairError || !!worldError} onClick={() => { setMergeIntent({ survivor, donor }); setBurnAccepted(false); setJob('merge', idle); setMergeOpen(true); }}>Prepare Merge<Icon name="arrow" /></button></div>
          {pairError && <p className="error-text" role="alert">{pairError} Reload the holder to retry.</p>}
          {!ownPair && <p className="action-note">Inspect Mode: review and simulate this merge. Only the direct owner of both Squeeks can send.</p>}
        </>}
        {feedback('merge')}
      </section>

      <footer className="footer"><div className="footer-brand"><Logo /><span>Small Squeeks. Real chain.</span></div><details className="contract-details"><summary>Contracts & read source<Icon name="chevron" size={14} /></summary><div><p>Sepolia · Chain 11155111 · Collection 0</p>{Object.entries(CONTRACTS).map(([name, address]) => <p key={name}><span>{name === 'dotGrid' ? 'DotGrid (tokenURI only)' : name}</span><a href={`https://sepolia.etherscan.io/address/${address}`} target="_blank" rel="noreferrer">{address}</a></p>)}<p>All reads use <a href={RPC_URL_FOR_LINK}>ethereum-sepolia-rpc.publicnode.com</a>. Minting is paused.</p></div></details><a href="https://github.com/0xtakoyaki22/squeek-dome" target="_blank" rel="noreferrer">Protocol brief<Icon name="external" size={14} /></a></footer>
    </main>

    {walletOpen && <Modal title={wallet ? 'Connected wallet' : 'Connect a wallet'} onClose={() => setWalletOpen(false)} locked={walletBusy}><p className="modal-description">{wallet ? 'Transactions are signed by this wallet. Holder inspection can use any address.' : 'Use a browser wallet to sign real Sepolia transactions. Inspecting and simulating need no wallet.'}</p>{wallet ? <><p className="full-address">{wallet}</p>{chain !== CHAIN_ID && <button className="button primary full-width" onClick={() => void switchNetwork()} disabled={walletBusy}>Switch to Sepolia</button>}<button className="button full-width" onClick={() => { setWallet(null); setChain(null); setWalletOpen(false); }} disabled={walletBusy}>Disconnect from this page</button></> : window.ethereum ? <button className="button dark full-width" disabled={walletBusy} onClick={() => void connectWallet()}><Icon name="wallet" />{walletBusy ? 'Waiting for wallet…' : 'Connect browser wallet'}</button> : <div className="wallet-guidance"><Icon name="wallet" size={28} /><h3>No browser wallet found.</h3><p>Open this page in your wallet’s own browser, or enable a browser wallet extension, then reload.</p><button className="button" onClick={() => window.location.reload()}>Reload wallet connection</button></div>}{walletError && <p className="error-text" role="alert">{walletError}</p>}<p className="small-text muted">Sepolia only. Testnet assets have no value. Never share a seed phrase or private key.</p></Modal>}

    {mergeOpen && survivor && donor && <Modal title={`Merge #${survivor.id} + #${donor.id}`} onClose={() => { setMergeOpen(false); setBurnAccepted(false); }} locked={!!activeAction}><div className="burn-banner"><Icon name="flame" size={24} /><strong>Token #{String(donor.id)} will be BURNED PERMANENTLY and cannot be restored.</strong></div><p className="modal-description"><strong>Token #{String(survivor.id)} will advance to Level {survivor.position.level + 1}, keep its ID/image, and inherit both credits.</strong></p><div className="modal-pair"><span>Survivor<strong>#{String(survivor.id)}</strong></span><Icon name="arrow" /><span>Donor<strong>#{String(donor.id)}</strong></span></div><label className="burn-checkbox"><input type="checkbox" checked={burnAccepted} disabled={!!activeAction} onChange={e => { setBurnAccepted(e.target.checked); setJob('merge', idle); }} /><span>I understand that #{String(donor.id)} will be permanently burned.</span></label><div className="modal-actions"><button className="button full-width" disabled={!burnAccepted || locked || pendingTransaction} onClick={() => void simulateAction('merge')}>Simulate merge (eth_call)</button><button className="button danger full-width" disabled={!burnAccepted || !jobs.merge.simulated || !canSend || pendingTransaction || !ownPair} onClick={() => void sendAction('merge')}>Confirm Burn & Send Merge Tx<Icon name="flame" /></button></div>{!ownPair && <p className="small-text muted">Connect the direct owner of both IDs to enable sending.</p>}{feedback('merge')}</Modal>}
  </>;
}

const RPC_URL_FOR_LINK = 'https://ethereum-sepolia-rpc.publicnode.com';

function ArenaCard({ token, role, target }: { token: Squeek; role: 'Survivor' | 'Donor'; target?: bigint }) {
  return <article className={`arena-card ${role.toLowerCase()}`} data-testid={role.toLowerCase()}><div className="arena-card-head"><h3>{role}</h3><span className="small-text muted">{role === 'Survivor' ? 'Keeps ID & image' : 'Burned on merge'}</span></div><div className="arena-card-body"><TokenImage key={String(token.id)} token={token} large /><div className="arena-token-data"><strong className="arena-token-id">Squeek #{String(token.id)}</strong><dl><div><dt>Level</dt><dd>{token.position.level}{role === 'Survivor' && <span className="level-target"> → {token.position.level + 1}</span>}</dd></div><div><dt>Active weight</dt><dd>{integer(token.position.activeWeight)}</dd></div><div><dt>Next merge block</dt><dd>{integer(token.position.nextMergeBlock)}</dd></div>{role === 'Survivor' && <div><dt>Next-level weight</dt><dd>{target === undefined ? '…' : integer(target)}</dd></div>}</dl><span className="card-credit"><Amount value={token.claimable} exact /></span><span className="muted small-text">unclaimed credit</span></div></div></article>;
}
