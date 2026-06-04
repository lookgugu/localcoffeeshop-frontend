# ADR-0001 — Explicit pub/sub for frontend state, not Proxy or atoms

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

When consolidating scattered state across `frontend.js`, `html/state.js`, and `script.js` into a single Store module per page (see report candidate #5), three reactivity paradigms were considered:

1. **Explicit pub/sub** — `store.update(key, prev => next)` and `store.subscribe(key, fn)`. Subscribers fire on shallow-equality-detected change.
2. **Reactive Proxy** — `store.shops = [...]` is the mutation. A `Proxy` traps assignment and notifies subscribers automatically.
3. **Signals / atoms** — each state value is its own observable (`shopsAtom = atom([])`). Subscribers attach per-atom; structural prevention of over-rendering.

## Decision

We use the explicit pub/sub paradigm. The Store exposes a five-method interface: `get`, `set`, `update`, `subscribe`, `snapshot`. Mutations to collections must produce new references via `update(key, prev => ...)`; in-place mutation followed by `set(key, sameRef)` is a no-op by design.

`subscribeAll` is deliberately omitted to discourage the "re-render everything on any change" anti-pattern that motivated this consolidation in the first place.

## Reasoning

The deciding criterion is **dependency-graph greppability** at this app's scale:

- `grep "store.update('shops'" public/` enumerates every writer of the `shops` key.
- `grep "store.subscribe('shops'" public/` enumerates every reader.

The Proxy design fails this test — `store.shops = ...` and `const x = store.shops` share syntax with reads, so writers cannot be enumerated by a single grep. Debugging "who wrote to this key?" becomes harder.

The atoms design preserves greppability per atom, but at this app's size (~7 state keys per page, 2 pages, no SPA, no bundler) the structural protection against over-rendering doesn't earn its rent:

- The dependency graph is small enough to read manually.
- File proliferation (one atom per file, or careful namespace bundling) fights the no-bundler delivery story.
- There is no single inspectable state object — debugging via `console.log(store.snapshot())` is no longer possible.

The Proxy design has well-documented silent failure modes that require dev-mode `Object.freeze` guards to be safe: in-place nested mutation, `arr.push()`, `=== $raw` mismatches, `structuredClone` issues. The mitigation amounts to admitting the interface is unsafe by default. The explicit pub/sub design has only one failure mode — "forgot to subscribe" — and it surfaces as a visible stale screen during manual testing.

## The shallow-equality + immutable-update contract

The Store's interface is load-bearing on one rule:

> Collections must be replaced as new references via `update(key, prev => ...)`. In-place mutation followed by `set(key, sameRef)` no-ops.

Without this rule, notification becomes a lie — a developer could `state.shops.push(x)` and `store.set('shops', state.shops)` and silently fail to notify subscribers. With it, the act of producing a new value is the act of notifying.

This is documented in JSDoc on `set` and `update`.

## Consequences

**Easier:**
- Dependency graph is enumerable with grep — supports AI-navigability and human onboarding.
- Tests are pure: `store.update('shops', () => fixtures); expect(spy).toHaveBeenCalledOnce()`. No DOM needed.
- Stale-screen bugs surface in the first manual test.
- Single inspectable state object via `snapshot()`.

**Harder:**
- More keystrokes per mutation than the Proxy alternative.
- Per-renderer granularity is discipline-based, not structural — a developer could still write a single subscriber that re-reads everything.
- Two pages with different state shapes means two store schemas (not a single global type).

## When to revisit

Reopen this decision if any of the following becomes true:

- A third page is added, or the existing pages grow to >20 state keys each — the atoms design's structural protection starts to earn its rent.
- A real over-render bug is shipped because someone wrote `subscribe('a', () => renderEverything())` and got away with it — discipline failed; we need structural protection.
- The app migrates to an SPA with shared state across routes — the per-page Store model breaks down.
- A bundler is introduced — the file-proliferation cost of atoms drops, changing the trade calculus.
