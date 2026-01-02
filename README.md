# Grepbase

Grepbase is a beautiful, AI-powered code visualization tool designed to help developers understand codebases through a "book-like" commit history view. It ingests GitHub repositories, parses their history, and uses advanced AI agents to explain code changes and project evolution commit-by-commit.

Designed for ease of use and deep understanding, Grepbase supports both cloud-based AI providers (Google Gemini, OpenAI, Anthropic) and local LLMs (Ollama, LMStudio) via a Bring-Your-Own-Key (BYOK) model.

## Features

-   **Repository Ingestion**: Seamlessly fetch and store GitHub repository metadata, commit history, and file snapshots.
-   **AI-Powered Analysis**: specialized AI agents explain every commit, providing context and technical breakdowns of changes.
-   **"Book-Like" Navigation**: Browse a project's history chronologically, reading the story of its development.
-   **Multi-Provider AI Support**:
    -   **Cloud**: Google Gemini (including Gemini 3/2.0), OpenAI (GPT-5/4o), Anthropic (Claude Opus/Sonnet).
    -   **Local**: Ollama (LLaMA 3.2, Mistral), LMStudio.
-   **High Performance**: Built on Cloudflare's edge network (Pages, D1, KV) for speed and low latency.
-   **Modern Tech Stack**: Next.js 16 App Router, Drizzle ORM, and Vercel AI SDK.

## Tech Stack

-   **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
-   **Language**: TypeScript
-   **Infrastructure**: [Cloudflare Pages](https://pages.cloudflare.com/)
-   **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite)
-   **Caching**: [Cloudflare KV](https://developers.cloudflare.com/kv/)
-   **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
-   **AI Integration**: [Vercel AI SDK](https://sdk.vercel.ai/docs)
-   **Styling**: Custom CSS Design System
-   **Package Manager**: [Bun](https://bun.com/)

## generic Prerequisites

-   [Bun](https://bun.com/) (v1.0 or later)
-   [Cloudflare Account](https://dash.cloudflare.com/)
-   Generic knowledge of command line tools

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/khrees2412/grepbase.git
cd grepbase
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Environment Setup

Create a `.env` file in the root directory. You will need Cloudflare credentials for the database and KV bindings.

```env
# Cloudflare D1 Credentials (for local Drizzle operations)
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_D1_DATABASE_ID=your_database_id
CLOUDFLARE_D1_TOKEN=your_api_token

# AI Provider Keys (Optional - can be set in UI or Env)
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

### 4. Database Setup

Initialize the D1 database. Ensure you are logged into Wrangler (`bunx wrangler login`).

```bash
# Create the database (if not exists)
bun run d1:create

# Apply migrations
bun run d1:migrate
```

### 5. Run Locally

You can run the application in standard Next.js dev mode:

```bash
bun run dev
```

**Note**: For full functionality involving Cloudflare D1 and KV bindings locally, use the Cloudflare Pages simulation:

```bash
bun run pages:preview
```
This builds the app using `@cloudflare/next-on-pages` and runs it using `wrangler pages dev`.

## Project Structure

-   `src/app`: Next.js App Router pages and layouts.
-   `src/components`: Reusable UI components.
-   `src/db`: Database schema (`schema.ts`) and Drizzle configuration.
-   `src/services`: Core business logic (GitHub fetching, AI providers, Caching).
    -   `ai-providers.ts`: Configuration for Gemini, OpenAI, Claude, etc.
    -   `github.ts`: Logic for interacting with GitHub API.
-   `drizzle`: SQL migration files.

## Deployment

Deploying to Cloudflare Pages is straightforward.

1.  Connect your repository to Cloudflare Pages.
2.  Set the **Build Command** to: `bun run pages:build`
3.  Set the **Build Output Directory** to: `.vercel/output/static`
4.  Bind your D1 Database (`grepbase-db`) and KV Namespace (`grepbase_cache`) in the Cloudflare Dashboard under **Settings > Functions**.
5.  Add necessary Environment Variables (API Keys).

Alternatively, deploy directly via CLI:
```bash
bun run pages:deploy
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
