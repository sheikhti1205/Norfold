const { createLinkPreviewHandler } = require('../link-preview-handler.cjs');

// One handler instance per worker keeps the cache, token buckets and
// concurrency slot bounded to this process. Nothing here is a global claim.
const handler = createLinkPreviewHandler();

module.exports = async function (context, req) {
  let config;
  try {
    config = require('../public-config.json');
  } catch {
    // Fail closed without a key, origin or target host.
    config = undefined;
  }
  context.res = await handler.handle(req || context.req, config);
};
