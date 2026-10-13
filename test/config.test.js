import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseServerUrl } from '../src/config.js';

test('the address: a bare IP or name, or the URL copied from the browser', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10');
  assert.equal(parseServerUrl(' tower.local:8080 '), 'http://tower.local:8080');
  assert.equal(parseServerUrl('https://192.0.2.10/Dashboard'), 'https://192.0.2.10');
  assert.equal(
    parseServerUrl('https://192-0-2-10.abcdef.myunraid.net/Main'),
    'https://192-0-2-10.abcdef.myunraid.net',
  );
  assert.equal(parseServerUrl('http://[2001:db8::10]:8080'), 'http://[2001:db8::10]:8080');
});

test('unusable addresses, and credentials in an address, are refused', () => {
  for (const raw of [
    '',
    '   ',
    'ftp://192.0.2.10',
    'http://',
    'http://root:secret@192.0.2.10',
    42,
  ]) {
    assert.equal(parseServerUrl(raw), null, String(raw));
  }
});

test('the defaults, then a full configuration', () => {
  assert.deepEqual(normalizeConfig({}), {
    server: null,
    invalidUrl: false,
    missingKey: false,
    allowSelfSigned: false,
    pollIntervalMs: 60_000,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
  const config = normalizeConfig({
    url: 'https://192.0.2.10',
    api_key: '  a1b2c3  ',
    name: '  NAS  ',
    allow_self_signed: 'true',
    poll_interval: '15',
    language: 'de',
  });
  assert.deepEqual(config.server, {
    slot: 1,
    url: 'https://192.0.2.10',
    apiKey: 'a1b2c3',
    name: 'NAS',
  });
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.pollIntervalMs, 15_000);
  assert.equal(config.language, 'de');
});

test('what is missing is said: a bad address, no key', () => {
  assert.equal(normalizeConfig({ url: 'ftp://x', api_key: 'k' }).invalidUrl, true);
  const noKey = normalizeConfig({ url: '192.0.2.10' });
  assert.equal(noKey.server, null);
  assert.equal(noKey.missingKey, true);
  // An interval or a language outside the lists falls back to the default.
  const odd = normalizeConfig({
    url: '192.0.2.10',
    api_key: 'k',
    poll_interval: '7',
    language: 'it',
  });
  assert.equal(odd.pollIntervalMs, 60_000);
  assert.equal(odd.language, 'fr');
});
