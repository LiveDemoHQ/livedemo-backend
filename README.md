# livedemo-backend

Node.js / Express backend API for the livedemo platform. Handles demos, stories, workspaces, users, billing, and media processing.

## Stack

- **Runtime** - Node.js (ESM)
- **Framework** - Express
- **Database** - MongoDB via Mongoose
- **Queue** - monq (MongoDB-backed job queue)
- **Media** - FFmpeg, Mux, Puppeteer
- **Auth** - JWT, Google OAuth2
- **Billing** - Stripe
- **Storage** - AWS S3 / SES
- **AI** - OpenAI, ElevenLabs

---

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- MongoDB running locally on port `27017`

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

`local.env` is the committed template. Create your personal `dev.env` from it and fill in your own secrets:

```bash
cp local.env dev.env
```

> `dev.env` is listed in `.gitignore` - your secrets will never be committed.

Key variables to update in `dev.env`:

| Variable | Description |
|---|---|
| `DB_URI` | MongoDB connection URI |
| `PRIVATE_AUTH_TOKEN` | Internal service auth token |
| `OPENAI_API_KEY` | OpenAI API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `ELEVENLABS_API_KEY` | ElevenLabs key |
| `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` | Mux credentials |
| `DEMOS_FOLDER` | Local path to store demo files |
| `STORIES_FOLDER` | Local path to store story files |

### 3. Start the server

```bash
npm start
```

This sources `dev.env` and starts `src/server.js` on port `3005`.

---

## Project structure

```
src/
  server.js          # Express app entry point
  setup.js           # App bootstrap (DB, middleware, routes)
  envServer.js       # Environment config loader
  handlers/          # Route handler functions (one file per endpoint)
  models/            # Mongoose models
  helpers/           # Shared utility modules
  constants/         # App-wide constants
  processors/        # Background processing logic
jobs-server.js       # Job queue worker entry point
```

---

## API

The server listens on port `3005` by default. Key resource groups:

| Resource | Description |
|---|---|
| `/users` | Auth, registration, Google OAuth |
| `/stories` | Story CRUD and preview |
| `/demos` | Demo management |
| `/workspaces` | Workspace management |
| `/integrations` | HubSpot and other integrations |
| `/subscriptions` | Stripe billing |

---

## Running the job worker

```bash
node jobs-server.js
```

---

## License

Functional Source License, Version 1.1, MIT Future License (FSL-1.1-MIT), see [`LICENSE`](LICENSE). Each version becomes MIT-licensed two years after its release.
