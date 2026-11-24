// Same-origin, read-only metadata bridge. Browser fetches cannot read GitHub
// release downloads directly (CORS); native APK downloads remain direct.
const REPO = 'sheikhti1205/Norfold';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_BYTES = 128 * 1024;
const CATALOGUE_ASSET = 'catalogue.v1.json';
// Parses in the mobile client's parseAndroidCatalogue: `releases` is required
// (an empty array is valid), `schemaVersion` may be 1 and `history` entries are
// optional, so an empty one means "nothing to install". No record validators
// run on empty arrays, so no fabricated release can appear.
const EMPTY_CATALOGUE = JSON.stringify({ schemaVersion: 1, releases: [], history: [] });
const UNAVAILABLE = JSON.stringify({ error: 'Updates are temporarily unavailable.' });
const { Buffer } = require('node:buffer');
function compareVersions(a,b) {
  const parts=tag=>{const match=VERSION_TAG.exec(tag);return {main:match.slice(1,4),pre:match[4]?.split('.')};};
  const numeric=(l,r)=>l.length!==r.length?l.length-r.length:l<r?-1:l>r?1:0;
  const x=parts(a),y=parts(b);
  for(let i=0;i<3;i++)if(x.main[i]!==y.main[i])return numeric(x.main[i],y.main[i]);
  if(!x.pre||!y.pre)return !x.pre&&!y.pre?0:!x.pre?1:-1;
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++) {
    const l=x.pre[i],r=y.pre[i];if(l===r)continue;
    if(l===undefined||r===undefined)return l===undefined?-1:1;
    const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r);
    if(ln&&rn)return numeric(l,r);
    if(ln!==rn)return ln?-1:1;
    return l<r?-1:1;
  }
  return 0;
}
async function handleUpdates(req, fetchImpl = globalThis.fetch, log = logOutcome) {
  // Public, credential-free metadata is also read by the bundled Android
  // WebView at https://localhost, not only by the same-origin hosted site.
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  const request = { signal: globalThis.AbortSignal.timeout(10000), redirect: 'follow' };
  let carriers;
  try {
    const list = await fetchImpl(RELEASES_URL, request);
    if (!list.ok) throw Error();
    // GitHub includes release notes and every asset; the current real listing
    // already exceeds the much smaller update-catalogue limit.
    const releases = JSON.parse(await boundedText(list, 1024 * 1024));
    if (!Array.isArray(releases)) throw Error();
    // A published release "carries" a catalogue when GitHub lists that asset.
    // Drafts are invisible to readers; rolling aliases have no assets at all.
    carriers = releases.filter(r => !r.draft && r.assets?.some(a => a.name === CATALOGUE_ASSET));
  } catch {
    // Network, timeout, non-2xx (including rate limiting) and an unreadable
    // listing are one outcome: the source failed. Never "up to date".
    log('unavailable: the release listing could not be read');
    return { status: 503, headers, body: UNAVAILABLE };
  }
  if (carriers.length === 0) {
    // Legitimate steady state when no release carries a catalogue: there is
    // nothing to install, which is not an outage and not a fabricated release.
    log('empty: no published release carries a catalogue');
    return { status: 200, headers: { ...headers, 'X-Catalogue-State': 'empty' }, body: req.method === 'HEAD' ? '' : EMPTY_CATALOGUE };
  }
  // Highest SemVer first; the GitHub listing order is not authoritative. A
  // carrier with an unusable tag is not addressable, so it never becomes a
  // candidate — but it is also not evidence of a clean release line.
  const candidates = carriers.filter(r => VERSION_TAG.test(r.tag_name))
    .sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
  for (const release of candidates) {
    const url = `https://github.com/${REPO}/releases/download/${release.tag_name}/${CATALOGUE_ASSET}`;
    try {
      const response = await fetchImpl(url, request);
      const body = await boundedText(response);
      const data = JSON.parse(body);
      if (data.schemaVersion !== 1 || !Array.isArray(data.releases)
        || !data.releases.some(r => r.tag === release.tag_name && `v${r.versionName}` === release.tag_name)) throw Error();
      log(`release: ${release.tag_name}`);
      return { status: 200, headers: { ...headers, 'X-Catalogue-State': 'release' }, body: req.method === 'HEAD' ? '' : body };
    } catch {
      // One broken document is that release's problem, not the release's
      // neighbours': fall through to the next highest candidate.
    }
  }
  // Every candidate was unreadable. That is a broken source, not an empty one.
  log(candidates.length === 0
    ? 'unavailable: no catalogued release has a usable version tag'
    : 'unavailable: every candidate catalogue was malformed');
  return { status: 503, headers, body: UNAVAILABLE };
}
function logOutcome(line) { console.log(`android-updates: ${line}`); }
async function boundedText(response, limit = MAX_BYTES) {
    if (!response.ok || Number(response.headers.get('content-length')) > limit) throw Error();
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw Error();
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString('utf8');
}
module.exports = async (context, req) => { context.res = await handleUpdates(req); };
module.exports.handleUpdates = handleUpdates;
