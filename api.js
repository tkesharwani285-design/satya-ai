/**
 * Satya.ai API client: one place for the base URL, timeouts and error handling.
 *
 * Base URL
 *   VITE_API_BASE_URL=http://localhost:8000   -> call the backend directly (needs CORS, already enabled)
 *   VITE_API_BASE_URL=                        -> empty: use relative "/api/..." URLs and let the Vite proxy forward them
 *   (variable not defined at all)             -> falls back to http://localhost:8000
 * `??` is used instead of `||` on purpose, so an explicitly empty value enables the proxy mode.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
const API_PREFIX = '/api/v1';

// Matches the backend defaults (MAX_IMAGE_MB / MAX_AUDIO_MB in config.py); used for instant client-side feedback.
export const LIMITS = { imageMb: 10, audioMb: 25 };

const TIMEOUTS = { default: 45_000, upload: 120_000 }; // media/audio do image search + transcription server-side

export class ApiError extends Error {
  /**
   * @param {string} message  human-readable text, safe to show in the UI
   * @param {{status?: number, kind?: 'network'|'timeout'|'http'|'aborted', details?: unknown}} [meta]
   */
  constructor(message, { status = 0, kind = 'http', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.details = details;
  }
}

/** FastAPI errors look like {detail: "text"} or {detail: [{loc, msg, type}, ...]} for validation failures. */
function messageFromDetail(detail, status) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body' && p !== 'query').join('.') : '';
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join('; ');
  }
  if (status === 413) return 'That file is too large.';
  if (status === 415) return 'That file type is not supported.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The Satya server hit an error. Please try again.';
  return `Request failed (HTTP ${status}).`;
}

async function request(path, { method = 'GET', json, formData, signal, timeoutMs = TIMEOUTS.default } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const init = { method, signal: controller.signal, headers: { Accept: 'application/json' } };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (formData) {
    init.body = formData; // do NOT set Content-Type: the browser adds the multipart boundary itself
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, init);
  } catch (err) {
    if (timedOut) {
      throw new ApiError('The request timed out. The server may be busy; please try again.', { kind: 'timeout' });
    }
    if (err?.name === 'AbortError') throw new ApiError('Request cancelled.', { kind: 'aborted' });
    const where = API_BASE_URL || window.location.origin;
    throw new ApiError(`Cannot reach the Satya API at ${where}. Is the backend running?`, { kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const raw = await res.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      /* non-JSON body (e.g. proxy error page) */
    }
  }
  if (!res.ok) {
    throw new ApiError(messageFromDetail(body?.detail, res.status), { status: res.status, kind: 'http', details: body });
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------------
// Verification endpoints. Every helper accepts an optional `{ signal }` so callers can cancel stale requests.
// ---------------------------------------------------------------------------------------------------------

/** POST /api/v1/verify/url  -> article info + linguistic + claims + source receipts */
export const verifyUrl = (url, opts = {}) => request('/verify/url', { method: 'POST', json: { url }, ...opts });

/** POST /api/v1/verify/text -> linguistic + claims + source receipts (backend requires 10-10,000 characters) */
export const verifyText = (text, opts = {}) => request('/verify/text', { method: 'POST', json: { text }, ...opts });

/**
 * POST /api/v1/verify/media (multipart/form-data)
 * @param {FormData} formData  field "file" (image) and optional "claimed_date" (YYYY-MM-DD)
 */
export const verifyMedia = (formData, opts = {}) =>
  request('/verify/media', { method: 'POST', formData, timeoutMs: TIMEOUTS.upload, ...opts });

/**
 * POST /api/v1/verify/audio (multipart/form-data)
 * @param {FormData} formData  field "file" (mp3, wav, m4a, ogg, opus, aac, webm)
 */
export const verifyAudio = (formData, opts = {}) =>
  request('/verify/audio', { method: 'POST', formData, timeoutMs: TIMEOUTS.upload, ...opts });

/**
 * POST /api/v1/verify/bot-risk
 * The backend accepts a claim URL or a hashtag (at least one).
 * @param {string} claimUrl
 * @param {string} [hashtag]
 */
export const getBotRisk = (claimUrl, hashtag, opts = {}) => {
  const json = {};
  if (claimUrl) json.claim_url = claimUrl;
  if (hashtag) json.hashtag = hashtag;
  return request('/verify/bot-risk', { method: 'POST', json, ...opts });
};

/** GET /api/v1/health -> {status, engine, version, latency_ms, uptime_seconds, integrations} */
export const getHealth = (opts = {}) => request('/health', { timeoutMs: 8_000, ...opts });
