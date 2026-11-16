import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimpleCookieStore } from '../../../server/platform/cookies.js';

describe('Cookie Store', () => {
  test('parses cookie header string', () => {
    const store = new SimpleCookieStore('csrftoken=abc123token; sessionid=sess456xyz; other=value');
    assert.equal(store.get('csrftoken'), 'abc123token');
    assert.equal(store.get('sessionid'), 'sess456xyz');
    assert.equal(store.get('other'), 'value');
  });

  test('applies set-cookie lines with path and flags', () => {
    const store = new SimpleCookieStore();
    store.applySetCookie([
      'csrftoken=newcsrf789; expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; Secure; SameSite=Lax',
      'sessionid=newsess999; HttpOnly; Path=/',
    ]);
    assert.equal(store.get('csrftoken'), 'newcsrf789');
    assert.equal(store.get('sessionid'), 'newsess999');
    assert.equal(store.toActiveCookie(), 'csrftoken=newcsrf789; sessionid=newsess999');
  });

  test('clears and modifies cookies correctly', () => {
    const store = new SimpleCookieStore('a=1; b=2');
    store.delete('a');
    assert.equal(store.get('a'), undefined);
    assert.equal(store.get('b'), '2');
    store.clear();
    assert.equal(store.headerString(), '');
  });
});
