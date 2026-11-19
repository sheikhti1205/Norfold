import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractMetadata, validatePreviewImage } = require('../apps/share-preview/lib/metadata.cjs');

const page = (head) => Buffer.from(`<!doctype html><html><head>${head}</head><body><p>body</p></body></html>`);

const png = (width, height, extra = 0) => {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return Buffer.concat([header, Buffer.alloc(extra)]);
};

const jpeg = (width, height) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
};

const vp8lPayload = (width, height) => {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  const bits = (((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)) >>> 0;
  payload.writeUInt32LE(bits, 1);
  return payload;
};

const vp8Payload = (width, height) => Buffer.from([
  0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a,
  width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff,
]);

const vp8xPayload = (width, height, flags = 0) => {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  const w = width - 1;
  const h = height - 1;
  payload[4] = w & 0xff;
  payload[5] = (w >> 8) & 0xff;
  payload[6] = (w >> 16) & 0xff;
  payload[7] = h & 0xff;
  payload[8] = (h >> 8) & 0xff;
  payload[9] = (h >> 16) & 0xff;
  return payload;
};

const webp = (chunks) => {
  const parts = [];
  for (const [name, payload] of chunks) {
    const header = Buffer.alloc(8);
    header.write(name, 0, 'latin1');
    header.writeUInt32LE(payload.length, 4);
    const padded = payload.length + (payload.length & 1);
    parts.push(header, payload, Buffer.alloc(padded - payload.length));
  }
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
};

test('Open Graph wins over Twitter and the document title', () => {
  const head = `<title>Doc fallback</title>
<meta property="og:title" content="OG title">
<meta name="twitter:title" content="Twitter title">
<meta property="og:description" content="OG description">
<meta name="description" content="Name description">
<meta name="twitter:description" content="Twitter description">
<meta property="og:image:secure_url" content="https://cdn.example.test/secure.png">
<meta property="og:image" content="https://cdn.example.test/og.png">
<meta name="twitter:image" content="https://cdn.example.test/twitter.png">
<meta property="og:site_name" content="Example Site">`;
  assert.deepEqual(extractMetadata(page(head), { contentType: 'text/html; charset=utf-8', finalUrl: 'https://example.test/story' }), {
    title: 'OG title',
    description: 'OG description',
    siteName: 'Example Site',
    imageUrl: 'https://cdn.example.test/secure.png',
  });
});

test('Twitter metadata and the title element fill the gaps without inventing fields', () => {
  const twitter = extractMetadata(page('<meta name="twitter:title" content="Twitter only"><meta name="twitter:description" content="Twitter description"><meta name="twitter:image" content="cover/twitter.png">'), {
    contentType: 'text/html; charset=utf-8',
    finalUrl: 'https://example.test/a/story',
  });
  assert.deepEqual(twitter, {
    title: 'Twitter only',
    description: 'Twitter description',
    imageUrl: 'https://example.test/a/cover/twitter.png',
  });
  const titleOnly = extractMetadata(page('<title>  Plain &amp; Simple  </title>'));
  assert.deepEqual(titleOnly, { title: 'Plain & Simple' });
  const named = extractMetadata(page('<meta name="description" content="Name only"><meta name="twitter:description" content="Twitter description">'));
  assert.equal(named.description, 'Name only');
  assert.equal(named.title, null);
});

test('quoted attribute values may contain > and the opposite quote character', () => {
  const head = `<meta property="og:title" content="A > B and <i>markup</i>"><meta property="og:description" content='Single "quoted" > value'>`;
  const metadata = extractMetadata(page(head));
  assert.equal(metadata.title, 'A > B and markup');
  assert.equal(metadata.description, 'Single "quoted" > value');
});

test('comments, scripts, styles, noscript and template content never become metadata', () => {
  const head = `
<!-- <meta property="og:title" content="Comment decoy"> -->
<script>var markup = '<meta property="og:title" content="Script decoy">';</script>
<style>.x::before{content:"<meta property='og:title' content='Style decoy'>"}</style>
<noscript><meta property="og:title" content="Noscript decoy"></noscript>
<template><meta property="og:title" content="Template decoy"></template>
<meta property="og:title" content="Real title">`;
  assert.equal(extractMetadata(page(head)).title, 'Real title');
});

test('tag and attribute names are case-insensitive and the first value wins', () => {
  const head = '<META PROPERTY="OG:TITLE" CONTENT="First mixed"><Meta Property="og:title" Content="Second"><meta name="og:title" content="Third">';
  assert.equal(extractMetadata(page(head)).title, 'First mixed');
});

test('text decodes named and numeric entities and drops controls, bidi and invisible characters', () => {
  const metadata = extractMetadata(page('<meta property="og:title" content="  A\u0000\u0007&amp;B\u200B\u202E C&#x1F600;  ">'));
  assert.equal(metadata.title, 'A&B C\u{1F600}');
  const invalid = extractMetadata(page('<meta property="og:title" content="x&#xD800;y">'));
  assert.equal(invalid.title, 'x&#xD800;y');
  const singleDecode = extractMetadata(page('<meta property="og:title" content="&amp;amp; &amp;lt;b&amp;gt;">'));
  assert.equal(singleDecode.title, '&amp; &lt;b&gt;');
});

test('title, description and site name truncate by code point', () => {
  const truncated = extractMetadata(page('<meta property="og:title" content="' + 'T'.repeat(400) + '"><meta property="og:description" content="' + 'D'.repeat(700) + '"><meta property="og:site_name" content="' + 'S'.repeat(100) + '">'));
  assert.equal(truncated.title, 'T'.repeat(300));
  assert.equal(truncated.description, 'D'.repeat(600));
  assert.equal(truncated.siteName, 'S'.repeat(80));
  const astral = extractMetadata(page('<meta property="og:title" content="' + '\u{1F600}'.repeat(400) + '">'));
  assert.equal(astral.title, '\u{1F600}'.repeat(300));
  assert.equal(Array.from(astral.title).length, 300);
});

test('relative image URLs resolve against the final URL and keep query separators', () => {
  const finalUrl = 'https://example.test/news/story?id=7';
  const absolute = extractMetadata(page('<meta property="og:image" content="/img/cover.png?w=1&amp;h=2">'), { finalUrl });
  assert.equal(absolute.imageUrl, 'https://example.test/img/cover.png?w=1&h=2');
  const relative = extractMetadata(page('<meta property="og:image" content="cover.png">'), { finalUrl });
  assert.equal(relative.imageUrl, 'https://example.test/news/cover.png');
  const protocolRelative = extractMetadata(page('<meta property="og:image" content="//cdn.example.test/x.png">'), { finalUrl });
  assert.equal(protocolRelative.imageUrl, 'https://cdn.example.test/x.png');
  assert.equal(extractMetadata(page('<meta property="og:image" content="cover.png">')).imageUrl, undefined);
});

test('unsafe and overlong image URLs are omitted without losing the rest of the metadata', () => {
  const unsafe = extractMetadata(page('<meta property="og:title" content="Title"><meta property="og:image" content="javascript:alert(1)">'));
  assert.equal(unsafe.title, 'Title');
  assert.equal(unsafe.imageUrl, undefined);
  const overlong = extractMetadata(page('<meta property="og:image" content="https://example.test/' + 'a'.repeat(2100) + '">'));
  assert.equal(overlong.imageUrl, undefined);
});

test('oversize HTML throws the fixed code and the maximum size itself is accepted', () => {
  let thrown;
  try {
    extractMetadata(Buffer.alloc(524289));
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown);
  assert.equal(thrown.code, 'HTML_TOO_LARGE');
  assert.doesNotMatch(thrown.message, /https?:\/\//);
  assert.deepEqual(extractMetadata(Buffer.alloc(524288)), { title: null });
});

test('tag count and per-tag length stay bounded while later valid tags still parse', () => {
  const filler = '<meta name="filler" content="x">'.repeat(4100);
  assert.equal(extractMetadata(Buffer.from(filler + '<meta property="og:title" content="Too late">')).title, null);
  const giant = '<div data-x="' + 'a'.repeat(5000) + '"><meta property="og:title" content="After giant">';
  assert.equal(extractMetadata(page(giant)).title, 'After giant');
});

test('malformed or partial HTML returns the best available safe result', () => {
  assert.deepEqual(extractMetadata(Buffer.from('<meta property="og:title" content="Cut title')), { title: null });
  assert.equal(extractMetadata(Buffer.from('<title>Fine</title><div')).title, 'Fine');
  assert.equal(extractMetadata(Buffer.from('<meta property="og:title" content=unquoted><meta name=description content="Broken')).title, 'unquoted');
  assert.deepEqual(extractMetadata(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x3c])), { title: null });
});

