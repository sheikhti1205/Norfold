/* global Buffer, TextDecoder, URL */
// Pure link-preview metadata parsing: no I/O, no HTML rendering, no logging.
// Output is plain data; the caller owns fetch, URL policy and thumbnail transport.

const MAX_HTML_BYTES = 524288;
const MAX_TAGS = 4096;
const MAX_TAG_CHARS = 4096;
const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 600;
const MAX_SITE_NAME_CHARS = 80;
const MAX_IMAGE_URL_CHARS = 2048;
const MAX_IMAGE_BYTES = 262144;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16777216;
const MAX_JPEG_SCAN_BYTES = 65536;
const MAX_JPEG_SEGMENTS = 512;
const MAX_WEBP_CHUNKS = 64;
const HTML_TOO_LARGE = 'HTML_TOO_LARGE';

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript', 'template']);
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const NUMERIC_ENTITY = /^#(?:[xX][0-9a-fA-F]{1,6}|[0-9]{1,7})$/;
const WHITESPACE_RUNS = /\s+/g;

function isRemovedControl(code) {
  if (code === 0x09 || code === 0x0A) return false;
  return code <= 0x1F || (code >= 0x7F && code <= 0x9F);
}

function isInvisible(code) {
  return code === 0x00AD || code === 0x061C || code === 0x180E || code === 0xFEFF
    || (code >= 0x200B && code <= 0x200F)
    || (code >= 0x202A && code <= 0x202E)
    || (code >= 0x2060 && code <= 0x2064)
    || (code >= 0x2066 && code <= 0x206F);
}

function filterChars(value, keep) {
  let output = '';
  let runStart = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index === value.length || !keep(value.charCodeAt(index))) {
      if (index > runStart) output += value.slice(runStart, index);
      runStart = index + 1;
    }
  }
  return output;
}

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00A0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201A',
  ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E',
  laquo: '\u00AB', raquo: '\u00BB', copy: '\u00A9', reg: '\u00AE',
  trade: '\u2122', middot: '\u00B7', bull: '\u2022', deg: '\u00B0',
  plusmn: '\u00B1', times: '\u00D7', divide: '\u00F7',
  frac12: '\u00BD', frac14: '\u00BC', frac34: '\u00BE',
  sup2: '\u00B2', sup3: '\u00B3', euro: '\u20AC', pound: '\u00A3',
  yen: '\u00A5', cent: '\u00A2', sect: '\u00A7', para: '\u00B6',
  dagger: '\u2020', Dagger: '\u2021', permil: '\u2030',
  larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', harr: '\u2194',
});

const META_KEYS = Object.freeze({
  'og:title': 'ogTitle',
  'twitter:title': 'twitterTitle',
  'og:description': 'ogDescription',
  description: 'metaDescription',
  'twitter:description': 'twitterDescription',
  'og:image:secure_url': 'ogImageSecure',
  'og:image': 'ogImage',
  'twitter:image': 'twitterImage',
  'og:site_name': 'ogSiteName',
});

function asBytes(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  return null;
}

function tooLarge() {
  const error = new Error('Preview metadata input exceeds the supported size.');
  error.code = HTML_TOO_LARGE;
  return error;
}

function normalizeCharset(label) {
  if (typeof label !== 'string') return null;
  const value = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (value === 'utf-8' || value === 'utf8' || value === 'us-ascii' || value === 'ascii') return 'utf-8';
  if (value === 'windows-1252' || value === 'cp1252') return 'windows-1252';
  if (value === 'iso-8859-1' || value === 'iso8859-1' || value === 'latin1' || value === 'latin-1') return 'iso-8859-1';
  return null;
}

function headerCharset(contentType) {
  if (typeof contentType !== 'string') return null;
  const match = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType.slice(0, 512));
  return match ? normalizeCharset(match[1]) : null;
}

