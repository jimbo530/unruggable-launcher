/**
 * Neynar Signer Setup — one-time script
 *
 * Creates a managed signer and prints the approval URL.
 * Owner clicks the URL in Warpcast to approve.
 * Once approved, the signer_uuid is saved to .env for social-bot.js.
 *
 * Usage:
 *   node neynar-signer-setup.js
 *
 * Requires NEYNAR_API_KEY in .env
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.NEYNAR_API_KEY;
if (!API_KEY) {
  console.error('Missing NEYNAR_API_KEY in .env');
  process.exit(1);
}

async function createSigner() {
  console.log('Creating Neynar managed signer...\n');

  const res = await fetch('https://api.neynar.com/v2/farcaster/signer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
  });

  const data = await res.json();

  if (!data.signer_uuid) {
    console.error('Failed to create signer:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('Signer created!');
  console.log(`  UUID:   ${data.signer_uuid}`);
  console.log(`  Status: ${data.status}`);
  console.log(`  Public: ${data.public_key}`);
  console.log('');

  if (data.signer_approval_url) {
    console.log('=== APPROVAL REQUIRED ===');
    console.log('Open this URL in Warpcast to approve the signer:');
    console.log('');
    console.log(`  ${data.signer_approval_url}`);
    console.log('');
    console.log('After approving, run this script again with --check to verify.');
  }

  return data;
}

async function checkSigner(uuid) {
  const res = await fetch(`https://api.neynar.com/v2/farcaster/signer?signer_uuid=${uuid}`, {
    headers: { 'x-api-key': API_KEY },
  });
  return await res.json();
}

async function pollUntilApproved(uuid) {
  console.log(`Polling signer ${uuid} for approval...`);
  console.log('(Waiting for you to approve in Warpcast)\n');

  for (let i = 0; i < 60; i++) {
    const data = await checkSigner(uuid);
    console.log(`  [${i + 1}] Status: ${data.status}`);

    if (data.status === 'approved') {
      console.log('\nSigner APPROVED!');
      console.log(`FID: ${data.fid}`);

      // Save to .env
      const envPath = path.join(__dirname, '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      if (envContent.includes('FARCASTER_SIGNER_UUID=')) {
        envContent = envContent.replace(
          /FARCASTER_SIGNER_UUID=.*/,
          `FARCASTER_SIGNER_UUID=${uuid}`
        );
      } else {
        envContent += `\nFARCASTER_SIGNER_UUID=${uuid}\n`;
      }

      fs.writeFileSync(envPath, envContent);
      console.log(`\nSaved FARCASTER_SIGNER_UUID=${uuid} to .env`);
      console.log('social-bot.js is now ready to post to Farcaster!');
      return data;
    }

    if (data.status === 'revoked') {
      console.error('\nSigner was REVOKED. Create a new one.');
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\nTimed out waiting for approval (5 min). Run again with --poll <uuid>');
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--check' && args[1]) {
    const data = await checkSigner(args[1]);
    console.log('Signer status:', JSON.stringify(data, null, 2));
    return;
  }

  if (args[0] === '--poll' && args[1]) {
    await pollUntilApproved(args[1]);
    return;
  }

  const signer = await createSigner();

  if (signer.status !== 'approved') {
    console.log('\nTo poll for approval after clicking the URL:');
    console.log(`  node neynar-signer-setup.js --poll ${signer.signer_uuid}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
