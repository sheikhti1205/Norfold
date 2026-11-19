/* global DOMException */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSharePreview } from './prepare-share-preview.mjs';
const require = createRequire(import.meta.url);
const { handleShare } = require('../apps/share-preview/handler.cjs');
const id = '5b6f7c8d-1234-4abc-8def-123456789012';
const config = { url: 'https://project.supabase.co', key: 'sb_publishable_fixture', origin: 'https://findbackapp.social', css: '' };
const preview = { id, type: 'FOUND', title: 'Black backpack', category: 'Bags & Wallets', event_month: '2026-11', excerpt: 'A found item report. Sign in to compare the details and contact the person who posted it.' };
const request = (query = '') => ({ method: 'GET', url: `${config.origin}/api/share/${id}${query}`, params: { id }, headers: { authorization: 'Bearer visitor-token', cookie: 'session=private' } });
function network(data = [preview]) { const calls = []; return { calls, fetch: async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify(data), { headers: {'Content-Type':'application/json'} }); } }; }
test('HTML and JSON use only the same safe projection; no visitor credentials reach Supabase', async () => {
  const net = network(); const html = await handleShare(request(), config, net.fetch);
  assert.equal(html.status, 200); assert.match(html.headers['Content-Type'], /text\/html/);
  assert.match(html.body, /Black backpack/); assert.match(html.body, /property="og:title" content="Black backpack/);
  assert.match(html.body, /Sign in to contact/); assert.match(html.body, new RegExp(`/r/${id}`));
  assert.match(html.body, /November 2026/);
  assert.match(html.body, /rel="icon"[^>]*findback-birdleaf-v1-32\.png/);
  assert.match(html.body, /property="og:image" content="https:\/\/findbackapp.social\/icons\/findback-birdleaf-v1-512\.png"/);
  assert.doesNotMatch(html.body, /<img[^>]*supabase|og:image[^>]*supabase/);
  const json = await handleShare(request('?format=json'), config, net.fetch);
  assert.deepEqual(JSON.parse(json.body), preview);
  for (const c of net.calls) {
    assert.equal(c.url, `${config.url}/rest/v1/rpc/findback_shared_report_preview`);
    assert.deepEqual(JSON.parse(c.init.body), {p_post_id:id});
    assert.equal(c.init.headers.apikey, config.key);
    assert.equal(c.init.headers.Authorization, undefined); assert.equal(c.init.headers.cookie, undefined);
  }
  for (const res of [html,json]) { assert.match(res.headers['Cache-Control'], /no-store/); assert.equal(res.headers['X-Robots-Tag'],'noindex, nofollow'); }
});
test('unavailable/revoked/deleted/hidden report is neutral HTML or JSON null with no stale details', async () => {
  for (const query of ['', '?format=json']) {
    const res = await handleShare(request(query), config, network([]).fetch);
    assert.equal(res.status,404); assert.doesNotMatch(res.body,/Black backpack|Bags &amp; Wallets/);
    assert.match(res.headers['Cache-Control'],/no-store/);
    if(query)assert.equal(JSON.parse(res.body),null);else assert.match(res.body,/no longer available/);
  }
});
test('a backend outage cannot masquerade as a deleted report or leak upstream error contents', async () => {
  const res = await handleShare(request(),config,async()=>new Response('private upstream diagnostic',{status:503}));
  assert.equal(res.status,503); assert.doesNotMatch(res.body,/private upstream diagnostic|Black backpack/);
});
test('invalid IDs/methods/queries never query the backend or reflect input', async () => {
  for (const r of [{...request(),params:{id:'<script>oops</script>'}}, {...request(),method:'POST'}, request('?next=https://evil.test'), request('?format=json&format=html')]) {
    const net = network(); const res = await handleShare(r,config,net.fetch);
    assert.ok([400,404,405].includes(res.status)); assert.equal(net.calls.length,0); assert.doesNotMatch(res.body,/<script>|evil\.test/);
  }
});
test('schema drift/extra private columns and arbitrary strings fail closed, even from upstream', async () => {
  for(const data of [[{...preview,email:'private@example.invalid'}],[{...preview,title:'Call +15551234567'}],[{...preview,category:'<script>x</script>'}],[{...preview,event_month:'2026-11-01'}],[preview,preview],{data:preview}]){
    const res=await handleShare(request(),config,network(data).fetch);
    assert.equal(res.status,503); assert.doesNotMatch(res.body,/private@example|15551234567|<script>/);
  }
});
test('HTML escaping, canonical URLs and CSP cannot be influenced by request host/query/header', async () => {
  const res=await handleShare({...request(),url:`https://evil.test/api/share/${id}?focus=comments&comment=${id}`},config,network().fetch);
  assert.match(res.body,/Bags &amp; Wallets/);assert.doesNotMatch(res.body,/evil\.test|visitor-token|session=private/);
  assert.match(res.body,new RegExp(`https://findbackapp.social/api/share/${id}`));
  assert.match(res.headers['Content-Security-Policy'],/default-src 'none'/);
});
test('invalid/private server configuration refuses to fetch',async()=>{
  for(const bad of [{...config,key:['sb','secret','never-use'].join('_')},{...config,url:'http://127.0.0.1'},{...config,origin:'https://evil.test/path'},{...config,key:''}]){
    const net=network();const res=await handleShare(request(),bad,net.fetch);assert.equal(res.status,503);assert.equal(net.calls.length,0);
  }
});
test('timeout, oversized and malformed responses fail closed; HEAD carries metadata headers without a body',async()=>{
 for(const http of [async()=>{throw new DOMException('timeout','TimeoutError');},async()=>new Response('x'.repeat(9000)),async()=>new Response('{')]){
  const res=await handleShare(request('?format=json'),config,http);assert.equal(res.status,503);assert.equal(JSON.parse(res.body),null);assert.match(res.headers['Cache-Control'],/no-store/);
 }
 const res=await handleShare({...request(),method:'HEAD'},config,network().fetch);
 assert.equal(res.status,200);assert.equal(res.body,'');assert.match(res.headers['Content-Type'],/text\/html/);
});
test('metadata service ships builtin-only, dependency-free and packages with the renderer',async()=>{
 const out=await mkdtemp(join(tmpdir(),'share-package-link-'));
 try{
  await prepareSharePreview(out,{VITE_SUPABASE_URL:'https://project.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',VITE_PUBLIC_SHARE_ORIGIN:'https://findbackapp.social'});
  const trigger=JSON.parse(await readFile(join(out,'link-preview','function.json'),'utf8')).bindings;
  assert.equal(trigger[0].route,'link-preview');assert.deepEqual(trigger[0].methods,['post','options']);assert.equal(trigger[0].authLevel,'anonymous');
  assert.match(await readFile(join(out,'link-preview','index.cjs'),'utf8'),/createLinkPreviewHandler/);
  assert.match(await readFile(join(out,'link-preview-handler.cjs'),'utf8'),/createLinkPreviewHandler/);
  assert.match(await readFile(join(out,'lib','link-fetch.cjs'),'utf8'),/pinnedLookup/);
  const parser=await readFile(join(out,'lib','metadata.cjs'),'utf8');
  assert.match(parser,/extractMetadata/);assert.match(parser,/validatePreviewImage/);
 }finally{await rm(out,{recursive:true,force:true});}
});
test('the metadata server has no npm dependencies, no lockfile and only builtin/relative requires',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../apps/share-preview/package.json',import.meta.url),'utf8'));
 assert.equal(pkg.dependencies,undefined);assert.equal(pkg.devDependencies,undefined);assert.equal(pkg.type,'commonjs');
 await assert.rejects(readFile(new URL('../apps/share-preview/package-lock.json',import.meta.url)),{code:'ENOENT'});
 for(const file of ['lib/link-fetch.cjs','lib/metadata.cjs','link-preview-handler.cjs','link-preview/index.cjs']){
  const source=await readFile(new URL(`../apps/share-preview/${file}`,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.innerHTML\b|outerHTML\b|insertAdjacentHTML/,file);
  assert.doesNotMatch(source,/\bconsole\.(?:log|error|warn|info|debug)\b/,file);
  for(const match of source.matchAll(/require\((['"])([^'"]+)\1\)/g))assert.match(match[2],/^(?:node:.+|\.{1,2}\/.*)$/,`${file} requires ${match[2]}`);
 }
});
test('host.json leaves CORS to the per-function handlers so responses never carry duplicate values',async()=>{
 // Azure applies host.json customHeaders to every HTTP response app-wide.
 // link-preview-handler.cjs (and android-updates/index.cjs) already emit their
 // own Access-Control-Allow-Origin/Methods/Headers/Vary per request, so an
 // app-wide copy would append a second ACAO and make browsers reject the
 // response, including the OPTIONS 204 preflight. Keep this file CORS-free.
 const raw=await readFile(new URL('../apps/share-preview/host.json',import.meta.url),'utf8');
 const host=JSON.parse(raw);
 assert.equal(host.version,'2.0');assert.equal(host.logging.logLevel.default,'Warning');
 assert.equal(host.extensions,undefined,'host.json must not declare app-wide customHeaders');
 assert.doesNotMatch(raw,/customHeaders|Access-Control-/i);
});
