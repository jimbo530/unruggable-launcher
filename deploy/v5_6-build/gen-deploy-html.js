const fs = require('fs');

const bin = fs.readFileSync(__dirname + '/Unruggable2.bin', 'utf8').trim();
const abi = JSON.parse(fs.readFileSync(__dirname + '/Unruggable2.abi', 'utf8'));
const minimal = abi.filter(x => x.type === 'constructor' || ['launchCount','minSeed','owner','reactorImpl','vestingImpl'].includes(x.name));

const html = `<!DOCTYPE html>
<html><head><title>Deploy Unruggable V5.6 Factory</title>
<style>
  body { background:#111; color:#eee; font-family:monospace; padding:20px; max-width:800px; margin:0 auto; }
  h1 { color:#4ade80; }
  h3 { color:#79c0ff; margin-top:24px; }
  button { background:#1a3a1a; color:#4ade80; border:1px solid #4ade80; padding:12px 24px; font-size:16px; cursor:pointer; font-family:monospace; margin:8px 4px; }
  button:hover { background:#2a4a2a; }
  button:disabled { opacity:0.5; cursor:not-allowed; }
  #log { background:#0a0a0a; border:1px solid #333; padding:16px; margin:16px 0; white-space:pre-wrap; font-size:13px; max-height:500px; overflow-y:auto; }
  .ok { color:#4ade80; } .err { color:#f85149; } .info { color:#79c0ff; } .warn { color:#d29922; }
  table { border-collapse:collapse; width:100%; margin:12px 0; }
  td { padding:4px 8px; border:1px solid #333; font-size:12px; }
  td:first-child { color:#79c0ff; white-space:nowrap; }
  td:last-child { color:#d4a853; word-break:break-all; }
  input { background:#0a0a0a; color:#4ade80; border:1px solid #4ade80; padding:6px 10px; font-family:monospace; font-size:12px; width:380px; }
</style>
</head><body>
<h1>Unruggable V5.6 Factory</h1>
<p>V5.6: 20% of token supply goes to burn-proportional VolumeVesting for launcher.<br>
Launcher earns tokens as reactor burns accumulate. Fully vested at 40% supply burned.<br>
All other features from V5.5 preserved (cross-factory referrals, CHAR reactor, MfT walls).</p>

<h3>Constructor Parameters (15)</h3>
<table>
<tr><td>weth</td><td>0x4200000000000000000000000000000000000006</td></tr>
<tr><td>usdc</td><td>0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913</td></tr>
<tr><td>wrappedBtc (cbBTC)</td><td>0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf</td></tr>
<tr><td>mft</td><td>0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3</td></tr>
<tr><td>char</td><td>0x20b048fA035D5763685D695e66aDF62c5D9F5055</td></tr>
<tr><td>v3Factory</td><td>0x33128a8fC17869897dcE68Ed026d694621f6FDfD</td></tr>
<tr><td>positionManager</td><td>0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1</td></tr>
<tr><td>swapRouter</td><td>0x2626664c2603336E57B271c5C0b26F421741e481</td></tr>
<tr><td>reactorImpl</td><td>0x82eC86F4536167A95eF302056162b1c8b9c7F4FA</td></tr>
<tr><td>vestingImpl</td><td><input id="vestingAddr" placeholder="Deploy VolumeVesting first, paste address here"></td></tr>
<tr><td>upstreamReactor (Hub)</td><td>0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045</td></tr>
<tr><td>wethUsdcFee</td><td>500</td></tr>
<tr><td>mftWethFee</td><td>10000</td></tr>
<tr><td>charUsdcFee</td><td>3000</td></tr>
<tr><td>usdcBtcFee</td><td>500</td></tr>
</table>

<button id="connectBtn" onclick="connect()">Connect Wallet</button>
<button id="deployBtn" onclick="deploy()" disabled>Deploy V5.6 Factory</button>
<button id="verifyBtn" onclick="verify()" disabled>Verify on Basescan</button>

<div id="log"></div>

<script type="module">
import { ethers } from "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.min.js";

const ABI = ${JSON.stringify(minimal)};

const BYTECODE = "0x${bin}";

let signer = null;
let deployedAddress = null;

function log(msg, cls) {
  const el = document.getElementById("log");
  if (cls) el.innerHTML += '<span class="' + cls + '">' + msg + '</span>\\n';
  else el.innerHTML += msg + "\\n";
  el.scrollTop = el.scrollHeight;
}

window.connect = async function() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  const addr = await signer.getAddress();
  const net = await provider.getNetwork();
  log('Connected: ' + addr, 'ok');
  log('Chain: ' + net.chainId, 'info');
  if (net.chainId !== 8453n) { log('WARNING: Not on Base mainnet!', 'err'); return; }
  document.getElementById("deployBtn").disabled = false;
};

window.deploy = async function() {
  if (!signer) { log('Connect wallet first', 'err'); return; }
  const vestingImpl = document.getElementById("vestingAddr").value.trim();
  if (!vestingImpl || !vestingImpl.startsWith('0x') || vestingImpl.length !== 42) {
    log('Enter valid vestingImpl address first!', 'err');
    return;
  }
  document.getElementById("deployBtn").disabled = true;
  log('Deploying V5.6 Factory...', 'info');

  const ARGS = [
    "0x4200000000000000000000000000000000000006",
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
    "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    "0x2626664c2603336E57B271c5C0b26F421741e481",
    "0x82eC86F4536167A95eF302056162b1c8b9c7F4FA",
    vestingImpl,
    "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045",
    500, 10000, 3000, 500
  ];

  log('Constructor args: ' + ARGS.length + ' params', 'info');
  log('vestingImpl: ' + vestingImpl, 'info');

  try {
    const factory = new ethers.ContractFactory(ABI, BYTECODE, signer);
    const contract = await factory.deploy(...ARGS);
    log('TX: ' + contract.deploymentTransaction().hash, 'info');
    log('Waiting for confirmation...', 'info');
    await contract.waitForDeployment();
    deployedAddress = await contract.getAddress();
    log('DEPLOYED: ' + deployedAddress, 'ok');

    const impl = await contract.reactorImpl();
    const vest = await contract.vestingImpl();
    const owner = await contract.owner();
    const minSeed = await contract.minSeed();
    log('  reactorImpl: ' + impl, 'info');
    log('  vestingImpl: ' + vest, 'info');
    log('  owner: ' + owner, 'info');
    log('  minSeed: ' + ethers.formatUnits(minSeed, 6) + ' USDC', 'info');

    log('--- POST-DEPLOY STEPS ---', 'warn');
    log('1. Verify on Basescan (click button below)', 'warn');
    log('2. Update project launcher UI factory address', 'warn');
    log('3. Test with $5 USDC launch', 'warn');
    document.getElementById("verifyBtn").disabled = false;
  } catch(e) {
    log('Deploy failed: ' + e.message, 'err');
    document.getElementById("deployBtn").disabled = false;
  }
};

window.verify = async function() {
  if (!deployedAddress) { log('Deploy first', 'err'); return; }
  const vestingImpl = document.getElementById("vestingAddr").value.trim();
  log('To verify on Basescan:', 'info');
  log('1. Go to https://basescan.org/verifyContract?a=' + deployedAddress, 'info');
  log('2. Compiler: v0.8.34+commit.80d5c536', 'info');
  log('3. Optimization: Yes, 200 runs, via IR', 'info');
  log('4. Upload flattened source (MycoPadV5_6.sol + LaunchToken.sol)', 'info');
  log('5. Constructor args ABI-encoded below:', 'info');

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ["address","address","address","address","address","address","address","address","address","address","address","uint24","uint24","uint24","uint24"],
    [
      "0x4200000000000000000000000000000000000006",
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
      "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
      "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
      "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
      "0x2626664c2603336E57B271c5C0b26F421741e481",
      "0x82eC86F4536167A95eF302056162b1c8b9c7F4FA",
      vestingImpl,
      "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045",
      500, 10000, 3000, 500
    ]
  );
  log('Encoded constructor args:\\n' + encoded.slice(2), 'ok');
};
</script>
</body></html>`;

fs.writeFileSync(__dirname + '/../deploy-factory-v5.6.html', html);
console.log('deploy-factory-v5.6.html written (' + html.length + ' bytes)');
