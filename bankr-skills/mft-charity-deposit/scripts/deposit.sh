#!/usr/bin/env bash
# Deposit a stablecoin into a Meme for Trees charity vault via Bankr.
# Builds approve(vault, amount) + deposit(amount) as raw calldata and submits
# both through Bankr's arbitrary-transaction feature. Receipt is minted 1:1.
#
# Usage:
#   ./deposit.sh <vault-key> <amount> [recipient]
#     vault-key : money | gst | ftp   (money = Base/USDC, executable via Bankr)
#     amount    : whole units of the deposit asset (e.g. 25 = $25)
#     recipient : (optional) 0x address to mint the receipt to (uses depositFor)
#
# Examples:
#   ./deposit.sh money 25                 # 25 USDC -> 25 Money for Trees (Base)
#   ./deposit.sh money 5 0xABC...123      # deposit $5, mint Money to 0xABC...123
set -euo pipefail

# ---- Require Bankr CLI ------------------------------------------------------
if ! command -v bankr >/dev/null 2>&1; then
  echo "Bankr CLI not found. Install with: npm install -g @bankr/cli" >&2
  exit 1
fi

VAULT_KEY="${1:-}"
AMOUNT="${2:-}"
RECIPIENT="${3:-}"

usage() {
  cat >&2 <<'EOF'
Usage: ./deposit.sh <vault-key> <amount> [recipient]
  vault-key : money | gst | ftp
  amount    : whole units of the deposit asset (e.g. 25 = $25)
  recipient : optional 0x address to receive the receipt (uses depositFor)

Examples:
  ./deposit.sh money 25
  ./deposit.sh money 5 0xABC...123
EOF
}

if [[ -z "$VAULT_KEY" || -z "$AMOUNT" ]]; then
  usage
  exit 1
fi

# ---- Vault registry (VERIFIED on-chain 2026-07-14; see SKILL.md) -----------
# Fields: vault | asset | chainId | decimals | friendly | executable
case "$(echo "$VAULT_KEY" | tr '[:upper:]' '[:lower:]')" in
  money|mft|mftusd)
    VAULT="0xe3dd3881477c20C17Df080cEec0C1bD0C065A072"
    ASSET="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"   # USDC (Base)
    CHAIN_ID=8453
    DECIMALS=6
    FRIENDLY="Money for Trees"
    EXECUTABLE="yes"
    ;;
  gst)
    VAULT="0x95eD511Dbdd7b52795e1F515314bE8d888Ea4F3F"
    ASSET="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"   # USDG (Robinhood)
    CHAIN_ID=4663
    DECIMALS=6
    FRIENDLY="Grow Some Trees"
    EXECUTABLE="no"
    ;;
  ftp)
    VAULT="0x873739aeD7b49f005965377b5645914b1D78Ccd3"
    ASSET="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"   # USDG (Robinhood)
    CHAIN_ID=4663
    DECIMALS=6
    FRIENDLY="Feed The People"
    EXECUTABLE="no"
    ;;
  *)
    echo "Unknown vault key: '$VAULT_KEY' (expected: money | gst | ftp)" >&2
    usage
    exit 1
    ;;
esac

# ---- Robinhood not reachable via Bankr yet ---------------------------------
if [[ "$EXECUTABLE" != "yes" ]]; then
  echo "The $FRIENDLY vault is on Robinhood Chain (chainId $CHAIN_ID)." >&2
  echo "Bankr does not currently support chain $CHAIN_ID, so this deposit" >&2
  echo "cannot be executed through Bankr yet." >&2
  echo "Vault: $VAULT  (deposit asset USDG $ASSET)" >&2
  echo "See references/robinhood-vaults.md for the manual flow." >&2
  exit 2
fi

