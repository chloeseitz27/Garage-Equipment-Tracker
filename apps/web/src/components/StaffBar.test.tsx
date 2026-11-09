import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});
const { createRoot } = await import('react-dom/client');
const { StaffBar } = await import('./StaffBar.js');

const originalFetch = globalThis.fetch;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  globalThis.fetch = originalFetch;
});
after(() => dom.window.close());

const signInWith = async (respond: () => Promise<Response>): Promise<string | undefined> => {
  globalThis.fetch = respond;
  await act(() => root.render(createElement(StaffBar, { staff: false, onChange: () => {} })));
  const open = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Staff sign in');
  await act(() => { open?.click(); });
  const submit = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Sign in');
  await act(async () => { submit?.click(); });
  return host.querySelector('[role="alert"]')?.textContent ?? undefined;
};

test('a rejected passphrase reports an incorrect passphrase', async () => {
  const message = await signInWith(async () => Response.json({ error: 'Incorrect passphrase' }, { status: 401 }));
  assert.equal(message, 'Incorrect passphrase');
});

test('network failures and proxy errors report an API connection failure', async () => {
  for (const respond of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => new Response('', { status: 502 }),
    async () => new Response('Error occurred while trying to proxy', { status: 500 }),
  ]) {
    const message = await signInWith(respond);
    assert.match(message ?? '', /Could not connect to the API/);
    assert.doesNotMatch(message ?? '', /passphrase/i);
    await act(() => root.render(createElement('div')));
  }
});

test('other API errors show the server message', async () => {
  const message = await signInWith(async () => Response.json({ error: 'Too many sign-in attempts' }, { status: 429 }));
  assert.equal(message, 'Too many sign-in attempts');
});
