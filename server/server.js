/**
 * server.js — Express backend for the Sepolia ETH Faucet
 *
 * Endpoints:
 *   POST /api/claim   — Validate & send ETH
 *   GET  /api/stats   — Faucet balance + claim totals
 *
 * Security layers:
 *   1. Cloudflare Turnstile CAPTCHA verification
 *   2. Per-wallet 24-hour cooldown (SQLite)
 *   3. Per-IP    24-hour cooldown (SQLite)
 *   4. Express-rate-limit (burst protection)
 *   5. Helmet (HTTP security headers)
 */

'use strict';

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const https        = require('https');

const db     = require('./database');
const faucet = require('./faucet');

/* ─── Config ─── */
const PORT                = parseInt(process.env.PORT || '3000', 10);
const COOLDOWN_HOURS      = parseInt(process.env.CLAIM_COOLDOWN_HOURS || '24', 10);
const COOLDOWN_SECONDS    = COOLDOWN_HOURS * 3600;
const TURNSTILE_SECRET    = process.env.TURNSTILE_SECRET_KEY || '';

/* ─── App ─── */
const app = express();

app.set('trust proxy', 1); // Trust first proxy (Nginx, Cloudflare, etc.)

/* ─── Middleware ─── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
      frameSrc:   ["https://challenges.cloudflare.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '8kb' }));
app.use(express.urlencoded({ extended: false }));

/* ─── Rate Limiter (burst protection) ─── */
const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      5,               // max 5 requests per 15 min per IP (extra safety)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait 15 minutes before trying again.' },
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please slow down.' },
});

app.use('/api', globalLimiter);

/* ─── Static Files ─── */
app.use(express.static(path.join(__dirname, '..', 'client')));

/* ─────────────────────────────────────────────────────────────
   CAPTCHA VERIFICATION (Cloudflare Turnstile)
───────────────────────────────────────────────────────────── */
async function verifyTurnstile(token, remoteIp) {
  if (!TURNSTILE_SECRET) {
    // If no secret key configured, skip verification in dev
    console.warn('[CAPTCHA] TURNSTILE_SECRET_KEY not set — skipping CAPTCHA in dev mode');
    return { success: true };
  }

  return new Promise((resolve) => {
    const body = JSON.stringify({
      secret:   TURNSTILE_SECRET,
      response: token,
      remoteip: remoteIp,
    });

    const options = {
      hostname: 'challenges.cloudflare.com',
      path:     '/turnstile/v0/siteverify',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ success: false }); }
      });
    });

    req.on('error', () => resolve({ success: false }));
    req.write(body);
    req.end();
  });
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    '0.0.0.0'
  );
}

function formatCooldown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function isValidEthAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/* ─────────────────────────────────────────────────────────────
   POST /api/claim
───────────────────────────────────────────────────────────── */
app.post('/api/claim', claimLimiter, async (req, res) => {
  const ip            = getClientIp(req);
  const { walletAddress, captchaToken } = req.body;

  /* 1. Input validation */
  if (!walletAddress || typeof walletAddress !== 'string') {
    return res.status(400).json({ error: 'walletAddress is required.' });
  }

  const wallet = walletAddress.trim();

  if (!isValidEthAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid Ethereum address. Must be 0x followed by 40 hex characters.' });
  }

  if (!captchaToken || typeof captchaToken !== 'string') {
    return res.status(400).json({ error: 'CAPTCHA token is required.' });
  }

  /* 2. Verify CAPTCHA */
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    return res.status(403).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }

  /* 3. Check cooldown — wallet */
  const waitSeconds = db.secondsUntilEligible(wallet, ip, COOLDOWN_SECONDS);
  if (waitSeconds > 0) {
    const when = formatCooldown(waitSeconds);
    return res.status(429).json({
      error: `This wallet or IP address already claimed recently. Please wait ${when} before claiming again.`,
      waitSeconds,
    });
  }

  /* 4. Send ETH */
  let txHash;
  try {
    const result = await faucet.sendEth(wallet);
    txHash = result.txHash;
  } catch (err) {
    console.error('[CLAIM] Transaction failed:', err.message);
    return res.status(503).json({
      error: err.message.includes('balance') 
        ? err.message 
        : 'Transaction failed. Please try again in a moment.',
    });
  }

  /* 5. Record in DB */
  try {
    db.recordClaim({
      walletAddress: wallet,
      ipAddress:     ip,
      txHash,
      amountEth:     faucet.CLAIM_AMOUNT_ETH,
    });
  } catch (err) {
    console.error('[CLAIM] DB record failed:', err.message);
    // Don't fail the request — ETH was already sent
  }

  console.log(`[CLAIM] ✓ ${faucet.CLAIM_AMOUNT_ETH} ETH → ${wallet} | ip=${ip} | tx=${txHash}`);

  return res.status(200).json({
    success: true,
    txHash,
    amount:  faucet.CLAIM_AMOUNT_ETH,
    wallet,
    message: `${faucet.CLAIM_AMOUNT_ETH} ETH sent to ${wallet}`,
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /api/stats
───────────────────────────────────────────────────────────── */
app.get('/api/stats', async (req, res) => {
  try {
    const [balance, stats] = await Promise.all([
      faucet.getFaucetBalance(),
      Promise.resolve(db.getStats()),
    ]);

    return res.json({
      balance,
      totalClaims:      stats.totalClaims,
      totalDistributed: parseFloat(stats.totalDistributed.toFixed(4)),
      claimAmount:      faucet.CLAIM_AMOUNT_ETH,
      network:          'Sepolia',
      chainId:          11155111,
    });
  } catch (err) {
    console.error('[STATS]', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

/* ─── Health Check ─── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/* ─── SPA fallback (serve index.html for any unknown route) ─── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

/* ─────────────────────────────────────────────────────────────
   STARTUP
───────────────────────────────────────────────────────────── */
async function start() {
  // Init database
  db.init();

  // Verify blockchain network
  await faucet.verifyNetwork();

  // Start server
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  Sepolia ETH Faucet Server            ║`);
    console.log(`║  http://localhost:${PORT}                 ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
    console.log(`  Cooldown  : ${COOLDOWN_HOURS}h`);
    console.log(`  RPC       : ${process.env.RPC_URL || 'default'}`);
    console.log(`  Faucet    : ${process.env.FAUCET_ADDRESS || 'NOT SET'}`);
    console.log(`  CAPTCHA   : ${TURNSTILE_SECRET ? 'enabled' : 'DISABLED (dev mode)'}\n`);
  });
}

start().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
