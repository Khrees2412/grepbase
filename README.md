# Grepbase

A code search & analysis platform - monorepo with separate frontend and backend.

## Why Separate Deployments?

Cloudflare Pages had deployment queue issues with the full-stack Next.js app. By separating:
- **Frontend** (apps/web): Static Next.js → Deploy to Cloudflare Pages ✅
- **Backend** (apps/api): Hono API → Deploy to Cloudflare Workers ✅

This fixes the queue issue while keeping all code in one repository.

## Project Structure

```
grepbase/
├── apps/
│   ├── web/              # Frontend (Static Next.js)
│   │   ├── src/
│   │   │   ├── app/      # Pages (no API routes)
│   │   │   ├── components/
│   │   │   └── lib/      # API client
│   │   ├── public/
│   │   ├── package.json
│   │   └── next.config.ts (output: "export")
│   │
│   └── api/              # Backend (Hono)
│       ├── src/
│       │   ├── app.ts    # Hono app (shared)
│       │   ├── index.ts  # Node server (local dev)
│       │   ├── worker.ts # Cloudflare Worker entry
│       │   ├── routes/   # API endpoints
│       │   ├── db/       # Database schema
│       │   ├── services/ # Business logic
│       │   └── lib/      # Utilities
│       ├── drizzle/      # Migrations
│       ├── package.json
│       └── tsup.config.ts
│
├── package.json          # Root workspace config
└── README.md
```

## Getting Started

### Install Dependencies

```bash
# Install all workspace dependencies
bun install
```

### Development

**Start both (in separate terminals):**

```bash
# Terminal 1 - Start API
bun run dev:api
# Runs on http://localhost:3001

# Terminal 2 - Start Frontend
bun run dev:web
# Runs on http://localhost:3000
```

**Or start individually:**

```bash
# Just API
cd apps/api
bun install
bun run dev

# Just Frontend
cd apps/web
bun install
bun run dev
```

### Environment Variables

**API (local Node dev, apps/api/.env)**:
```bash
cp apps/api/.env.example apps/api/.env
# Edit with your Cloudflare credentials
```

**API (Cloudflare Workers, apps/api/wrangler.toml + secrets)**:
- Bind D1/KV/R2 in `apps/api/wrangler.toml`
- Set secrets with `wrangler secret put GITHUB_TOKEN` (and AI keys if desired)

**Frontend (apps/web/.env.local)**:
```bash
cp apps/web/.env.example apps/web/.env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3001 for local dev
```

## Deployment

### Deploy Frontend to Cloudflare Pages

```bash
cd apps/web
bun run build  # Creates static 'out' directory
```

**Cloudflare Pages Settings**:
- Build command: `cd apps/web && bun install && bun run build`
- Build output directory: `apps/web/out`
- Root directory: `/`
- Environment variable: `NEXT_PUBLIC_API_URL=https://your-worker.your-account.workers.dev`

### Deploy Backend to Cloudflare Workers

```bash
cd apps/api
wrangler deploy
```

**Workers Settings**:
- `apps/api/wrangler.toml` already includes D1/KV/R2 bindings
- Set `FRONTEND_URL` var in `wrangler.toml` (or via dashboard)
- Add secrets (GitHub, AI keys) with `wrangler secret put`

## Database Migrations

```bash
# Generate migration after schema changes
bun run db:generate

# Apply to Cloudflare D1
cd apps/api
wrangler d1 migrations apply grepbase-db
```

## Architecture

### Why This Works

**Frontend (Static Next.js)**:
- ✅ Pure React (no server components)
- ✅ `output: "export"` in next.config.ts
- ✅ No API routes (moved to backend)
- ✅ Calls backend via `NEXT_PUBLIC_API_URL`
- ✅ Deploys as static files to CF Pages

**Backend (Hono API)**:
- ✅ Runs on Cloudflare Workers with direct D1/KV/R2 bindings
- ✅ Optional HTTP fallback for local Node dev
- ✅ CORS configured for frontend
- ✅ All Next.js API routes converted to Hono

### Data Flow

```
User Browser
    ↓
Cloudflare Pages (Static Next.js)
    ↓ HTTP (NEXT_PUBLIC_API_URL)
Cloudflare Workers (Hono API)
    ↓ Bindings
D1 (Database) + KV (Cache) + R2 (Files)
```

## Commands Reference

```bash
# Development
bun run dev          # Start frontend
bun run dev:api      # Start backend
bun run dev:web      # Start frontend

# Build
bun run build        # Build both
bun run build:api    # Build backend only
bun run build:web    # Build frontend only

# Production
bun run start:api    # Run backend in production
bun run start:web    # Run frontend in production

# Database
bun run db:generate  # Generate migration
bun run db:push      # Apply migration

# Linting
bun run lint         # Lint all workspaces
```

## Troubleshooting

### "API not found" errors

Make sure:
1. Backend is running on port 3001
2. Frontend has `NEXT_PUBLIC_API_URL=http://localhost:3001` in `.env.local`
3. Check CORS settings in `apps/api/src/app.ts`

### Cloudflare Pages queue issue

This should be fixed now that frontend is static. If issues persist:
- Ensure `output: "export"` in `apps/web/next.config.ts`
- Remove any Server Components (`"use server"`)
- Remove API routes from frontend

### Database connection errors

Backend needs Cloudflare bindings or HTTP credentials:
- Workers: ensure D1/KV/R2 bindings and secrets are set
- Local Node: add credentials to `apps/api/.env`

## Next Steps

1. ✅ Install dependencies: `bun install`
2. ✅ Configure environment variables
3. ✅ Start both services locally
4. ⏳ Convert Next.js API routes to Hono (in progress)
5. ⏳ Test full flow
6. ⏳ Deploy to Cloudflare Pages + Workers

## Cost

- **Cloudflare Pages**: Free (500 builds/month)
- **Cloudflare Workers**: Free tier
- **Cloudflare D1/KV/R2**: Free tier
- **Total**: $0/month 🎉
