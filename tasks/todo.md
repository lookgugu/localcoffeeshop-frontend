# Architecture deepening — frontend plan

Plan derived from the architectural review (see `../architecture-review.html` and `docs/adr/0001-explicit-pubsub-over-proxy-or-atoms.md`). Three candidates land in this repo, in this order.

---

## 1. Consolidate enums + split constants.js (candidate #2 — frontend half)

Coordinated with backend repo. Each repo commits its own copy of `enums.js`; a GitHub Action on each repo verifies they match. While in `constants.js`, also split out the unrelated runtime concerns.

- [x] Create `public/enums.js`:
  - [x] `State` as a namespace of functions over a frozen private map (no field cluster): `stateName`, `stateCodeFromName`, `isStateCode`, `allStates`, `allStateCodes`
  - [x] `Price` as a typed enum with attached fields: `Price.MODERATE.label`, `Price.MODERATE.cssClass`, `Price.MODERATE.numeric`, `Price.fromKey()`, `Price.average()`, etc.
  - [x] UMD-style footer: works as CommonJS in Node tests AND attaches `window.CoffeeShopEnums` for browser
- [x] Split the 298-LOC `public/constants.js` — only ~30 LOC is real enums/helpers:
  - [x] Move ServiceWorker registration (lines 174–208) → new `public/service-worker-registration.js`
  - [x] Move online/offline connection-banner code (lines 210–298) → new `public/connection-banner.js`
  - [x] Delete `public/constants.js` (skeleton helper moved to `public/skeleton.js`)
- [x] Update `public/html/index.html` and `public/html/state.html`:
  - [x] Wired through `asset-loader.js` / `asset-loader-state.js` (the only entrypoints these pages use). New loaders inject `enums.js` + `skeleton.js` BEFORE `frontend.js` / `state.js` with `async=false` to preserve insertion order. SW registration + connection banner also injected.
  - [x] No `constants.js` reference remains anywhere.
- [x] Update `public/frontend.js`:
  - [x] Hard `throw` if `window.CoffeeShopEnums` / `window.CoffeeShopSkeleton` missing (replaces the silent fallback)
  - [x] `getStateName` → `stateName`
  - [x] `getPriceLevelClass / formatPriceLevel / calculateAveragePrice / calculateAveragePriceFromLevel` → `Price.fromKey().cssClass / .label.toLowerCase() / Price.average(...).label / Price.averageFromNumeric(n).label`
- [x] Update `public/submit.js`:
  - [x] Deleted the local `STATE_NAMES` literal + `getStateName` function
  - [x] Imports `stateName` from `window.CoffeeShopEnums` (hard throw if missing)
- [x] Update `public/html/state.js` similarly (`STATE_NAMES`, `isValidStateCode`, all price helpers replaced)
- [x] Add GitHub Action `.github/workflows/enums-drift.yml`:
  - [x] curls backend's raw `src/enums.js` on every push/PR, `diff -q` against ours, exits non-zero on drift.
