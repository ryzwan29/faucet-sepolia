/**
 * database.js — SQLite persistence layer for the Sepolia ETH Faucet
 * Uses better-sqlite3 for synchronous, fast local storage.
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'faucet.db');

let db;

/**
 * Initialize the database and create tables if they don't exist.
 */
function init() {
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address  TEXT    NOT NULL,
      ip_address      TEXT    NOT NULL,
      tx_hash         TEXT    NOT NULL,
      amount_eth      REAL    NOT NULL DEFAULT 0.1,
      claimed_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      network         TEXT    NOT NULL DEFAULT 'sepolia'
    );

    CREATE INDEX IF NOT EXISTS idx_wallet  ON claims(wallet_address, claimed_at);
    CREATE INDEX IF NOT EXISTS idx_ip      ON claims(ip_address, claimed_at);
  `);

  console.log(`[DB] Initialized: ${DB_PATH}`);
  return db;
}

/**
 * Get last claim for a wallet address within the cooldown window.
 * @param {string} wallet
 * @param {number} cooldownSeconds
 */
function getLastClaimByWallet(wallet, cooldownSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - cooldownSeconds;
  return db.prepare(`
    SELECT * FROM claims
    WHERE wallet_address = ? AND claimed_at > ?
    ORDER BY claimed_at DESC LIMIT 1
  `).get(wallet.toLowerCase(), cutoff);
}

/**
 * Get last claim for an IP address within the cooldown window.
 * @param {string} ip
 * @param {number} cooldownSeconds
 */
function getLastClaimByIP(ip, cooldownSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - cooldownSeconds;
  return db.prepare(`
    SELECT * FROM claims
    WHERE ip_address = ? AND claimed_at > ?
    ORDER BY claimed_at DESC LIMIT 1
  `).get(ip, cutoff);
}

/**
 * Record a successful claim.
 * @param {object} opts
 */
function recordClaim({ walletAddress, ipAddress, txHash, amountEth = 0.1 }) {
  return db.prepare(`
    INSERT INTO claims (wallet_address, ip_address, tx_hash, amount_eth)
    VALUES (?, ?, ?, ?)
  `).run(walletAddress.toLowerCase(), ipAddress, txHash, amountEth);
}

/**
 * Get aggregate faucet statistics.
 */
function getStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*)        AS total_claims,
      SUM(amount_eth) AS total_distributed
    FROM claims
  `).get();
  return {
    totalClaims:      row.total_claims       || 0,
    totalDistributed: row.total_distributed  || 0,
  };
}

/**
 * Seconds until a wallet or IP can claim again.
 * Returns 0 if they are eligible right now.
 * @param {string} wallet
 * @param {string} ip
 * @param {number} cooldownSeconds
 */
function secondsUntilEligible(wallet, ip, cooldownSeconds) {
  const now = Math.floor(Date.now() / 1000);

  const lastW = getLastClaimByWallet(wallet, cooldownSeconds);
  const lastI = getLastClaimByIP(ip, cooldownSeconds);

  let nextAllowed = 0;
  if (lastW) nextAllowed = Math.max(nextAllowed, lastW.claimed_at + cooldownSeconds);
  if (lastI) nextAllowed = Math.max(nextAllowed, lastI.claimed_at + cooldownSeconds);

  return Math.max(0, nextAllowed - now);
}

module.exports = { init, getLastClaimByWallet, getLastClaimByIP, recordClaim, getStats, secondsUntilEligible };
