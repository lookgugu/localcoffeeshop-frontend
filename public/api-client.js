/**
 * ApiClient — shared HTTP layer for the frontend.
 *
 * UMD-style: the same file works as a CommonJS module in Node tests AND
 * attaches `window.ApiClient` when loaded in the browser.
 *
 * Design contract (see tasks/todo.md, candidate #4):
 *   - HTTP-verb interface: api.get/post/put/delete (path, [body,] opts?)
 *   - Returns the unwrapped `data` from a `{success, data, error}` envelope.
 *   - Typed errors so callers can branch:
 *       ApiUsageError      synchronous — misuse of the interface
 *       ApiTimeoutError    AbortController fired on our per-attempt timeout
 *       ApiNetworkError    fetch threw (offline, DNS, CORS)
 *       ApiHttpError       non-2xx after retries are exhausted
 *       ApiEnvelopeError   2xx but `{success: false}` payload
 *       ApiParseError      body wasn't JSON / wrong envelope shape
 *   - Retry only on 5xx, 429, network errors, timeouts. NEVER on 4xx or
 *     ApiEnvelopeError — those mean "don't retry, the request is the problem".
 *   - SAFETY: synchronously throws ApiUsageError when a write request
 *     (POST/PUT/DELETE) requests retries without an idempotency key. This
 *     makes unsafe configurations fail at code-review time, not on a
 *     production retry-storm that duplicates writes.
 *   - Base URL resolved once at module load from `window.APP_CONFIG.API_BASE_URL`,
 *     defaults to `/api/v1`. A `_resetBaseUrl()` escape hatch lets tests
 *     change APP_CONFIG between cases.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else if (typeof window !== 'undefined') {
    window.ApiClient = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // ERROR TYPES
  // --------------------------------------------------------------------------

  class ApiError extends Error {
    constructor(message, props = {}) {
      super(message);
      this.name = 'ApiError';
      Object.assign(this, props);
    }
  }
  class ApiUsageError extends ApiError {
    constructor(message, props) { super(message, props); this.name = 'ApiUsageError'; }
  }
  class ApiTimeoutError extends ApiError {
    constructor(message, props) { super(message, props); this.name = 'ApiTimeoutError'; }
  }
  class ApiNetworkError extends ApiError {
    constructor(message, props) { super(message, props); this.name = 'ApiNetworkError'; }
  }
  class ApiHttpError extends ApiError {
    constructor(message, props) { super(message, props); this.name = 'ApiHttpError'; }
  }
  class ApiEnvelopeError extends ApiError {
    constructor(message, props) { super(message, props); this.name = 'ApiEnvelopeError'; }
  }
  class ApiParseError extends ApiError {
    constructor(message, props) { super(message, props); this.name = 'ApiParseError'; }
  }

  // --------------------------------------------------------------------------
  // BASE URL RESOLUTION (once at module load; resettable for tests)
  // --------------------------------------------------------------------------

  const DEFAULTS = Object.freeze({
    timeout: 8000,
    backoffBaseMs: 200,
    gets: 3,
    writes: 0,
  });

  function resolveBaseUrl() {
    const raw = (typeof window !== 'undefined'
      && window.APP_CONFIG
      && window.APP_CONFIG.API_BASE_URL) || '/api/v1';
    return raw.replace(/\/$/, '');
  }

  let BASE = resolveBaseUrl();

  function _resetBaseUrl() { BASE = resolveBaseUrl(); }

  // --------------------------------------------------------------------------
  // CORE REQUEST
  // --------------------------------------------------------------------------

  const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

  function _buildUrl(path, query) {
    let url = BASE + path;
    if (query && typeof query === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
      const qs = params.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    return url;
  }

  function _backoffDelay(attemptIndex) {
    // 200ms, 400ms, 800ms, ...
    return DEFAULTS.backoffBaseMs * Math.pow(2, attemptIndex);
  }

  function _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function _attempt({ url, fetchOpts, timeout, callerSignal }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Compose caller's AbortSignal with our timeout controller.
    let onCallerAbort = null;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        onCallerAbort = () => controller.abort();
        callerSignal.addEventListener('abort', onCallerAbort);
      }
    }

    try {
      const response = await fetch(url, Object.assign({}, fetchOpts, { signal: controller.signal }));
      return response;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // Caller-initiated aborts should surface as their own error class
        if (callerSignal && callerSignal.aborted) {
          throw new ApiNetworkError(`Request to ${url} aborted by caller`, { url, cause: err });
        }
        throw new ApiTimeoutError(`Request to ${url} timed out after ${timeout}ms`, { url, timeout });
      }
      throw new ApiNetworkError(`Network failure: ${err.message}`, { url, cause: err });
    } finally {
      clearTimeout(timeoutId);
      if (onCallerAbort && callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  async function _parseEnvelope(response, url) {
    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new ApiParseError(`Response from ${url} was not valid JSON`, { url, cause: err });
    }

    if (typeof json !== 'object' || json === null || !('success' in json)) {
      throw new ApiParseError(`Response from ${url} missing envelope shape`, { url, envelope: json });
    }

    if (json.success === false) {
      const errMsg = (json.error && json.error.message) || 'Server returned success: false';
      throw new ApiEnvelopeError(errMsg, { url, envelope: json });
    }

    return json.data;
  }

  // SYNCHRONOUS safety check: a write request that wants retries MUST carry an
  // idempotency key, otherwise a retry on a flaky network could duplicate a
  // create/update/delete. This is the load-bearing safety property of the
  // client. It has to fire BEFORE any await — that means BEFORE the async
  // body runs — so it lives in the non-async wrapper, not inside _requestAsync.
  function _assertUsage(method, opts) {
    if (!WRITE_METHODS.has(method)) return;
    const retries = opts && opts.retries != null
      ? opts.retries
      : DEFAULTS.writes;
    if (retries > 0 && !(opts && opts.idempotencyKey)) {
      throw new ApiUsageError(
        `Retried ${method} requires an idempotencyKey to avoid duplicate writes. ` +
        `Either pass {idempotencyKey: <uuid>} or set {retries: 0}.`
      );
    }
  }

  function _request(method, path, body, opts) {
    opts = opts || {};
    _assertUsage(method, opts);
    return _requestAsync(method, path, body, opts);
  }

  async function _requestAsync(method, path, body, opts) {
    const isWrite = WRITE_METHODS.has(method);
    const retries = opts.retries != null
      ? opts.retries
      : (isWrite ? DEFAULTS.writes : DEFAULTS.gets);

    const url = _buildUrl(path, opts.query);
    const timeout = opts.timeout != null ? opts.timeout : DEFAULTS.timeout;

    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    const hasBody = body !== undefined && body !== null;
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const fetchOpts = { method, headers };
    if (hasBody) fetchOpts.body = JSON.stringify(body);

    const totalAttempts = retries + 1;
    let lastErr = null;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      let response;
      try {
        response = await _attempt({
          url, fetchOpts, timeout, callerSignal: opts.signal,
        });
      } catch (err) {
        // Network errors and timeouts are retryable.
        if (err instanceof ApiNetworkError || err instanceof ApiTimeoutError) {
          lastErr = err;
          if (attempt < totalAttempts - 1) {
            await _wait(_backoffDelay(attempt));
            continue;
          }
          throw err;
        }
        throw err;
      }

      if (response.ok) {
        // 2xx — parse envelope; an envelope error is NOT retryable.
        return await _parseEnvelope(response, url);
      }

      // Non-2xx
      const isRetryable = response.status >= 500 || response.status === 429;
      if (!isRetryable || attempt === totalAttempts - 1) {
        const bodyText = await response.text().catch(() => '');
        throw new ApiHttpError(`HTTP ${response.status} for ${url}`, {
          url,
          status: response.status,
          body: bodyText,
        });
      }
      lastErr = new ApiHttpError(`HTTP ${response.status} for ${url}`, {
        url, status: response.status,
      });
      await _wait(_backoffDelay(attempt));
    }

    // Defensive: loop always returns or throws above, but TypeScript-style safety.
    throw lastErr || new ApiError(`Unexpected exit from retry loop for ${url}`);
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  return {
    get(path, opts) { return _request('GET', path, undefined, opts); },
    post(path, body, opts) { return _request('POST', path, body, opts); },
    put(path, body, opts) { return _request('PUT', path, body, opts); },
    delete(path, opts) { return _request('DELETE', path, undefined, opts); },
    errors: {
      ApiError,
      ApiUsageError,
      ApiTimeoutError,
      ApiNetworkError,
      ApiHttpError,
      ApiEnvelopeError,
      ApiParseError,
    },
    _resetBaseUrl,
  };
});