- [x] (Coordinate with backend repo — backend's `src/enums.js` is the canonical copy this commit mirrors verbatim)

---

## 2. Promote fetchWithRetry into an ApiClient (candidate #4)

Independent of #1 above — but worth doing #1 first so the touched files are clean.

- [x] Create `public/api-client.js`:
  - [x] HTTP-verb interface: `api.get(path, opts?)`, `api.post(path, body, opts?)`, `api.put(path, body, opts?)`, `api.delete(path, opts?)`
  - [x] Each returns `Promise<data>` — envelope unwrapped (extracts `data` from `{ success, data, error, metadata }`)
  - [x] Throws typed errors: `ApiUsageError` (synchronous), `ApiTimeoutError`, `ApiNetworkError`, `ApiHttpError`, `ApiEnvelopeError`, `ApiParseError`
  - [x] Options: `{ timeout, retries, signal, headers, idempotencyKey, query }`
  - [x] Default `retries: 3` for GET, `retries: 0` for writes
  - [x] **Synchronously throw `ApiUsageError`** if `method ∈ {POST, PUT, DELETE}` AND `retries > 0` AND no `idempotencyKey` provided. Implemented via a non-async wrapper (`_request`) that runs the safety check, then delegates to `_requestAsync` — because a `throw` inside an `async` function becomes a rejected promise, not a synchronous throw.
  - [x] Resolve base URL once at module init: `window.APP_CONFIG?.API_BASE_URL ?? '/api/v1'` (with a `_resetBaseUrl()` escape hatch for tests)
  - [x] UMD-style footer: attaches `window.ApiClient`
- [x] Update `public/html/*.html` to load `<script src="/api-client.js">` before consumers (asset-loader.js, asset-loader-state.js, submit.html)
- [x] Refactor `public/frontend.js`:
  - [x] Delete `fetchWithTimeout`, `isRetryableError`, `delay`, `validateApiResponse` (≈155 LOC gone)
  - [x] Replace 4 GET call sites with `api.get(...)` calls
- [x] Refactor `public/html/state.js`:
  - [x] Delete the duplicate `fetchWithTimeout`, `isRetryableError`, `delay`, `FETCH_TIMEOUT_MS`/`MAX_RETRIES`/`RETRY_DELAY_MS`, `API_BASE_URL` (≈110 LOC gone)
  - [x] Replace 2 GET call sites with `api.get(...)` calls (also simplified `loadBackendConfig`)
- [x] Refactor `public/submit.js`:
  - [x] Delete the ad-hoc `API_BASE_URL` host-sniff (was line 1–4)
  - [x] Replace 1 GET + 2 writes with `api.get(...)` / `api.post(...)` / `api.put(...)`
  - [x] **Generate a UUID `idempotencyKey` per form-submit attempt** — `generateIdempotencyKey()` uses `crypto.randomUUID()` (with a Math.random v4 fallback). Called once per `handleAddSubmit` / `handleUpdateSubmit` invocation; ApiClient's internal retries reuse the same key, but a new user submission gets a new key.
- [x] Tests (`tests/unit/api-client.test.js`, 24 cases):
  - [x] MSW handler verifies envelope unwrap
  - [x] Retry happens N times on 5xx; gives up after `retries`; throws `ApiHttpError` with `.status`
  - [x] 4xx never retried (one attempt only)
  - [x] 429 retried; network failure retried; `HttpResponse.error()` → `ApiNetworkError`
  - [x] `api.post('/x', body, { retries: 3 })` without `idempotencyKey` throws `ApiUsageError` **synchronously** — verified with `fetchSpy` that `fetch` was NOT called
  - [x] `api.post(... { retries: 3, idempotencyKey })` works; `Idempotency-Key` header sent
  - [x] `api.post(... { retries: 0 })` and `api.delete(... { retries: 0 })` work without key
  - [x] Timeout → `ApiTimeoutError`; caller-supplied AbortSignal → `ApiNetworkError`
  - [x] 2xx + `{success: false}` → `ApiEnvelopeError`
  - [x] Non-JSON / missing envelope → `ApiParseError`
  - [x] Base URL resolves from `window.APP_CONFIG.API_BASE_URL`, strips trailing slash, defaults to `/api/v1`
  - [x] Query params appended; empty/null values dropped
  - [x] Caller headers merged over defaults; `Content-Type` set on writes

---

## 3. Explicit pub/sub Store (candidate #5)

After #2 (ApiClient) lands so the views' fetch concerns are already simplified. Honours ADR-0001 (this repo): explicit pub/sub, not Proxy, not atoms.

- [ ] Create `public/lib/lru-map.js` — `class LruMap` with `get`, `set`, `has`, `delete`, size cap + LRU eviction (~30 LOC)
- [ ] Create `public/store.js`:
  - [ ] `createStore(initialState)` factory
  - [ ] Five-method interface: `get(key)`, `set(key, value)`, `update(key, prev => next)`, `subscribe(key, fn) → unsubscribe()`, `snapshot() → readonly clone`
  - [ ] Shallow-equality rule on `set`: no-op if shallow-equal to current
  - [ ] `update` is the safe mutation path — receives `prev`, returns `next`, always produces a new reference for collections
  - [ ] Synchronous notification in registration order
  - [ ] Subscribe on unknown key throws (typo guard — initialState defines the schema)
  - [ ] `set` on unknown key throws
  - [ ] **No `subscribeAll`** — deliberately omitted to discourage "re-render everything" anti-pattern
  - [ ] **No `transaction`/`batch`** — premature; add when a real ordering case appears
- [ ] Refactor `public/frontend.js`:
  - [ ] Construct an index-page store with schema `{ dataCache: new LruMap(MAX), loadingStates: new Set(), availableStates: [], lastSearchResults: null, loadMoreState: {shops: [], currentlyShowing: 0} }`
  - [ ] Replace the `state` object (lines 76–99) with store accesses
  - [ ] Replace `stateUtils.setCacheEntry / addLoadingState / cleanupLoadingStates / clearResultsElements / resetLoadMoreState` (lines 102–143) with `store.update(...)` calls
  - [ ] Move `dom`, `resultsElements`, `gridColumns`, `resizeTimeout` OUT of state — they're rendering concerns; keep them as module-locals in the view layer
  - [ ] Add per-key subscribers: `store.subscribe('dataCache', renderStateCards)`, `store.subscribe('loadMoreState', renderResults)`, etc.
- [ ] Refactor `public/html/state.js`:
  - [ ] Construct a state-detail store with schema `{ shops: [], loading: false, error: null }`
  - [ ] Replace inline loading flags + error state with store accesses
- [ ] Tests:
  - [ ] State transitions without a DOM
  - [ ] `set` with shallow-equal value does not notify
  - [ ] `update` produces a new reference and notifies
  - [ ] Subscribers fire in registration order
  - [ ] Subscribe on unknown key throws

---

## Review (fill in after implementation)

### Section 1 — Enums + constants.js split (frontend half)

- **Files before**: `public/constants.js` (298 LOC) doing 4 jobs: enums, helpers, SW registration, connection banner. Tests: 14 files (~420 cases, 14 skipped).
- **Files after**: 4 cohesive modules — `public/enums.js` (verbatim mirror of backend, 167 LOC), `public/skeleton.js` (~40 LOC, DOM helper), `public/service-worker-registration.js` (37 LOC), `public/connection-banner.js` (89 LOC). Old `constants.js` deleted; old `dist/constants.min.js` deleted; new minified bundles produced. Tests: 14 files, 405 passing + 14 skipped + 1 pre-existing happy-dom Cache-API failure in `sw.test.js` that is **unrelated** (confirmed by stashing my diff and reproducing).
- **Fail-loud wiring**: `frontend.js`, `state.js`, `submit.js` now `throw` if `window.CoffeeShopEnums` (or `window.CoffeeShopSkeleton`) is missing. The asset-loader sets `script.async = false` on the deps so they execute in insertion order — the dynamically-inserted-script ordering gotcha is documented in a comment.
- **Drift check**: `.github/workflows/enums-drift.yml` curls `https://raw.githubusercontent.com/lookgugu/localcoffeeshop-backend/main/src/enums.js` and `diff -q` against `public/enums.js`. Run on `push` and `pull_request`.

### Section 2 — ApiClient (candidate #4)

- **New file**: `public/api-client.js` (282 LOC including license-block comments; minified to 3.7KB).
- **LOC deleted across consumers**: 345 lines removed, 115 lines added across `frontend.js`, `html/state.js`, `submit.js` (net **−230 LOC**). Two copies of `fetchWithTimeout` (one with options-argument variant in `frontend.js`, the lighter copy in `state.js`) and their `isRetryableError`/`delay`/timeout-constants posses are gone; so are `validateApiResponse` in `frontend.js`, the ad-hoc `API_BASE_URL` host-sniff in `submit.js`, and the manual `result.success` checks in the form handlers.
- **Idempotency key strategy**: `submit.js#generateIdempotencyKey()` is called once per form-submit handler invocation (`handleAddSubmit` / `handleUpdateSubmit`). The ApiClient's *internal* retries (5xx / timeout / network) reuse the SAME key, so the backend can dedup; a user-initiated resubmit gets a NEW key by design. `crypto.randomUUID()` is preferred; a Math.random v4-shaped fallback covers legacy environments.
- **Safety-property gotcha**: the synchronous `ApiUsageError` requirement collides with `async function` semantics — a `throw` inside an async body becomes a rejected promise. The fix is a small non-async `_request` wrapper that runs `_assertUsage()` (which is a regular function) and then calls the async `_requestAsync`. Tests verify it by spying on `globalThis.fetch` and asserting `fetch` was never called.
- **Test coverage**: 24 new cases in `tests/unit/api-client.test.js`. Total: **405 → 429 passing** (14 skipped, 1 pre-existing sw.test.js failure unchanged).
- **Build**: `package.json#build:js` now also minifies `api-client.js` → `dist/api-client.min.js`.

### Lessons learned (candidates for `tasks/lessons.md`)

- **`"type": "module"` + UMD `.js` shim**: when a package sets `"type": "module"`, `require()` of a `.js` UMD file no longer takes the CJS branch (no `module.exports` in scope), and `import 'side-effect.js'` runs through Vite's CJS interop which captures `module.exports` but never touches `window`. Solution: `import enums from './enums.js'` (default import) gives you the same object the CJS branch produces; assign it to `window.CoffeeShopEnums` explicitly in tests that mimic browser-shaped lookups.
- **Dynamically inserted `<script>` defaults to `async: true`**: ordering is NOT guaranteed unless you set `script.async = false`. Critical when one script attaches a global that the next script throws on if missing.
- **`throw` inside `async function` is NOT synchronous**: it becomes a rejected promise. If a contract demands a synchronous throw (e.g. an interface-misuse guard intended to fail at code-review time), the check must live in a non-async wrapper that runs *before* the async body. Test with a `fetch` spy + `expect(() => fn()).toThrow()` (not `await expect(fn()).rejects.toThrow()`).

### Open follow-ups

- Backend repo needs to land its matching `src/enums.js` + the same drift-check workflow on its side. Once both are merged, the workflows will keep them locked.
- `public/html/index2.html` is a legacy self-contained page with its own inlined `getPriceLevelClass` / `formatPriceLevel` and direct JSON-file fetches — left untouched (it's outside the candidate #2 scope and the rest of the site doesn't link to it).
- Pre-existing `tests/service-worker/sw.test.js` "should not cache non-GET requests" failure: happy-dom's Cache API matches POST against GET. Worth a separate bug.
