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

- [x] Create `public/lib/lru-map.js` — `class LruMap` with `get`, `set`, `has`, `delete`, size cap + LRU eviction (~30 LOC) — 87 LOC actual, including JSDoc + UMD shim
- [x] Create `public/store.js`:
  - [x] `createStore(initialState)` factory
  - [x] Five-method interface: `get(key)`, `set(key, value)`, `update(key, prev => next)`, `subscribe(key, fn) → unsubscribe()`, `snapshot() → readonly clone`
  - [x] Shallow-equality rule on `set`: no-op if shallow-equal to current
  - [x] `update` is the safe mutation path — receives `prev`, returns `next`, always produces a new reference for collections
  - [x] Synchronous notification in registration order
  - [x] Subscribe on unknown key throws (typo guard — initialState defines the schema)
  - [x] `set` on unknown key throws
  - [x] **No `subscribeAll`** — deliberately omitted to discourage "re-render everything" anti-pattern
  - [x] **No `transaction`/`batch`** — premature; add when a real ordering case appears
- [x] Refactor `public/frontend.js`:
  - [x] Construct an index-page store with schema `{ dataCache: new LruMap(MAX), loadingStates: new Set(), availableStates: [], lastSearchResults: null, loadMoreState: {shops: [], currentlyShowing: 0} }`
  - [x] Replace the `state` object (lines 76–99) with store accesses
  - [x] Replace `stateUtils.setCacheEntry / addLoadingState / cleanupLoadingStates / clearResultsElements / resetLoadMoreState` (lines 102–143) with `store.update(...)` calls
  - [x] Move `dom`, `resultsElements`, `gridColumns`, `resizeTimeout`, `searchTimeout` OUT of state — they're rendering concerns; kept as module-locals in the view layer
  - [x] Added per-key subscribers: `store.subscribe('availableStates', createStateGrid)`, `store.subscribe('lastSearchResults', displayResults)`
- [x] Refactor `public/html/state.js`:
  - [x] Construct a state-detail store with schema `{ shops: null, loading: false, error: null }` (shops starts null so a successful empty load notifies)
  - [x] Replace inline loading flags + error state with store accesses
  - [x] Subscribers: `shops → renderShops`, `loading → toggleSkeletonLoading`, `error → showOrHideError`
- [x] Asset loaders updated (`asset-loader.js` injects lru-map + store before frontend; `asset-loader-state.js` injects store before state.js)
- [x] `package.json#build:js` minifies the new files (`store.min.js`, `lru-map.min.js`)
- [x] Tests:
  - [x] State transitions without a DOM (`tests/unit/store.test.js`, 28 cases)
  - [x] `set` with shallow-equal value does not notify
  - [x] `update` produces a new reference and notifies
  - [x] Subscribers fire in registration order
  - [x] Subscribe on unknown key throws
  - [x] Map/Set values ALWAYS notify (the load-bearing contract)
  - [x] LruMap (`tests/unit/lib/lru-map.test.js`, 17 cases): eviction, recency-bump on get, iteration order

---

### Section 3 — Explicit pub/sub Store (candidate #5)

- **New files**: `public/store.js` (155 LOC including JSDoc / UMD shim; minified to 1.7KB) and `public/lib/lru-map.js` (87 LOC; minified to ~0.9KB).
- **Refactor scope**:
  - `public/frontend.js`: the original `state` object (lines 57–80) + `stateUtils` (lines 83–124) were ~70 LOC of mixed app state + rendering concerns. The new store schema is 7 lines (5 keys); rendering concerns moved to ~10 lines of module-local declarations (`searchTimeout`, `resizeTimeout`, `gridColumns`, `resultsElements`, `dom`). The mutation helpers vanish — `stateUtils.setCacheEntry` became one `store.update('dataCache', ...)` call inline at the only callsite; the rest similarly inlined. Net file size unchanged (~972 LOC; the savings were eaten by extra comments documenting the Map/Set notification rule).
  - `public/html/state.js`: split the monolithic `loadCoffeeShops` into a thin fetcher (`loadStateShops`) that writes the store and three renderers (`renderShops`, `toggleSkeletonLoading`, `showOrHideError`) wired via subscribers. File grew from 239 → 302 LOC because the renderer functions are now named/separated rather than inlined.
- **Subscribers wired**:
  - Index page (`frontend.js`):
    - `availableStates → createStateGrid`
    - `lastSearchResults → displayResults`
  - State-detail page (`html/state.js`):
    - `shops → renderShops`
    - `loading → toggleSkeletonLoading`
    - `error → showOrHideError`
- **Shallow-equality + Map/Set contract**: the load-bearing rule from ADR-0001. Map and Set values are checked BEFORE `Object.is` short-circuit so that the common `update('cache', m => { m.set(k, v); return m; })` pattern still notifies subscribers. Without this ordering, in-place mutation followed by handing back the same reference would silently no-op. This is covered by two dedicated test cases (`Map values ALWAYS notify…` and `Set values ALWAYS notify…`).
- **Tests**: 45 new cases (28 store + 17 lru-map). Total before: 429 passing + 14 skipped + 1 pre-existing sw.test.js failure. Total after: **474 passing + 14 skipped + 1 pre-existing failure** (unchanged).
- **Build**: `npm run build:js` succeeds; `dist/store.min.js` (1.7KB) and `dist/lru-map.min.js` (0.9KB) produced.
- **What was deliberately NOT done** (per ADR-0001):
  - No `subscribeAll` method
  - No Proxy-based reactivity
  - No per-atom signal system
  - No `transaction`/`batch` API

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
