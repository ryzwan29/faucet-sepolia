/**
 * faucet.js — Blockchain integration for the Sepolia ETH Faucet
 * Uses ethers.js v6 to send ETH from the faucet wallet.
 */

'use strict';

const { ethers } = require('ethers');

// Read env lazily — dotenv loads in server.js before any function is called
function getRpcUrl()    { return process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'; }
function getPrivKey()   { return process.env.FAUCET_PRIVATE_KEY; }
function getFaucetAddr(){ return process.env.FAUCET_ADDRESS; }
function getClaimAmt()  { return parseFloat(process.env.CLAIM_AMOUNT_ETH || '0.1'); }

/* ─── Provider & Wallet (lazy init, resets if RPC_URL changes) ─── */
let _provider    = null;
let _providerUrl = null;
let _wallet      = null;

function getProvider() {
  const url = getRpcUrl();
  if (!_provider || _providerUrl !== url) {
    _provider    = new ethers.JsonRpcProvider(url);
    _providerUrl = url;
    _wallet      = null; // reset wallet when provider changes
  }
  return _provider;
}

function getWallet() {
  const privKey = getPrivKey();
  if (!privKey) throw new Error('FAUCET_PRIVATE_KEY is not configured');
  if (!_wallet) {
    _wallet = new ethers.Wallet(privKey, getProvider());
  }
  return _wallet;
}

/**
 * Get the faucet wallet ETH balance on Sepolia.
 * @returns {Promise<string>} balance in ETH (e.g. "4.2837")
 */
async function getFaucetBalance() {
  try {
    const addr = getFaucetAddr();
    if (!addr) throw new Error('FAUCET_ADDRESS is not configured');
    const provider = getProvider();
    const balWei   = await provider.getBalance(addr);
    return parseFloat(ethers.formatEther(balWei)).toFixed(4);
  } catch (err) {
    console.error('[FAUCET] Balance check failed:', err.message);
    return '0.0000';
  }
}

/**
 * Send CLAIM_AMOUNT_ETH to the specified recipient.
 * @param {string} recipientAddress  0x-prefixed Ethereum address
 * @returns {Promise<{txHash: string, blockNumber: number|null}>}
 */
async function sendEth(recipientAddress) {
  const wallet       = getWallet();
  const claimAmtEth  = getClaimAmt();

  // Sanity check: ensure faucet has enough balance
  const balWei    = await getProvider().getBalance(wallet.address);
  const sendWei   = ethers.parseEther(claimAmtEth.toString());
  const minBuffer = ethers.parseEther('0.002'); // keep buffer for gas

  if (balWei < sendWei + minBuffer) {
    throw new Error('Faucet balance is too low. Please try again later.');
  }

  // Get current gas price
  const gasPrice = (await getProvider().getFeeData()).gasPrice || ethers.parseUnits('2', 'gwei');

  const tx = await wallet.sendTransaction({
    to:       recipientAddress,
    value:    sendWei,
    gasLimit: 21_000n,
    gasPrice: gasPrice,
  });

  console.log(`[FAUCET] Sent ${claimAmtEth} ETH to ${recipientAddress} | tx: ${tx.hash}`);

  return { txHash: tx.hash, blockNumber: null };
}

/**
 * Verify the connected RPC is actually Sepolia (chainId 11155111).
 */
async function verifyNetwork() {
  try {
    const network = await getProvider().getNetwork();
    if (network.chainId !== 11155111n) {
      console.warn(`[FAUCET] WARNING: Connected to chainId ${network.chainId}, expected 11155111 (Sepolia)`);
      return false;
    }
    console.log('[FAUCET] Connected to Sepolia testnet ✓');
    return true;
  } catch (err) {
    console.error('[FAUCET] Network verification failed:', err.message);
    return false;
  }
}

// Expose CLAIM_AMOUNT_ETH as a getter so it always reflects current env
Object.defineProperty(module.exports, 'CLAIM_AMOUNT_ETH', { get: getClaimAmt });
module.exports.sendEth         = sendEth;
module.exports.getFaucetBalance = getFaucetBalance;
module.exports.verifyNetwork   = verifyNetwork;