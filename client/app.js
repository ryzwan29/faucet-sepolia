/**
 * Sepolia ETH Faucet — Frontend Application
 * Handles: theme, wallet validation, CAPTCHA, API calls, UI feedback
 */

'use strict';

/* ─── Constants ─── */
const API_BASE = window.location.origin; // same-origin backend
const CLAIM_AMOUNT = '0.1';

/* ─── State ─── */
let turnstileToken = null;
let isLoading = false;

/* ─── DOM References ─── */
const themeToggle  = document.getElementById('themeToggle');
const iconSun      = document.getElementById('iconSun');
const iconMoon     = document.getElementById('iconMoon');
const walletInput  = document.getElementById('walletAddress');
const walletError  = document.getElementById('walletError');
const claimBtn     = document.getElementById('claimBtn');
const resultPanel  = document.getElementById('resultPanel');
const refreshBtn   = document.getElementById('refreshBtn');
const statBalance  = document.getElementById('statBalance');
const statDistrib  = document.getElementById('statDistributed');
const statClaims   = document.getElementById('statClaims');
const toast        = document.getElementById('toast');
const toastMsg     = document.getElementById('toastMsg');
const toastIcon    = document.getElementById('toastIcon');

/* ─────────────────────────────────────────
   THEME
───────────────────────────────────────── */
function getTheme() {
  return localStorage.getItem('faucet-theme') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  iconSun.classList.toggle('hidden', theme === 'light');
  iconMoon.classList.toggle('hidden', theme === 'dark');
  localStorage.setItem('faucet-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

themeToggle.addEventListener('click', toggleTheme);
applyTheme(getTheme());

/* ─────────────────────────────────────────
   TURNSTILE CALLBACKS
───────────────────────────────────────── */
window.onTurnstileSuccess = function(token) {
  turnstileToken = token;
};

window.onTurnstileExpired = function() {
  turnstileToken = null;
};

/* ─────────────────────────────────────────
   WALLET VALIDATION
───────────────────────────────────────── */
function isValidEthAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

function setInputState(state, message) {
  walletInput.classList.remove('valid', 'invalid');
  walletError.classList.remove('show');
  if (state === 'valid') {
    walletInput.classList.add('valid');
  } else if (state === 'invalid') {
    walletInput.classList.add('invalid');
    walletError.textContent = message || 'Invalid address';
    walletError.classList.add('show');
  }
}

walletInput.addEventListener('input', () => {
  const val = walletInput.value.trim();
  if (!val) {
    setInputState('');
    return;
  }
  if (val.length < 42) {
    setInputState('');
    return;
  }
  if (isValidEthAddress(val)) {
    setInputState('valid');
  } else {
    setInputState('invalid', 'Must be a valid 0x Ethereum address (42 characters)');
  }
});

walletInput.addEventListener('blur', () => {
  const val = walletInput.value.trim();
  if (val && !isValidEthAddress(val)) {
    setInputState('invalid', 'Must be a valid 0x Ethereum address (42 characters)');
  }
});

/* ─────────────────────────────────────────
   CLAIM BUTTON STATE
───────────────────────────────────────── */
function setLoading(loading) {
  isLoading = loading;
  claimBtn.disabled = loading;
  claimBtn.classList.toggle('loading', loading);
  walletInput.disabled = loading;
}

/* ─────────────────────────────────────────
   RESULT PANEL
───────────────────────────────────────── */
function showSuccess(txHash, walletAddress) {
  const short = walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
  const etherscanUrl = `https://sepolia.etherscan.io/tx/${txHash}`;

  resultPanel.className = 'card result-panel result-success show';
  resultPanel.innerHTML = `
    <div class="result-header">
      <div class="result-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#05a87a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div>
        <div class="result-title">Transaction Sent!</div>
        <div class="result-message">${CLAIM_AMOUNT} ETH is on its way to ${short}</div>
      </div>
    </div>

    <div class="tx-hash-block">
      <div class="tx-label">Transaction Hash</div>
      <div class="tx-hash-row">
        <span class="tx-hash-value" id="txHashValue">${txHash}</span>
        <button class="copy-btn" id="copyHashBtn" aria-label="Copy transaction hash">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
      </div>
    </div>

    <a class="etherscan-link" href="${etherscanUrl}" target="_blank" rel="noopener" aria-label="View transaction on Etherscan">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      View on Etherscan
    </a>
  `;

  // Copy button
  document.getElementById('copyHashBtn').addEventListener('click', () => copyHash(txHash));
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showError(message) {
  resultPanel.className = 'card result-panel result-error show';
  resultPanel.innerHTML = `
    <div class="result-header">
      <div class="result-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div>
        <div class="result-title">Request Failed</div>
        <div class="result-message">${escapeHtml(message)}</div>
      </div>
    </div>
  `;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  resultPanel.className = 'card result-panel';
  resultPanel.innerHTML = '';
}

/* ─────────────────────────────────────────
   COPY TX HASH
───────────────────────────────────────── */
async function copyHash(hash) {
  const btn = document.getElementById('copyHashBtn');
  try {
    await navigator.clipboard.writeText(hash);
    if (btn) {
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Copied!`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy`;
      }, 2000);
    }
    showToast('Transaction hash copied!', 'success');
  } catch {
    showToast('Copy failed — please copy manually', 'error');
  }
}

/* ─────────────────────────────────────────
   TOAST
───────────────────────────────────────── */
let toastTimer = null;

function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  toast.className = `toast toast-${type} show`;

  const icons = {
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  toastIcon.innerHTML = icons[type] || icons.info;
  toastMsg.textContent = message;

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

/* ─────────────────────────────────────────
   FETCH FAUCET STATS
───────────────────────────────────────── */
async function fetchStats() {
  try {
    refreshBtn.classList.add('spinning');
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) throw new Error('Stats unavailable');
    const data = await res.json();

    statBalance.textContent = parseFloat(data.balance ?? 0).toFixed(4);
    statDistrib.textContent = parseFloat(data.totalDistributed ?? 0).toFixed(2);
    statClaims.textContent  = Number(data.totalClaims ?? 0).toLocaleString();
  } catch {
    statBalance.textContent = '—';
    statDistrib.textContent = '—';
    statClaims.textContent  = '—';
  } finally {
    setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
  }
}

refreshBtn.addEventListener('click', fetchStats);

/* ─────────────────────────────────────────
   CLAIM
───────────────────────────────────────── */
claimBtn.addEventListener('click', async () => {
  if (isLoading) return;

  const address = walletInput.value.trim();

  // Validate address
  if (!address) {
    setInputState('invalid', 'Please enter your wallet address');
    walletInput.focus();
    return;
  }
  if (!isValidEthAddress(address)) {
    setInputState('invalid', 'Must be a valid Ethereum address (0x + 40 hex chars)');
    walletInput.focus();
    return;
  }

  // Validate CAPTCHA
  if (!turnstileToken) {
    showToast('Please complete the CAPTCHA first', 'error');
    return;
  }

  hideResult();
  setLoading(true);
  showToast('Sending transaction…', 'info');

  try {
    const response = await fetch(`${API_BASE}/api/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: address,
        captchaToken: turnstileToken,
      }),
    });

    const data = await response.json();

    if (response.ok && data.txHash) {
      showSuccess(data.txHash, address);
      showToast('0.1 ETH sent successfully! 🎉', 'success');
      walletInput.value = '';
      setInputState('');
      // Reset turnstile
      if (window.turnstile) window.turnstile.reset();
      turnstileToken = null;
      // Refresh stats
      setTimeout(fetchStats, 3000);
    } else {
      const msg = data.error || data.message || 'Something went wrong. Please try again.';
      showError(msg);
      showToast(msg, 'error');
      if (window.turnstile) window.turnstile.reset();
      turnstileToken = null;
    }
  } catch (err) {
    const msg = 'Network error — please check your connection and try again.';
    showError(msg);
    showToast(msg, 'error');
    if (window.turnstile) window.turnstile.reset();
    turnstileToken = null;
  } finally {
    setLoading(false);
  }
});

/* ─────────────────────────────────────────
   KEYBOARD SHORTCUT: Enter in input
───────────────────────────────────────── */
walletInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') claimBtn.click();
});

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
(async function init() {
  // Load Turnstile site key dari backend
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const { turnstileSiteKey } = await res.json();
    if (turnstileSiteKey && window.turnstile) {
      window.turnstile.render('#turnstileWidget', {
        sitekey:          turnstileSiteKey,
        callback:         onTurnstileSuccess,
        'expired-callback': onTurnstileExpired,
        theme:            'auto',
      });
    }
  } catch (err) {
    console.error('Failed to load Turnstile config:', err);
  }

  fetchStats();
  setInterval(fetchStats, 60_000);
})();
