// ============================================================
//  Collect Yield — shared logic for both leaderboards.
//  Scans every fund + LP position, and ONLY fires the ones worth
//  >= 1 tree ($0.10). harvest() and claimV3Position() are both
//  permissionless and pay the position OWNER, so it's safe for
//  anyone to call; batched into Multicall3 txs of <= 20 actions.
//
//  Requires ethers v6 (UMD) loaded first. Exposes:
//    window.collectYieldRun(btnId, statusId)
//    window.collectYieldPending(elId)
// ============================================================
(function () {
  var MC = '0xcA11bde05977b3631167028862bE2a173976CA11';        // Multicall3
  var NFPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';       // Uniswap V3 position manager (Base)
  var A_USDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';     // aUSDC (Base)
  var FUNDS = [
    '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072', // Money (MfT V4)
    '0xEe6fB5f324B05efF95fD59F4574050a891e6913D', // PRGT
    '0xe96fa44b4b82F085a457F9B7a0F85ea26FF1652F', // MfT V1
    '0x85C78B8104D874d17e698b8c5678e3B8072347B1', // MfT V2
  ];
  var THRESHOLD = 100000n;  // $0.10 (6 decimals) = ~1 tree
  var BATCH = 20;           // max actions per tx (gas ceiling)
  var PUBLIC_RPC = 'https://mainnet.base.org';

  var FI = new ethers.Interface([
    'function harvest()',
    'function pendingYield() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function v3PositionCount() view returns (uint256)',
    'function v3Positions(uint256) view returns (uint256)',
    'function claimV3Position(uint256)',
  ]);
  var NFPM_I = new ethers.Interface(['function ownerOf(uint256) view returns (address)']);
  var MCI = new ethers.Interface([
    'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] r)',
  ]);

  // read-only multicall: calls = [{target, callData}] -> [{success, returnData}]
  async function mcRead(provider, calls) {
    if (!calls.length) return [];
    var packed = calls.map(function (c) { return { target: c.target, allowFailure: true, callData: c.callData }; });
    var res = await provider.call({ to: MC, data: MCI.encodeFunctionData('aggregate3', [packed]) });
    return MCI.decodeFunctionResult('aggregate3', res)[0];
  }
  function uint(r) { return (r && r.success && r.returnData && r.returnData !== '0x') ? BigInt(r.returnData) : 0n; }

  // Sum the harvestable pending yield across funds (Money/PRGT via pendingYield()).
  async function totalPending(provider) {
    var res = await mcRead(provider, FUNDS.slice(0, 2).map(function (f) {
      return { target: f, callData: FI.encodeFunctionData('pendingYield', []) };
    }));
    return res.reduce(function (a, r) { return a + uint(r); }, 0n);
  }

  // Scan everything, return the list of calls worth firing (>= THRESHOLD) + a summary.
  async function buildLive(provider) {
    // 1) position counts per fund
    var counts = (await mcRead(provider, FUNDS.map(function (f) {
      return { target: f, callData: FI.encodeFunctionData('v3PositionCount', []) };
    }))).map(uint);

    // 2) enumerate tokenIds
    var posCalls = [], posFund = [];
    FUNDS.forEach(function (f, fi) {
      for (var i = 0n; i < counts[fi]; i++) { posCalls.push({ target: f, callData: FI.encodeFunctionData('v3Positions', [i]) }); posFund.push(f); }
    });
    var posRes = await mcRead(provider, posCalls);
    var positions = posRes.map(function (r, i) { return r.success ? { fund: posFund[i], tid: uint(r) } : null; }).filter(Boolean);

    // 3) owners (claim pays the owner; we measure that owner's balance delta)
    var ownRes = await mcRead(provider, positions.map(function (p) { return { target: NFPM, callData: NFPM_I.encodeFunctionData('ownerOf', [p.tid]) }; }));
    positions.forEach(function (p, i) { p.owner = (ownRes[i] && ownRes[i].success) ? ('0x' + ownRes[i].returnData.slice(-40)) : null; });
    positions = positions.filter(function (p) { return p.owner; });

    // 4) pending yield per fund (Money/PRGT: pendingYield(); V1/V2: aUSDC balance - supply)
    var pyCalls = [];
    FUNDS.forEach(function (f) { pyCalls.push({ target: f, callData: FI.encodeFunctionData('pendingYield', []) }); });
    FUNDS.forEach(function (f) { pyCalls.push({ target: A_USDC, callData: FI.encodeFunctionData('balanceOf', [f]) }); });
    FUNDS.forEach(function (f) { pyCalls.push({ target: f, callData: FI.encodeFunctionData('totalSupply', []) }); });
    var pr = await mcRead(provider, pyCalls);
    var n = FUNDS.length;
    var pending = FUNDS.map(function (f, i) {
      if (pr[i] && pr[i].success) return uint(pr[i]);
      var aus = uint(pr[n + i]), sup = uint(pr[2 * n + i]);
      return aus > sup ? aus - sup : 0n;
    });

    // 5) measure each position's owed via balanceOf-delta around its claim (harvests run first)
    var sim = [], meta = [];
    FUNDS.forEach(function (f) { sim.push({ target: f, callData: FI.encodeFunctionData('harvest', []) }); });
    positions.forEach(function (p) {
      var bIdx = sim.length; sim.push({ target: p.fund, callData: FI.encodeFunctionData('balanceOf', [p.owner]) });
      sim.push({ target: p.fund, callData: FI.encodeFunctionData('claimV3Position', [p.tid]) });
      var aIdx = sim.length; sim.push({ target: p.fund, callData: FI.encodeFunctionData('balanceOf', [p.owner]) });
      meta.push({ p: p, bIdx: bIdx, aIdx: aIdx });
    });
    var sr = await mcRead(provider, sim);

    // 6) collect every candidate worth >= THRESHOLD, with its value
    var candidates = [];  // { call, value, kind }
    FUNDS.forEach(function (f, i) {
      if (pending[i] >= THRESHOLD) candidates.push({ call: { target: f, allowFailure: true, callData: FI.encodeFunctionData('harvest', []) }, value: pending[i], kind: 'harvest' });
    });
    meta.forEach(function (m) {
      var b = sr[m.bIdx], a = sr[m.aIdx];
      if (b && b.success && a && a.success) {
        var owed = uint(a) - uint(b);
        if (owed >= THRESHOLD) candidates.push({ call: { target: m.p.fund, allowFailure: true, callData: FI.encodeFunctionData('claimV3Position', [m.p.tid]) }, value: owed, kind: 'claim' });
      }
    });
    return { candidates: candidates, scanned: positions.length };
  }

  window.collectYieldPending = async function (elId) {
    var el = document.getElementById(elId); if (!el) return;
    try {
      var total = await totalPending(new ethers.JsonRpcProvider(PUBLIC_RPC));
      el.textContent = '$' + (Number(total) / 1e6).toFixed(2) + ' ready';
    } catch (e) { el.textContent = 'unavailable'; }
  };

  window.collectYieldRun = async function (btnId, statusId) {
    var btn = document.getElementById(btnId), status = document.getElementById(statusId);
    if (!window.ethereum) { status.textContent = 'No wallet found — open in a wallet browser (Coinbase Wallet, MetaMask, Rabby).'; return; }
    btn.disabled = true;
    try {
      status.textContent = 'Connecting wallet…';
      var bp = new ethers.BrowserProvider(window.ethereum);
      await bp.send('eth_requestAccounts', []);
      if ((await bp.getNetwork()).chainId !== 8453n) {
        try { await bp.send('wallet_switchEthereumChain', [{ chainId: '0x2105' }]); }
        catch (e) { status.textContent = 'Please switch your wallet to Base.'; btn.disabled = false; return; }
      }
      var signer = await bp.getSigner();

      status.textContent = 'Scanning funds & LP positions…';
      var r = await buildLive(bp);
      if (r.candidates.length === 0) {
        status.textContent = 'Nothing over $0.10 to collect yet (scanned ' + r.scanned + ' positions). Yield is still accruing — check back later.';
        btn.disabled = false; return;
      }
      // Fire the ones over $0.10; if more than 20 qualify, take the 20 LARGEST (one tx, biggest first)
      r.candidates.sort(function (a, b) { return b.value > a.value ? 1 : (b.value < a.value ? -1 : 0); });
      var pick = r.candidates.slice(0, BATCH);
      var remaining = r.candidates.length - pick.length;
      // within the tx, run harvests before claims (so fresh yield is credited first)
      pick.sort(function (a, b) { return (a.kind === 'harvest' ? 0 : 1) - (b.kind === 'harvest' ? 0 : 1); });
      var worth = pick.reduce(function (a, c) { return a + c.value; }, 0n);
      var worthUsd = (Number(worth) / 1e6).toFixed(2);

      status.textContent = 'Collecting the ' + pick.length + ' largest (~$' + worthUsd + ', all over $0.10)… approve in your wallet';
      var tx = await signer.sendTransaction({ to: MC, data: MCI.encodeFunctionData('aggregate3', [pick.map(function (c) { return c.call; })]) });
      status.innerHTML = 'Submitted <a href="https://basescan.org/tx/' + tx.hash + '" target="_blank">' + tx.hash.slice(0, 12) + '…</a> — confirming…';
      await tx.wait();
      var more = remaining > 0 ? ' — ' + remaining + ' more over $0.10 remain, press Collect again to grab them.' : '';
      status.innerHTML = '✓ Collected ~$' + worthUsd + ' (' + pick.length + ' item' + (pick.length > 1 ? 's' : '') + ') — trees funded & LPs paid.' + more + ' <a href="https://basescan.org/tx/' + tx.hash + '" target="_blank">View tx</a>';
      if (document.getElementById('cyPending')) window.collectYieldPending('cyPending');
      if (document.getElementById('pendingYield')) window.collectYieldPending('pendingYield');
    } catch (e) {
      status.textContent = 'Could not collect: ' + ((e && (e.shortMessage || e.message)) || 'error').slice(0, 150);
    } finally { btn.disabled = false; }
  };
})();
