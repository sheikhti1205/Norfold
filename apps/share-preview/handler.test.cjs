const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleShare, validConfig } = require('./handler.cjs');

const id = 'aaaaaaaa-1234-1234-1234-123456789abc';
const config = { url: 'https://example.supabase.co', key: 'sb_publishable_test', origin: 'https://findbackapp.social', css: '' };
const preview = { id, type: 'FOUND', title: 'Wallet', category: 'Bags & Wallets', event_month: null, excerpt: 'A found item report. Sign in to compare the details and contact the person who posted it.' };

test('uppercase IDs have the same successful preview as lowercase IDs', async () => {
  assert.equal(validConfig(config), true);
  const calls = [];
  const http = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify([preview]));
  };
  const request = value => ({ method: 'GET', url: `https://findbackapp.social/api/share/${value}?format=json`, params: { id: value } });
  const lower = await handleShare(request(id), config, http);
  const upper = await handleShare(request(id.toUpperCase()), config, http);
  assert.equal(lower.status, 200);
  assert.deepEqual(upper, lower);
  assert.deepEqual(calls, [{ p_post_id: id }, { p_post_id: id }]);
});

test('malformed IDs are rejected without a lookup', async () => {
  const response = await handleShare({ method: 'GET', url: 'https://findbackapp.social/api/share/invalid', params: { id: 'invalid' } }, config, () => { throw new Error('unexpected lookup'); });
  assert.equal(response.status, 404);
});