test('charset comes from the content type or the first 1024 bytes and otherwise defaults to UTF-8', () => {
  const latin = Buffer.from('<title>Caf\xe9 \x92</title>', 'latin1');
  assert.equal(extractMetadata(latin, { contentType: 'text/html; charset=windows-1252' }).title, 'Caf\u00e9 \u2019');
  const sniffed = Buffer.from('<meta charset="windows-1252"><title>Caf\xe9 \x92</title>', 'latin1');
  assert.equal(extractMetadata(sniffed).title, 'Caf\u00e9 \u2019');
  assert.equal(extractMetadata(Buffer.from('<title>Ünicode \u{1F600}</title>')).title, 'Ünicode \u{1F600}');
  assert.equal(extractMetadata(Buffer.from('<title>Plain</title>'), { contentType: 'text/html; charset=shift_jis' }).title, 'Plain');
});

test('PNG, JPEG and static WebP headers are accepted from magic bytes alone', () => {
  assert.deepEqual(validatePreviewImage(png(1, 1)), { mime: 'image/png', width: 1, height: 1 });
  assert.deepEqual(validatePreviewImage(jpeg(2, 3)), { mime: 'image/jpeg', width: 2, height: 3 });
  assert.deepEqual(validatePreviewImage(webp([['VP8L', vp8lPayload(4, 5)]])), { mime: 'image/webp', width: 4, height: 5 });
  assert.deepEqual(validatePreviewImage(webp([['VP8 ', vp8Payload(8, 9)]])), { mime: 'image/webp', width: 8, height: 9 });
  assert.deepEqual(validatePreviewImage(webp([['VP8X', vp8xPayload(6, 7)], ['VP8L', vp8lPayload(6, 7)]])), { mime: 'image/webp', width: 6, height: 7 });
});

