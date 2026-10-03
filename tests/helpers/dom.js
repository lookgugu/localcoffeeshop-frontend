/**
 * DOM interaction helpers for integration tests
 */

export function click(element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function keydown(element, key) {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

export function input(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export function change(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Flush pending microtasks and a macrotask so async DOM updates land.
 */
export async function waitForAsyncUpdates() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Poll for an element matching `selector` until it appears or `timeout` ms elapse.
 */
export async function waitForElement(selector, { timeout = 1000, interval = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const el = document.querySelector(selector);
    if (el) return el;
    if (Date.now() - start >= timeout) {
      throw new Error(`Timed out waiting for element: ${selector}`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
