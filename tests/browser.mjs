// Isolated UI validation. Fixture RPC responses and an in-memory test provider exist
// ONLY in this test process, never in src/ or the production export.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { CONTRACTS, RPC_URL, mining, nft, core } from '../src/contracts.ts';

const holder = '0x7f8Cd6A535072AC099623a879cF93cBdAA4F513d';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/preview/')) { response.writeHead(404).end(); return; }
  const path = resolve(root, url.pathname.slice(9) || 'index.html');
  if (!path.startsWith(root + '/')) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;

async function createFixture(browser, account = holder, initial = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const state = { settled: true, changedOwner: false, receipt: 'ok', failReads: false, requests: [], ...initial };
  await context.route(RPC_URL, async route => {
    const body = route.request().postDataJSON();
    state.requests.push(body);
    if (state.failReads) { await route.fulfill({ status: 503, body: 'RPC unavailable in this isolated test' }); return; }
    const send = (result, error) => route.fulfill({ json: { jsonrpc: '2.0', id: body.id, ...(error ? { error } : { result }) } });
    if (body.method === 'eth_chainId') return send('0xaa36a7');
    if (body.method === 'eth_blockNumber') return send('0x100');
    if (body.method === 'eth_getTransactionReceipt') {
      if (state.receipt === 'unavailable') return route.fulfill({ status: 503, body: 'test transport failure' });
      return send({ transactionHash: body.params[0], blockNumber: '0x101', status: state.receipt === 'reverted' ? '0x0' : '0x1' });
    }
    assert.equal(body.method, 'eth_call');
    const tx = body.params[0];
    const abi = tx.to === CONTRACTS.core ? core : tx.to === CONTRACTS.nft ? nft : mining;
    const call = abi.parseTransaction({ data: tx.data });
    const encoded = args => send(abi.encodeFunctionResult(call.name, args));
    switch (call.name) {
      case 'checkpointStatus': return encoded([false, 1974n, state.settled]);
      case 'state': return encoded(abi === core ? [[1974n, 148986n, 13095604188187n, 13095n, 604188187n, 11266n, 1657n, false]] : [[72318400000000000000000000n, 36943987664743512461026129n, 11066000n, 100n, 13095n, 1723n, 235n, 235n, true, 1973n, 148986n, 13095604188187n, 11266n]]);
      case 'ownerOf': {
        const id = call.args[0];
        if (id > 11n) return send(null, { code: 3, message: 'execution reverted', data: '0x' });
        return encoded([id === 11n || state.changedOwner ? CONTRACTS.core : holder]);
      }
      case 'position': return encoded([[1000n, 0n, 0n, 4142n, 1, 100n, 2n ** 128n]]);
      case 'claimable': return encoded([call.args[1].reduce((total, id) => total + id * 1100000000000000000n, 0n)]);
      case 'tokenURI': {
        const id = String(call.args[0]);
        const image = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#f5f4ef"/><text x="20" y="40" fill="#282d26">${id}</text></svg>`).toString('base64');
        return encoded(['data:application/json;base64,' + Buffer.from(JSON.stringify({ image })).toString('base64')]);
      }
      case 'weightForLevel': return encoded([3000n]);
      case 'checkpoint': return state.settled ? send('0x') : send(null, { code: 3, message: 'execution reverted', data: mining.encodeErrorResult('RoundNotSettled', [1974n]) });
      case 'claim': case 'merge': return send('0x');
      default: throw new Error(`Unexpected fixture function: ${call.name}`);
    }
  });
  await context.addInitScript(({ account }) => {
    let connected = false;
    let chain = '0x1';
    const listeners = {};
    window.__walletRequests = [];
    window.ethereum = {
      request: async request => {
        window.__walletRequests.push(request);
        if (request.method === 'eth_accounts') return connected ? [account] : [];
        if (request.method === 'eth_requestAccounts') { connected = true; return [account]; }
        if (request.method === 'eth_chainId') return chain;
        if (request.method === 'wallet_switchEthereumChain') { chain = request.params[0].chainId; listeners.chainChanged?.(chain); return null; }
        if (request.method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
        throw new Error('Unexpected wallet method ' + request.method);
      },
      on: (event, listener) => { listeners[event] = listener; },
      removeListener: event => { delete listeners[event]; },
    };
  }, { account });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByText('Ready to crank', { exact: true }).or(page.getByText('Waiting for settlement', { exact: true })).waitFor();
  return { context, page, state, errors };
}

const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
async function loadSample(page) { await click(page, 'Load Live Sepolia Sample Holder'); await page.getByText('10 verified Squeeks', { exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('#merge button:last-child')?.disabled && !!document.querySelector('[data-testid="survivor"]')); }
async function connect(page) { await click(page, 'Connect wallet'); await click(page, 'Connect browser wallet'); await click(page, 'Switch to Sepolia'); }
async function sendCount(page) { return page.evaluate(() => window.__walletRequests.filter(request => request.method === 'eth_sendTransaction').length); }
async function noOverflow(page, width) {
  await page.setViewportSize({ width, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `overflow at ${width}px`);
}

async function run(browserType, name) {
  const browser = await browserType.launch();
  let count = 0;
  try {
    {
      const { context, page, state, errors } = await createFixture(browser);
      assert.equal(await page.getByRole('button', { name: 'Simulate Checkpoint (eth_call)', exact: true }).isEnabled(), true);
      const action = await page.getByRole('button', { name: 'Simulate Checkpoint (eth_call)', exact: true }).boundingBox();
      assert(action.y + action.height <= 844, 'primary action must fit the first 390px screen');
      await loadSample(page);
      assert.equal(await page.getByRole('button', { name: 'Claim Selected SQK (Send Tx)', exact: true }).isEnabled(), false);
      await page.getByRole('checkbox', { name: 'Select all', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'Select Squeek #2', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Select Squeek #1', exact: true }).check();
      await page.getByText('Sorted IDs: #1, #2. Fraction stays on #1.', { exact: true }).waitFor();
      await click(page, 'Simulate claim');
      await page.locator('#claim .feedback').getByText('Simulation OK. No transaction was sent.', { exact: true }).waitFor();
      const claims = state.requests.filter(r => r.method === 'eth_call' && r.params[0].data.startsWith(mining.getFunction('claim').selector));
      assert.deepEqual(mining.decodeFunctionData('claim', claims.at(-1).params[0].data)[1].map(String), ['1', '2']);
      assert.equal(claims.at(-1).params[0].from, holder);
      assert.equal(await sendCount(page), 0);
      const before = await page.locator('[data-testid="survivor"]').innerText();
      const beforeDonor = await page.locator('[data-testid="donor"]').innerText();
      await click(page, 'Swap survivor & donor');
      const after = await page.locator('[data-testid="survivor"]').innerText();
      const afterDonor = await page.locator('[data-testid="donor"]').innerText();
      assert(before.includes('Squeek #1') && before.includes('1.1 SQK') && beforeDonor.includes('2.2 SQK'));
      assert(after.includes('Squeek #2') && after.includes('2.2 SQK') && afterDonor.includes('Squeek #1') && afterDonor.includes('1.1 SQK'));
      assert((await page.locator('.merge-summary').innerText()).includes('3.3 SQK'));
      await click(page, 'Prepare Merge');
      await page.getByRole('dialog', { name: 'Merge #2 + #1' }).waitFor();
      assert((await page.locator('dialog').innerText()).includes('Token #1 will be BURNED PERMANENTLY'));
      assert.equal(await page.getByRole('button', { name: 'Simulate merge (eth_call)' }).isEnabled(), false);
      assert.equal(await page.getByRole('button', { name: 'Confirm Burn & Send Merge Tx' }).isEnabled(), false);
      await page.getByRole('checkbox', { name: 'I understand that #1 will be permanently burned.' }).check();
      await click(page, 'Simulate merge (eth_call)');
      await page.locator('dialog .feedback').getByText('Simulation OK. No transaction was sent.', { exact: true }).waitFor();
      const audit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(audit.violations.map(v => `${v.id}: ${v.description}`), [], 'modal accessibility audit');
      for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.activeElement === document.querySelector('dialog') || document.querySelector('dialog').contains(document.activeElement)), 'focus must remain inside modal'); }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Prepare Merge' }).evaluate(el => el === document.activeElement), true);
      for (const width of [320, 375, 390, 768, 1440]) await noOverflow(page, width);
      const populatedAudit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(populatedAudit.violations.map(v => `${v.id}: ${v.description}`), [], 'populated accessibility audit');
      assert.deepEqual(errors, []);
      count += 16;
      await context.close();
    }
    {
      const { context, page, state } = await createFixture(browser);
      await loadSample(page);
      await page.locator('.holder-loader > summary').click();
      assert.equal(await page.locator('#token-ids').evaluate(el => getComputedStyle(el).fontSize), '16px', 'mobile inputs must avoid iOS focus zoom');
      await page.getByLabel('Token IDs (optional)').fill('2, 1, 2, 11, 12');
      await click(page, 'Load holder & IDs');
      await page.getByText('2 verified Squeeks', { exact: true }).waitFor();
      const note = await page.locator('#holder-message').innerText();
      assert(note.includes('Duplicate IDs removed: #2'));
      assert(note.includes('unowned IDs: #11, #12'));
      await connect(page);
      await click(page, 'Claim Selected SQK (Send Tx)');
      await page.locator('#claim .feedback').getByText('Transaction confirmed in Sepolia block 257.', { exact: true }).waitFor();
      const walletCalls = await page.evaluate(() => window.__walletRequests);
      const sent = walletCalls.filter(request => request.method === 'eth_sendTransaction');
      assert.equal(sent.length, 1);
      assert(walletCalls.some(request => request.method === 'wallet_switchEthereumChain' && request.params[0].chainId === '0xaa36a7'));
      assert.deepEqual(sent[0].params[0], { from: holder, to: CONTRACTS.mining, data: mining.encodeFunctionData('claim', [0, [1n, 2n]]), value: '0x0' });
      assert(state.requests.some(r => r.method === 'eth_getTransactionReceipt'));
      assert.equal(await page.locator('#claim .tx-link').count(), 1, 'receipt link survives the post-receipt refresh');
      await page.waitForFunction(() => [...document.querySelectorAll('#claim button')].some(button => button.textContent.includes('Claim Selected SQK') && !button.disabled));
      state.changedOwner = true;
      await click(page, 'Claim Selected SQK (Send Tx)');
      await page.locator('#claim .feedback').getByText(/belongs to another holder/).waitFor();
      assert.equal(await sendCount(page), 1, 'ownership change must block a second send');
      count += 9;
      await context.close();
    }
    {
      const { context, page } = await createFixture(browser);
      await loadSample(page); await connect(page);
      await click(page, 'Swap survivor & donor');
      await click(page, 'Prepare Merge');
      assert.equal(await page.getByRole('button', { name: 'Confirm Burn & Send Merge Tx' }).isEnabled(), false);
      await page.getByRole('checkbox', { name: 'I understand that #1 will be permanently burned.' }).check();
      assert.equal(await page.getByRole('button', { name: 'Confirm Burn & Send Merge Tx' }).isEnabled(), false, 'explicit simulation required');
      await click(page, 'Simulate merge (eth_call)');
      await page.locator('dialog .feedback').getByText('Simulation OK. No transaction was sent.', { exact: true }).waitFor();
      await click(page, 'Confirm Burn & Send Merge Tx');
      await page.locator('#merge .feedback').getByText('Transaction confirmed in Sepolia block 257.', { exact: true }).waitFor();
      const sent = await page.evaluate(() => window.__walletRequests.find(request => request.method === 'eth_sendTransaction'));
      assert.deepEqual(mining.decodeFunctionData('merge', sent.params[0].data).map(String), ['0', '2', '1']);
      assert.equal(await page.locator('dialog').count(), 0);
      count += 5;
      await context.close();
    }
    {
      const { context, page, state } = await createFixture(browser, CONTRACTS.nft);
      await connect(page);
      await click(page, 'Simulate Checkpoint (eth_call)');
      await page.locator('#keeper .feedback').getByText('Simulation OK. Ready to advance the round.', { exact: true }).waitFor();
      state.receipt = 'unavailable';
      await click(page, 'Crank Checkpoint (Send Tx)');
      await page.locator('#keeper .feedback').getByText(/its receipt could not be read/).waitFor();
      assert.equal(await sendCount(page), 1);
      assert.equal(await page.getByRole('button', { name: 'Crank Checkpoint (Send Tx)' }).isEnabled(), false);
      state.receipt = 'reverted';
      await click(page, 'Check receipt');
      await page.locator('#keeper .feedback').getByText(/Transaction reverted on-chain/).waitFor();
      assert(!state.requests.some(r => r.method === 'eth_call' && r.params[0].to === CONTRACTS.nft), 'Keeper needs no Squeek reads');
      count += 5;
      await context.close();
    }
    {
      const { context, page } = await createFixture(browser, holder, { settled: false });
      await connect(page);
      assert.equal(await page.getByRole('button', { name: 'Crank Checkpoint (Send Tx)' }).isEnabled(), false);
      await click(page, 'Simulate Checkpoint (eth_call)');
      await page.locator('#keeper .feedback').getByText('RoundNotSettled(1974)', { exact: true }).waitFor();
      assert.equal(await sendCount(page), 0);
      count += 3;
      await context.close();
    }
    console.log(`${name}: ${count} interaction assertions/groups passed; no production RPC interception or wallet stubs are bundled.`);
  } finally { await browser.close(); }
}

try {
  await run(chromium, 'Chromium');
  if (process.env.SKIP_WEBKIT !== '1') await run(webkit, 'WebKit');
} finally { await new Promise(done => server.close(done)); }