test('animated, truncated and dimensionally invalid images return null', () => {
  assert.equal(validatePreviewImage(webp([['VP8X', vp8xPayload(10, 10, 0x02)], ['ANMF', Buffer.alloc(16)]])), null);
  assert.equal(validatePreviewImage(webp([['VP8X', vp8xPayload(10, 10)], ['ANIM', Buffer.alloc(6)], ['VP8L', vp8lPayload(10, 10)]])), null);
  assert.deepEqual(validatePreviewImage(webp([['VP8X', vp8xPayload(10, 10, 0x10)], ['VP8L', vp8lPayload(10, 10)]])), { mime: 'image/webp', width: 10, height: 10 });
  assert.equal(validatePreviewImage(png(10, 10).subarray(0, 20)), null);
  assert.equal(validatePreviewImage(jpeg(10, 10).subarray(0, 8)), null);
  assert.equal(validatePreviewImage(webp([['VP8L', vp8lPayload(10, 10)]]).subarray(0, 24)), null);
  assert.equal(validatePreviewImage(png(0, 10)), null);
  assert.equal(validatePreviewImage(jpeg(10, 0)), null);
  const wrongLength = png(1, 1);
  wrongLength.writeUInt32BE(12, 8);
  assert.equal(validatePreviewImage(wrongLength), null);
  const overlargeRiff = webp([['VP8L', vp8lPayload(2, 2)]]);
  overlargeRiff.writeUInt32LE(overlargeRiff.length, 4);
  assert.equal(validatePreviewImage(overlargeRiff), null);
  assert.equal(validatePreviewImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
});

test('dimension and byte caps use declared header values only', () => {
  assert.equal(validatePreviewImage(png(20000, 20000)), null);
  assert.equal(validatePreviewImage(png(4097, 1)), null);
  assert.equal(validatePreviewImage(jpeg(5000, 4000)), null);
  assert.equal(validatePreviewImage(webp([['VP8X', vp8xPayload(20000, 20000)]])), null);
  assert.deepEqual(validatePreviewImage(png(4096, 4096)), { mime: 'image/png', width: 4096, height: 4096 });
  assert.equal(validatePreviewImage(Buffer.alloc(262145)), null);
  assert.deepEqual(validatePreviewImage(png(1, 1, 262144 - 33)), { mime: 'image/png', width: 1, height: 1 });
});

test('non-image bytes are rejected whatever label the caller supplies', () => {
  assert.equal(validatePreviewImage(Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'), 'image/png'), null);
  assert.equal(validatePreviewImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/png'), null);
  assert.equal(validatePreviewImage(Buffer.from('<!doctype html><html></html>'), 'image/jpeg'), null);
  assert.equal(validatePreviewImage(Buffer.from('BM\u0000\u0000'), 'image/webp'), null);
  assert.equal(validatePreviewImage(null), null);
  assert.equal(validatePreviewImage('not a buffer'), null);
  assert.deepEqual(validatePreviewImage(png(1, 1), 'text/html'), { mime: 'image/png', width: 1, height: 1 });
});
