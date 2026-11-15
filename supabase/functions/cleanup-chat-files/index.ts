import { createChatFileCleanupEndpoint } from "./handler.ts";

// Deploy with --no-verify-jwt: the canonical wrapper verifies the server secret
// API key. No anonymous/public/user route may sweep private conversation files.
export default { fetch: createChatFileCleanupEndpoint() };
