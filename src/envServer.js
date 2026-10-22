//TODO: refactor to get the vars from ENV vars
export default {
  'ENV': process.env.ENV ? process.env.ENV : "",
  'URL': process.env.APIG_URL ? process.env.APIG_URL : "",
  'ENABLE_API': process.env.ENABLE_API !== undefined ? process.env.ENABLE_API.toLowerCase() === 'true' : "",
  'ENABLE_CONSUMER': process.env.ENABLE_CONSUMER !== undefined ? process.env.ENABLE_CONSUMER.toLowerCase() === 'true' : "",
  'URL_CLEAN': process.env.URL_CLEAN ? process.env.URL_CLEAN : "",
  'URL_COMMON_DOMAIN': process.env.URL_COMMON_DOMAIN ? process.env.URL_COMMON_DOMAIN : "",
  'SERVER_URL': process.env.SERVER_URL ? process.env.SERVER_URL : "",
  'INJECT_BUNDLE_HOST': process.env.INJECT_BUNDLE_HOST ? process.env.INJECT_BUNDLE_HOST : "",
  'PRIVATE_AUTH_TOKEN': process.env.PRIVATE_AUTH_TOKEN ? process.env.PRIVATE_AUTH_TOKEN : "",
  'DB_URI': process.env.DB_URI ? process.env.DB_URI : "mongodb://localhost:27017/livedemo_app",
  'DEMOS_FOLDER': process.env.DEMOS_FOLDER ? process.env.DEMOS_FOLDER : "",
  'STORIES_FOLDER': process.env.STORIES_FOLDER ? process.env.STORIES_FOLDER : "",
  'STORY_REQUESTS_FOLDER': process.env.STORY_REQUESTS_FOLDER ? process.env.STORY_REQUESTS_FOLDER : "",
  'AWS_ACCESS_KEY_ID': process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID : "",
  'AWS_SECRET_ACCESS_KEY': process.env.AWS_SECRET_ACCESS_KEY ? process.env.AWS_SECRET_ACCESS_KEY : "",
  'STORY_API': process.env.STORY_API ? process.env.STORY_API : "",
  'STORIES_API': process.env.STORIES_API ? process.env.STORIES_API : "",
  'CAPTCHA_SECRET_KEY':  process.env.CAPTCHA_SECRET_KEY ? process.env.CAPTCHA_SECRET_KEY : "",
  'MUX_TOKEN_ID': process.env.MUX_TOKEN_ID ? process.env.MUX_TOKEN_ID : "",
  'MUX_TOKEN_SECRET': process.env.MUX_TOKEN_SECRET ? process.env.MUX_TOKEN_SECRET : "",
  'OPENAI_API_KEY': process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY : "",
  'LIVEDEMO_CDN_URL':  process.env.LIVEDEMO_CDN_URL ? process.env.LIVEDEMO_CDN_URL : "",
  'REQUESTS_PER_INTERVAL':  process.env.REQUESTS_PER_INTERVAL ? process.env.REQUESTS_PER_INTERVAL : "",
  'ELEVENLABS_API_KEY':  process.env.ELEVENLABS_API_KEY ? process.env.ELEVENLABS_API_KEY : "",
  'ELEVENLABS_VOICES_COLLECTION':  process.env.ELEVENLABS_VOICES_COLLECTION ? process.env.ELEVENLABS_VOICES_COLLECTION : "",
  'ANAM_API_KEY': process.env.ANAM_API_KEY ? process.env.ANAM_API_KEY : "",
  'LEMONSLICE_API_KEY': process.env.LEMONSLICE_API_KEY ? process.env.LEMONSLICE_API_KEY : "",
  // When set, Growth avatar minutes and the concurrent-session cap are enforced. Unset = record only.
  'AVATAR_MINUTES_ENFORCED': process.env.AVATAR_MINUTES_ENFORCED
    ? ['true', '1', 'yes'].includes(String(process.env.AVATAR_MINUTES_ENFORCED).toLowerCase())
    : false,
  'LIVEKIT_URL': process.env.LIVEKIT_URL ? process.env.LIVEKIT_URL : "",
  'LIVEKIT_API_KEY': process.env.LIVEKIT_API_KEY ? process.env.LIVEKIT_API_KEY : "",
  'LIVEKIT_API_SECRET': process.env.LIVEKIT_API_SECRET ? process.env.LIVEKIT_API_SECRET : "",
  'ELEVENLABS_SCRIBE_MODEL': process.env.ELEVENLABS_SCRIBE_MODEL ? process.env.ELEVENLABS_SCRIBE_MODEL : "scribe_v2_realtime",
  'SES_ACCESS_KEY_ID': process.env.SES_ACCESS_KEY_ID ? process.env.SES_ACCESS_KEY_ID : "",
  'SES_SECRET_ACCESS_KEY': process.env.SES_SECRET_ACCESS_KEY ? process.env.SES_SECRET_ACCESS_KEY : "",
  // Shared secret for /internal/* (livedemo-ai-api); empty = those routes always 401
  'INTERNAL_API_KEY': process.env.INTERNAL_API_KEY ? process.env.INTERNAL_API_KEY : "",
  // Workspace every cloned Storylane / Arcade / Navattic / Supademo demo lands in (MigrateDemo)
  'MIGRATE_WORKSPACE_ID': process.env.MIGRATE_WORKSPACE_ID ? process.env.MIGRATE_WORKSPACE_ID : "",
  'GMAIL': {
    CLIENT_ID: process.env.GMAIL__CLIENT_ID,
    CLIENT_SECRET: process.env.GMAIL__CLIENT_SECRET,
    REDIRECT_URIS: process.env.GMAIL__REDIRECT_URIS ? JSON.parse(process.env.GMAIL__REDIRECT_URIS) : ""
  },
  'OAUTH2Credentials': (() => {
    // Parse OAUTH2Credentials from env if it exists, otherwise use empty defaults.
    const oauth2Creds = process.env.OAUTH2Credentials 
      ? JSON.parse(process.env.OAUTH2Credentials) 
      : {}
    
    // Always merge HubSpot credentials from separate env vars
    oauth2Creds.HubSpot = {
      "client_id": process.env.HUBSPOT__CLIENT_ID ? process.env.HUBSPOT__CLIENT_ID : "",
      "client_secret": process.env.HUBSPOT__CLIENT_SECRET ? process.env.HUBSPOT__CLIENT_SECRET : "",
      "redirect_uris": process.env.HUBSPOT__REDIRECT_URIS ? JSON.parse(process.env.HUBSPOT__REDIRECT_URIS) : [
        ""
      ]
    }
    
    return oauth2Creds
  })(),
  'SEQUENZY_API_KEY': process.env.SEQUENZY_API_KEY ? process.env.SEQUENZY_API_KEY : "",
  'SEQUENZY_ENABLED': process.env.SEQUENZY_ENABLED !== undefined
    ? ['true', '1', 'yes'].includes(String(process.env.SEQUENZY_ENABLED).toLowerCase())
    : false,
  'SEQUENZY_WEBHOOK_SECRET': process.env.SEQUENZY_WEBHOOK_SECRET ? process.env.SEQUENZY_WEBHOOK_SECRET : "",
  'STRIPE_SECRET_KEY': process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY : "",
  'STRIPE_WEBHOOK_SECRET': process.env.STRIPE_WEBHOOK_SECRET ? process.env.STRIPE_WEBHOOK_SECRET : "",
  'TMP_FOLDER': process.env.TMP_FOLDER ? process.env.TMP_FOLDER : "",
  'PROCESS_DEMO_ACTIVITY_EVENTS': process.env.PROCESS_DEMO_ACTIVITY_EVENTS
    ? ['true', '1', 'yes'].includes(process.env.PROCESS_DEMO_ACTIVITY_EVENTS.toLowerCase())
    : "",
  'ONBOARDING_DEMO_STORY_ID': process.env.ONBOARDING_DEMO_STORY_ID ? process.env.ONBOARDING_DEMO_STORY_ID : "",
  'ONBOARDING_DEMO_WORKSPACE_ID': process.env.ONBOARDING_DEMO_WORKSPACE_ID ? process.env.ONBOARDING_DEMO_WORKSPACE_ID : "",
  'IPWHO_API_KEY': process.env.IPWHO_API_KEY ? process.env.IPWHO_API_KEY : "",
  'STORY_REVISIONS_MAX': process.env.STORY_REVISIONS_MAX ? process.env.STORY_REVISIONS_MAX : "",
  'GEMINI_API_KEY': process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : "",
  'GEMINI_MODEL': process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL : "gemini-3.5-flash-lite",
  'GEMINI_EMBED_MODEL': process.env.GEMINI_EMBED_MODEL ? process.env.GEMINI_EMBED_MODEL : "gemini-embedding-2",
  // gemini-embedding-2 query-side task (see ai.google.dev/gemini-api/docs/embeddings)
  'GEMINI_EMBED_QUERY_TASK': process.env.GEMINI_EMBED_QUERY_TASK ? process.env.GEMINI_EMBED_QUERY_TASK : "QUESTION_ANSWERING",
  // Min ms between embed API calls.
  'GEMINI_EMBED_MIN_INTERVAL_MS': process.env.GEMINI_EMBED_MIN_INTERVAL_MS ? process.env.GEMINI_EMBED_MIN_INTERVAL_MS : "200",
  'GEMINI_EMBED_MAX_RETRIES': process.env.GEMINI_EMBED_MAX_RETRIES ? process.env.GEMINI_EMBED_MAX_RETRIES : "5",
  // 'on' (default) = try $vectorSearch (mongot/Atlas), fall back to Node cosine if unavailable.
  // 'off' = always Node cosine (no mongot needed).
  'VECTOR_SEARCH': process.env.VECTOR_SEARCH ? process.env.VECTOR_SEARCH : "on",
  'AGENT_REVISIONS_MAX': process.env.AGENT_REVISIONS_MAX ? process.env.AGENT_REVISIONS_MAX : "",
  // Public MCP endpoint (livedemo-ai-api /mcp), the only OAuth `resource` we issue tokens for
  'MCP_URL': process.env.MCP_URL ? process.env.MCP_URL : "",
  // Cloudflare for SaaS custom hostnames (customers CNAME to CUSTOM_DOMAIN_TARGET)
  'CLOUDFLARE_API_TOKEN': process.env.CLOUDFLARE_API_TOKEN ? process.env.CLOUDFLARE_API_TOKEN : "",
  'CLOUDFLARE_ZONE_ID': process.env.CLOUDFLARE_ZONE_ID ? process.env.CLOUDFLARE_ZONE_ID : "",
  'CUSTOM_DOMAIN_TARGET': process.env.CUSTOM_DOMAIN_TARGET ? process.env.CUSTOM_DOMAIN_TARGET : "",
}