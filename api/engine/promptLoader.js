// api/engine/promptLoader.js
// Loads prompts from GitHub raw with in-memory cache (Vercel best-effort)
// Hardening: timeout + bounded cache + safe ref/path + retry/backoff + ETag support

const CACHE = new Map();
// key: `${repo}@${ref}:${path}` -> { at:number, text:string, etag?:string }

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 80;
const MAX_PROMPT_BYTES = 250_000;

function env(name, fallback = null) {
  const v = process.env[name];
  return (typeof v === "string" && v.trim()) ? v.trim() : fallback;
}

function makeRawUrl({ repo, ref, path }) {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
}

function assertSafeRef(ref) {
  const r = String(ref || "").trim();
  if (!r) throw new Error("PROMPTS_REF missing");
  if (/\s/.test(r)) throw new Error("PROMPTS_REF invalid");
  if (!/^[A-Za-z0-9._\-\/]+$/.test(r)) throw new Error("PROMPTS_REF invalid");
  return r;
}

function assertSafePath(path) {
  const p = String(path || "").trim();
  if (!p) throw new Error("prompt path missing");
  if (p.includes("..")) throw new Error("prompt path invalid");
  if (p.startsWith("/") || p.startsWith("\\")) throw new Error("prompt path invalid");
  return p;
}

function boundedCacheSet(key, value) {
  if (CACHE.size >= MAX_CACHE_ENTRIES && !CACHE.has(key)) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [k, v] of CACHE.entries()) {
      if ((v?.at ?? Infinity) < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) CACHE.delete(oldestKey);
  }
  CACHE.set(key, value);
}

async function fetchTextWithTimeout(url, { timeoutMs = 4500, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { ...headers }
    });

    // NOTE: raw.githubusercontent.com can respond 304 with empty body when ETag matches.
    const status = r.status;
    const etag = r.headers?.get?.("etag") || null;

    let raw = "";
    try { raw = await r.text(); } catch { raw = ""; }

    if (status === 304) {
      return { text: "", etag, notModified: true };
    }

    if (!r.ok) {
      throw new Error(`PROMPT_FETCH_FAILED ${r.status} ${raw.slice(0, 200)}`);
    }

    if (Buffer.byteLength(raw, "utf8") > MAX_PROMPT_BYTES) {
      throw new Error("PROMPT_TOO_LARGE");
    }

    return { text: raw, etag, notModified: false };
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, { attempts = 2, timeoutMs = 4500, headers = {} } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchTextWithTimeout(url, { timeoutMs, headers });
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const isAbort = msg.includes("aborted") || msg.includes("AbortError");
      const isRetryable =
        isAbort ||
        msg.includes("429") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504");

      if (i < attempts - 1 && isRetryable) {
        await sleep(120 + i * 180);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

async function loadPrompt(path, opts = {}) {
  const repo = opts.repo || env("PROMPTS_REPO");
  const ref = assertSafeRef(opts.ref || env("PROMPTS_REF", "main"));
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS;

  if (!repo) throw new Error("PROMPTS_REPO missing");

  const safePath = assertSafePath(path);
  const key = `${repo}@${ref}:${safePath}`;
  const now = Date.now();

  const cached = CACHE.get(key);
  if (cached && (now - cached.at) < ttlMs) return cached.text;

  const url = makeRawUrl({ repo, ref, path: safePath });

  const headers = {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  let fetched;
  try {
    fetched = await fetchWithRetry(url, { attempts: 2, timeoutMs: 4500, headers });
  } catch (e) {
    if (cached?.text) return cached.text; // best-effort fallback
    throw e;
  }

  if (fetched?.notModified && cached?.text) {
    boundedCacheSet(key, { at: now, text: cached.text, etag: fetched?.etag || cached?.etag || null });
    return cached.text;
  }

  const text =
    (typeof fetched?.text === "string" && fetched.text.length)
      ? fetched.text
      : (cached?.text || "");

  if (!text) throw new Error("PROMPT_EMPTY");

  boundedCacheSet(key, {
    at: now,
    text,
    etag: fetched?.etag || cached?.etag || null
  });

  return text;
}

module.exports = { loadPrompt };
