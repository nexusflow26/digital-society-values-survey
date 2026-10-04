// Shared helpers for the API functions (Vercel Node runtime, no npm dependencies).
const crypto = require('crypto');

const VALUE_KEYS = ['economic', 'environment', 'community'];
const COOKIE_NAME = 'ds_submitted';
const RATE_LIMIT_PER_HOUR = 10;

// ---------- Storage: Upstash Redis REST API, with an in-memory fallback for local testing ----------
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const storageMode = REDIS_URL && REDIS_TOKEN ? 'redis' : 'memory';

const memory = globalThis.__dsMemoryStore || (globalThis.__dsMemoryStore = { kv: new Map(), lists: new Map() });

async function redis(command) {
  if (storageMode === 'memory') return memoryCommand(command);
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Redis error: ${data.error || res.status}`);
  return data.result;
}

function memoryCommand([cmd, key, ...args]) {
  switch (cmd.toUpperCase()) {
    case 'SET': {
      if (args.includes('NX') && memory.kv.has(key)) return null;
      memory.kv.set(key, args[0]);
      return 'OK';
    }
    case 'GET': return memory.kv.has(key) ? memory.kv.get(key) : null;
    case 'EXISTS': return memory.kv.has(key) ? 1 : 0;
    case 'INCR': {
      const n = Number(memory.kv.get(key) || 0) + 1;
      memory.kv.set(key, String(n));
      return n;
    }
    case 'EXPIRE': return 1;
    case 'RPUSH': {
      const list = memory.lists.get(key) || [];
      list.push(args[0]);
      memory.lists.set(key, list);
      return list.length;
    }
    case 'LRANGE': return [...(memory.lists.get(key) || [])];
    default: throw new Error(`Unsupported memory command ${cmd}`);
  }
}

// ---------- Validation ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts {economic, environment, community} in any non-negative scale; returns percentages summing to 100.
function normalisePlot(plot) {
  if (!plot || typeof plot !== 'object') return null;
  const raw = VALUE_KEYS.map((k) => Number(plot[k]));
  if (raw.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return null;
  const total = raw.reduce((a, b) => a + b, 0);
  if (total < 99 || total > 101) return null; // must already be a valid composition
  const pct = raw.map((v) => Math.round((v / total) * 1000) / 10);
  // Push any rounding drift onto the largest component so the three always sum to exactly 100.0
  const drift = Math.round((100 - pct.reduce((a, b) => a + b, 0)) * 10) / 10;
  if (drift !== 0) {
    const i = pct.indexOf(Math.max(...pct));
    pct[i] = Math.round((pct[i] + drift) * 10) / 10;
  }
  return Object.fromEntries(VALUE_KEYS.map((k, i) => [k, pct[i]]));
}

// ---------- HTTP helpers ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function clientIpHash(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  const ip = fwd.split(',')[0].trim() || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
  const salt = process.env.IP_SALT || 'digital-society-default-salt';
  return crypto.createHash('sha256').update(salt + ip).digest('hex').slice(0, 32);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

module.exports = {
  VALUE_KEYS, COOKIE_NAME, RATE_LIMIT_PER_HOUR, UUID_RE, storageMode,
  redis, normalisePlot, parseCookies, clientIpHash, readJsonBody, send, safeEqual,
};