function sniffCharset(bytes) {
  const head = bytes.toString('latin1', 0, Math.min(bytes.length, 1024));
  const match = /<meta[^>]{0,512}charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i.exec(head);
  return match ? normalizeCharset(match[1]) : null;
}

function decodeHtml(bytes, contentType) {
  const label = headerCharset(contentType) || sniffCharset(bytes) || 'utf-8';
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function lowerAscii(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function isSpaceCode(code) {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isTagNameCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function matchNameAt(html, at, name) {
  if (at + name.length > html.length) return false;
  for (let index = 0; index < name.length; index++) {
    let code = html.charCodeAt(at + index);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== name.charCodeAt(index)) return false;
  }
  if (at + name.length === html.length) return true;
  const next = html.charCodeAt(at + name.length);
  return isSpaceCode(next) || next === 47 || next === 62;
}

function findTagEnd(html, from, limit) {
  const max = Math.min(html.length, from + limit);
  let quote = 0;
  let afterEquals = false;
  for (let index = from; index < max; index++) {
    const code = html.charCodeAt(index);
    if (quote) {
      if (code === quote) quote = 0;
      continue;
    }
    if (code === 62) return index;
    if (code === 34 || code === 39) {
      if (afterEquals) {
        quote = code;
        afterEquals = false;
      }
      continue;
    }
    if (code === 61) {
      afterEquals = true;
      continue;
    }
    if (!isSpaceCode(code)) afterEquals = false;
  }
  return -1;
}

function parseTag(raw) {
  const length = raw.length;
  let index = 0;
  while (index < length && isSpaceCode(raw.charCodeAt(index))) index++;
  const nameStart = index;
  while (index < length) {
    const code = raw.charCodeAt(index);
    if (isSpaceCode(code) || code === 47 || code === 62) break;
    index++;
  }
  if (index === nameStart) return null;
  const name = raw.slice(nameStart, index);
  const attributes = Object.create(null);
  while (index < length) {
    while (index < length && isSpaceCode(raw.charCodeAt(index))) index++;
    if (index >= length) break;
    if (raw.charCodeAt(index) === 47) {
      index++;
      continue;
    }
    const attributeStart = index;
    while (index < length) {
      const code = raw.charCodeAt(index);
      if (isSpaceCode(code) || code === 61 || code === 47 || code === 62) break;
      index++;
    }
    if (index === attributeStart) {
      index++;
      continue;
    }
    const attributeName = lowerAscii(raw.slice(attributeStart, index));
    while (index < length && isSpaceCode(raw.charCodeAt(index))) index++;
    let value = '';
    if (raw.charCodeAt(index) === 61) {
      index++;
      while (index < length && isSpaceCode(raw.charCodeAt(index))) index++;
      const quote = raw.charCodeAt(index);
      if (quote === 34 || quote === 39) {
        index++;
        const valueStart = index;
        while (index < length && raw.charCodeAt(index) !== quote) index++;
        value = raw.slice(valueStart, index);
        if (index < length) index++;
      } else {
        const valueStart = index;
        while (index < length) {
          const code = raw.charCodeAt(index);
          if (isSpaceCode(code) || code === 62) break;
          index++;
        }
        value = raw.slice(valueStart, index);
      }
    }
    if (!(attributeName in attributes)) attributes[attributeName] = value;
  }
  return { name, attributes };
}

function findCloseTag(html, from, name) {
  let position = from;
  while (position < html.length) {
    const open = html.indexOf('<', position);
    if (open < 0) return -1;
    if (html.charCodeAt(open + 1) === 47 && matchNameAt(html, open + 2, name)) return open;
    position = open + 1;
  }
  return -1;
}

function skipRawText(html, from, name) {
  const close = findCloseTag(html, from, name);
  if (close < 0) return html.length;
  const end = html.indexOf('>', close + 2 + name.length);
  return end < 0 ? html.length : end + 1;
}

function applyMeta(found, key, content) {
  const field = META_KEYS[key];
  if (!field || found[field]) return;
  found[field] = content;
}

function parseHtml(html) {
  const found = {
    ogTitle: '', twitterTitle: '', docTitle: '',
    ogDescription: '', metaDescription: '', twitterDescription: '',
    ogImageSecure: '', ogImage: '', twitterImage: '', ogSiteName: '',
  };
  let index = 0;
  let tags = 0;
  let titleSeen = false;
  while (index < html.length && tags < MAX_TAGS) {
    const open = html.indexOf('<', index);
    if (open < 0) break;
    index = open;
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', index)) {
      const end = html.indexOf(']]>', index + 9);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    const next = html.charCodeAt(index + 1);
    if (next === 33 || next === 63) {
      const end = html.indexOf('>', index + 2);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    if (next === 47) {
      const end = html.indexOf('>', index + 2);
      index = end < 0 ? html.length : end + 1;
      tags++;
      continue;
    }
    if (!isTagNameCode(next)) {
      index++;
      continue;
    }
    const end = findTagEnd(html, index + 1, MAX_TAG_CHARS);
    if (end < 0) {
      index = Math.min(html.length, index + 1 + MAX_TAG_CHARS);
      continue;
    }
    const raw = html.slice(index + 1, end);
    tags++;
    index = end + 1;
    const tag = parseTag(raw);
    if (!tag) continue;
    const name = lowerAscii(tag.name);
    if (RAW_TEXT_ELEMENTS.has(name)) {
      index = skipRawText(html, index, name);
      continue;
    }
    if (name === 'title') {
      const close = findCloseTag(html, index, 'title');
      if (!titleSeen) {
        titleSeen = true;
        found.docTitle = close < 0 ? html.slice(index) : html.slice(index, close);
      }
      index = close < 0 ? html.length : close;
      continue;
    }
    if (name === 'meta') {
      const key = lowerAscii(String(tag.attributes.property || tag.attributes.name || '').trim());
      const content = tag.attributes.content;
      if (key && typeof content === 'string') applyMeta(found, key, content);
    }
  }
  return found;
}

function decodeEntities(value) {
  const input = String(value);
  if (input.indexOf('&') < 0) return input;
  let output = '';
  let index = 0;
  while (index < input.length) {
    const amp = input.indexOf('&', index);
    if (amp < 0) {
      output += input.slice(index);
      break;
    }
    output += input.slice(index, amp);
    let semicolon = -1;
    const entityLimit = Math.min(input.length, amp + 33);
    for (let position = amp + 1; position < entityLimit; position++) {
      if (input.charCodeAt(position) === 59) {
        semicolon = position;
        break;
      }
    }
    if (semicolon < 0) {
      output += '&';
      index = amp + 1;
      continue;
    }
    const body = input.slice(amp + 1, semicolon);
    let decoded = null;
    if (body.charCodeAt(0) === 35) {
      if (NUMERIC_ENTITY.test(body)) {
        const hexadecimal = body[1] === 'x' || body[1] === 'X';
        const codePoint = parseInt(hexadecimal ? body.slice(2) : body.slice(1), hexadecimal ? 16 : 10);
        if (codePoint > 0 && codePoint <= 0x10FFFF && (codePoint < 0xD800 || codePoint > 0xDFFF)) {
          decoded = String.fromCodePoint(codePoint);
        }
      }
    } else {
      const entityName = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? body : body.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entityName)) decoded = NAMED_ENTITIES[entityName];
    }
    if (decoded === null) {
      output += '&';
      index = amp + 1;
      continue;
    }
    output += decoded;
    index = semicolon + 1;
  }
  return output;
}

function stripTags(value) {
  if (value.indexOf('<') < 0) return value;
  let output = '';
  let index = 0;
  while (index < value.length) {
    const open = value.indexOf('<', index);
    if (open < 0) {
      output += value.slice(index);
      break;
    }
    output += value.slice(index, open);
    const next = value.charCodeAt(open + 1);
    const tagLike = next === 47 || next === 33 || next === 63 || isTagNameCode(next);
    if (!tagLike) {
      output += '<';
      index = open + 1;
      continue;
    }
    const close = value.indexOf('>', open + 1);
    if (close < 0) break;
    index = close + 1;
  }
  return output;
}

function truncateCodePoints(value, maxChars) {
  if (value.length <= maxChars) return value;
  let output = '';
  let count = 0;
  for (const character of value) {
    if (count === maxChars) break;
    output += character;
    count++;
  }
  return output;
}

function sanitizeText(value, maxChars) {
  let text = decodeEntities(value);
  text = stripTags(text);
  text = filterChars(text, (code) => !isInvisible(code));
  text = filterChars(text, (code) => !isRemovedControl(code));
  text = text.replace(WHITESPACE_RUNS, ' ').trim();
  if (!text) return '';
  return truncateCodePoints(text, maxChars).trim();
}

function sanitizeUrl(value, finalUrl) {
  let text = filterChars(decodeEntities(value), (code) => !isInvisible(code));
  text = filterChars(text, (code) => !isRemovedControl(code));
  text = filterChars(text, (code) => code !== 0x09 && code !== 0x0A && code !== 0x0D && code !== 0x0C && code !== 0x20);
  text = text.trim();
  if (!text) return '';
  let parsed;
  try {
    if (SCHEME.test(text)) {
      parsed = new URL(text);
    } else if (typeof finalUrl === 'string' && finalUrl) {
      parsed = new URL(text, finalUrl);
    } else if (finalUrl && typeof finalUrl.href === 'string') {
      parsed = new URL(text, finalUrl);
    } else {
      return '';
    }
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  const href = parsed.href;
  return href.length > MAX_IMAGE_URL_CHARS ? '' : href;
}

function firstText(candidates, maxChars) {
  for (const candidate of candidates) {
    const text = sanitizeText(candidate || '', maxChars);
    if (text) return text;
  }
  return null;
}

function extractMetadata(buffer, options) {
  const bytes = asBytes(buffer);
  if (!bytes) return { title: null };
  if (bytes.length > MAX_HTML_BYTES) throw tooLarge();
  const settings = options && typeof options === 'object' ? options : {};
  const found = parseHtml(decodeHtml(bytes, settings.contentType));
  const result = {
    title: firstText([found.ogTitle, found.twitterTitle, found.docTitle], MAX_TITLE_CHARS),
  };
  const description = firstText([found.ogDescription, found.metaDescription, found.twitterDescription], MAX_DESCRIPTION_CHARS);
  if (description) result.description = description;
  const siteName = firstText([found.ogSiteName], MAX_SITE_NAME_CHARS);
  if (siteName) result.siteName = siteName;
  const imageUrl = sanitizeUrl(found.ogImageSecure, settings.finalUrl)
    || sanitizeUrl(found.ogImage, settings.finalUrl)
    || sanitizeUrl(found.twitterImage, settings.finalUrl);
  if (imageUrl) result.imageUrl = imageUrl;
  return result;
}

function imageDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return null;
  if (width * height > MAX_IMAGE_PIXELS) return null;
  return { width, height };
}

function isPng(bytes) {
  return bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
    && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A;
}

function pngInfo(bytes) {
  if (bytes.length < 29) return null;
  if (bytes.readUInt32BE(8) !== 13) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return imageDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function isSofMarker(marker) {
  return marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
}

function jpegInfo(bytes) {
  const limit = Math.min(bytes.length, MAX_JPEG_SCAN_BYTES);
  let offset = 2;
  let segments = 0;
  while (offset + 1 < limit) {
    if (segments >= MAX_JPEG_SEGMENTS) return null;
    if (bytes[offset] !== 0xFF) return null;
    while (offset < limit && bytes[offset] === 0xFF) offset++;
    if (offset >= limit) return null;
    const marker = bytes[offset];
    offset++;
    segments++;
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (marker === 0xD9 || marker === 0xDA) return null;
    if (offset + 2 > limit) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) return null;
    if (isSofMarker(marker)) {
      if (length < 7 || offset + 7 > bytes.length) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return imageDimensions(width, height);
    }
    const next = offset + length;
    if (next > limit || next > bytes.length) return null;
    offset = next;
  }
  return null;
}

function isWebp(bytes) {
  return bytes.length >= 12
    && bytes.toString('latin1', 0, 4) === 'RIFF'
    && bytes.toString('latin1', 8, 12) === 'WEBP';
}

function vp8Info(bytes, start, size) {
  if (size < 10 || start + 10 > bytes.length) return null;
  if ((bytes[start] & 0x01) !== 0) return null;
  if (bytes[start + 3] !== 0x9D || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2A) return null;
  const width = (bytes[start + 6] | (bytes[start + 7] << 8)) & 0x3FFF;
  const height = (bytes[start + 8] | (bytes[start + 9] << 8)) & 0x3FFF;
  return imageDimensions(width, height);
}

function vp8lInfo(bytes, start, size) {
  if (size < 5 || start + 5 > bytes.length) return null;
  if (bytes[start] !== 0x2F) return null;
  const bits = (bytes[start + 1] | (bytes[start + 2] << 8) | (bytes[start + 3] << 16) | (bytes[start + 4] << 24)) >>> 0;
  return imageDimensions((bits & 0x3FFF) + 1, ((bits >>> 14) & 0x3FFF) + 1);
}

function vp8xInfo(bytes, start, size) {
  if (size < 10) return null;
  if ((bytes[start] & 0x02) !== 0) return null;
  const width = 1 + (bytes[start + 4] | (bytes[start + 5] << 8) | (bytes[start + 6] << 16));
  const height = 1 + (bytes[start + 7] | (bytes[start + 8] << 8) | (bytes[start + 9] << 16));
  return imageDimensions(width, height);
}

function webpInfo(bytes) {
  if (bytes.length < 16) return null;
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize < 12) return null;
  const end = 8 + riffSize;
  if (end > bytes.length) return null;
  let offset = 12;
  let chunks = 0;
  let animated = false;
  let canvas = null;
  let frame = null;
  while (offset + 8 <= end && chunks < MAX_WEBP_CHUNKS) {
    chunks++;
    const fourcc = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > end - start) return null;
    if (fourcc === 'ANIM' || fourcc === 'ANMF') animated = true;
    if (fourcc === 'VP8X') {
      canvas = vp8xInfo(bytes, start, size);
      if (!canvas) return null;
    } else if (fourcc === 'VP8 ') {
      const dimensions = vp8Info(bytes, start, size);
      if (dimensions) frame = dimensions;
    } else if (fourcc === 'VP8L') {
      const dimensions = vp8lInfo(bytes, start, size);
      if (dimensions) frame = dimensions;
    }
    offset = start + size + (size & 1);
  }
  if (animated) return null;
  return canvas || frame;
}

function validatePreviewImage(buffer) {
  try {
    const bytes = asBytes(buffer);
    if (!bytes || bytes.length === 0) return null;
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    if (isPng(bytes)) {
      const dimensions = pngInfo(bytes);
      return dimensions ? { mime: 'image/png', width: dimensions.width, height: dimensions.height } : null;
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      const dimensions = jpegInfo(bytes);
      return dimensions ? { mime: 'image/jpeg', width: dimensions.width, height: dimensions.height } : null;
    }
    if (isWebp(bytes)) {
      const dimensions = webpInfo(bytes);
      return dimensions ? { mime: 'image/webp', width: dimensions.width, height: dimensions.height } : null;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { extractMetadata, validatePreviewImage };