# ---- Validate amount --------------------------------------------------------
if ! [[ "$AMOUNT" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Amount must be a positive number (e.g. 25 or 12.5). Got: '$AMOUNT'" >&2
  exit 1
fi

# ---- Convert amount to base units (integer, no floating point) -------------
# amount * 10^decimals, using awk with a printf %.0f to avoid bc dependency.
AMOUNT_BASE=$(awk -v a="$AMOUNT" -v d="$DECIMALS" 'BEGIN { printf "%.0f", a * (10 ^ d) }')
if [[ -z "$AMOUNT_BASE" || "$AMOUNT_BASE" == "0" ]]; then
  echo "Amount too small — resolves to 0 base units at $DECIMALS decimals." >&2
  exit 1
fi

# 64-hex-char (32-byte) left-padded amount
AMOUNT_HEX=$(printf '%064x' "$AMOUNT_BASE")

# ---- Selectors (VERIFIED via keccak) ---------------------------------------
SEL_APPROVE="095ea7b3"        # approve(address,uint256)
SEL_DEPOSIT="b6b55f25"        # deposit(uint256)
SEL_DEPOSITFOR="2f4f21e2"     # depositFor(address,uint256)

# ---- Build approve calldata: approve(vault, amount) ------------------------
VAULT_PADDED=$(printf '%064s' "${VAULT#0x}" | tr ' ' '0')
APPROVE_DATA="0x${SEL_APPROVE}${VAULT_PADDED}${AMOUNT_HEX}"

# ---- Build deposit/depositFor calldata -------------------------------------
if [[ -n "$RECIPIENT" ]]; then
  if ! [[ "$RECIPIENT" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Recipient must be a 0x address (40 hex chars). Got: '$RECIPIENT'" >&2
    exit 1
  fi
  TO_PADDED=$(printf '%064s' "${RECIPIENT#0x}" | tr ' ' '0')
  DEPOSIT_DATA="0x${SEL_DEPOSITFOR}${TO_PADDED}${AMOUNT_HEX}"
  MINT_TO="$RECIPIENT"
else
  DEPOSIT_DATA="0x${SEL_DEPOSIT}${AMOUNT_HEX}"
  MINT_TO="you"
fi

echo ""
echo "Meme for Trees deposit"
echo "  Vault:     $FRIENDLY ($VAULT)"
echo "  Deposit:   $AMOUNT (asset $ASSET, chainId $CHAIN_ID)"
echo "  Receipt to: $MINT_TO"
echo ""

# ---- Step 1: approve --------------------------------------------------------
echo "Step 1/2: approving $AMOUNT to the vault..."
APPROVE_TX="{\"to\": \"$ASSET\", \"data\": \"$APPROVE_DATA\", \"value\": \"0\", \"chainId\": $CHAIN_ID}"
APPROVE_RESULT=$(bankr agent "Submit this transaction: $APPROVE_TX" 2>&1) || {
  echo "  Approve call to Bankr failed:" >&2
  echo "$APPROVE_RESULT" >&2
  exit 1
}
if echo "$APPROVE_RESULT" | grep -q "basescan.org/tx"; then
  APPROVE_HASH=$(echo "$APPROVE_RESULT" | grep -o 'https://basescan.org/tx/[^ "]*' | head -1)
  echo "  Approved: $APPROVE_HASH"
else
  echo "  Approve did not confirm. Bankr response:" >&2
  echo "$APPROVE_RESULT" >&2
  exit 1
fi

# ---- Step 2: deposit --------------------------------------------------------
echo "Step 2/2: depositing..."
DEPOSIT_TX="{\"to\": \"$VAULT\", \"data\": \"$DEPOSIT_DATA\", \"value\": \"0\", \"chainId\": $CHAIN_ID}"
DEPOSIT_RESULT=$(bankr agent "Submit this transaction: $DEPOSIT_TX" 2>&1) || {
  echo "  Deposit call to Bankr failed:" >&2
  echo "$DEPOSIT_RESULT" >&2
  exit 1
}
if echo "$DEPOSIT_RESULT" | grep -q "basescan.org/tx"; then
  DEPOSIT_HASH=$(echo "$DEPOSIT_RESULT" | grep -o 'https://basescan.org/tx/[^ "]*' | head -1)
  echo "  Deposited: $DEPOSIT_HASH"
else
  echo "  Deposit did not confirm. Bankr response:" >&2
  echo "$DEPOSIT_RESULT" >&2
  exit 1
fi

echo ""
echo "Done. You now hold ~$AMOUNT $FRIENDLY receipt tokens (1:1, redeemable)."
