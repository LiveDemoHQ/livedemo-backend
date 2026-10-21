# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

This is a **Node.js/Express backend API** (ESM modules) for the LiveDemo platform. It has two runtime modes in a single process:

| Service | Port | Description |
|---|---|---|
| **API Server** | 3005 | Express REST API — the main service |
| **Job Consumer** | N/A | monq background worker (MongoDB change-stream-based) |
| **MongoDB** | 27017 | Required data store; must run as a **replica set** for the job consumer |

### Starting the development environment

1. **MongoDB** must be started with `--replSet rs0` and initialized once with `rs.initiate(...)`. A standalone mongod will crash the consumer due to `$changeStream` requirements.
2. Source `dev.env` (which contains `export` statements) and run `node ./src/server.js`. Alternatively: `npm start` (which does `. ./dev.env && node ./src/server.js`).
3. Both `ENABLE_API=true` and `ENABLE_CONSUMER=true` are set in `dev.env` so a single process runs both services.

### Non-obvious gotchas

- **`local.env` does not use `export` statements** — the committed template relies on shell sourcing in the same subshell that runs `node`. The `dev.env` file (gitignored) should use `export` prefixes so env vars propagate correctly.
- **MongoDB replica set is required**, not optional. The `monq` job worker uses MongoDB change streams (`$changeStream`), which only work on replica sets. Without it, the server will start but crash seconds later when the consumer initializes.
- **No automated tests exist** in this repository. Verification is done via manual API calls (see `README.md` and PR checklist in `CONTRIBUTING.md`).
- **No lint configuration** is present; there is no ESLint config file or lint script in `package.json`.
- **pnpm build scripts**: Several dependencies (puppeteer, ffmpeg-static, esbuild) have blocked postinstall scripts. The `pnpm-workspace.yaml` `onlyBuiltDependencies` list controls which packages can run scripts. For basic API development these are not needed; they are only required for video processing and auto-recording features.
- **Self-signed TLS certs** are in `./certs/`. The server uses HTTP (not HTTPS) unless `ENV=dev1`.
- Data directories (`DEMOS_FOLDER`, `STORIES_FOLDER`, `STORY_REQUESTS_FOLDER`) must exist before the server starts.
- **Auth header format**: Authenticated endpoints expect `Authorization: Bearer <token>`.
