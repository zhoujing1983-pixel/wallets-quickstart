<div align="center">
<img width="180" alt="Finyx logo" src="./public/finyx.svg" />
<br />
<br />
<h1>Finyx Wallet Studio</h1>
<p>A Finyx-themed quickstart wallet stack.</p>

<div align="center">
<a href="https://wallets.demos-crossmint.com/">Live demo</a> |
<a href="https://docs.crossmint.com/introduction/platform/wallets">Crossmint docs</a> |
<a href="https://www.crossmint.com/quickstarts">See all quickstarts</a>
</div>

<br />
<br />
</div>

## Introduction
Finyx Wallet Studio lets you brand a wallet flow with the Finyx voice while running on Crossmint Auth under the hood. The experience still uses the Crossmint SDKs so your email can act as the wallet signer.

**Learn how to:**
- Create a wallet rebranded as Finyx Wallet Studio
- View the USDXM balance (a Crossmint test stablecoin) and native tokens
- Track wallet activity in a modern feed
- Send USDXM or other tokens to any address

## Deploy
Deploy the Finyx Wallet Studio template to Vercel, ensuring you expose the required env variables to keep the Crossmint-powered backend keyed in.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCrossmint%2Fwallets-quickstart&env=NEXT_PUBLIC_FINYX_API_KEY)

## Setup
1. Clone the repository and enter the project directory:
   ```bash
   git clone https://github.com/crossmint/wallets-quickstart.git && cd wallets-quickstart
   ```
2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   # or
   pnpm install
   # or
   bun install
   ```
3. Prepare your environment file:
   ```bash
   cp .env.template .env
   ```
4. Request a Crossmint client API key (Finyx currently sits on top of Crossmint) and paste it into `.env`. The key needs the scopes `users.create`, `users.read`, `wallets.read`, `wallets.create`, `wallets:transactions.create`, `wallets:transactions.sign`, `wallets:balance.read`, and `wallets.fund`.
   ```bash
   NEXT_PUBLIC_FINYX_API_KEY=your_api_key

   # Check all supported chains: https://docs.crossmint.com/introduction/supported-chains
   NEXT_PUBLIC_CHAIN=your_chain
   ```
5. Configure the bank account reference so the withdraw flow can target your Crossmint bank transfer.
   ```bash
   NEXT_PUBLIC_CROSSMINT_BANK_ACCOUNT_REF=your_bank_account_ref
   ```
6. Supply the server-side credentials so the backend routes (wallet/user updates and onramps) can reach Crossmint.
   ```bash
   CROSSMINT_SERVER_SIDE_API_KEY=your_server_side_api_key
   CROSSMINT_ENV=staging # switch to "production" for live usage
   ```
   > VoltAgent persists memory to `agent-memory.db` by default; set `VOLTAGENT_MEMORY_URL=file:./agent-memory.db` (or another LibSQL URL) in `.env` if you need a different location.
7. Run the dev server:
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   # or
   bun dev
   ```

## Project structure
- `src/app`: Next.js App Router routes, layouts, and styles
- `src/components`: Reusable UI components
- `src/lib`: Shared utilities and hooks
- `src/types`: Shared TypeScript types
- `scripts`: Agent scripts (run via `npm run agent:*`)

## Agent scripts
- Start the local agent: `npm run agent:start`
- Start the OpenAI agent: `npm run agent:openai`
- Watch mode for local agent: `npm run agent:dev`
- Start the OpenAI agent in a local-only (+VoltAgent websocket proxy) mode: `npm run agent:openai:local`

## Local RAG MVP
The chat widget can answer simple questions locally without VoltAgent by using a lightweight SQLite + sqlite-vec RAG flow with Qwen embeddings.

- Default mode: `AGENT_PROXY_MODE=local-rag` (built-in).
- Hybrid mode: `AGENT_PROXY_MODE=hybrid` uses local RAG first, then falls back to VoltAgent when distance is above `RAG_DISTANCE_THRESHOLD`.
- VoltAgent mode: `AGENT_PROXY_MODE=voltagent` to proxy requests to `http://localhost:3141`.
- Tool call policy / 工具调用策略：`AGENT_TOOL_CALL_POLICY=auto` 控制是否允许 LLM 调用工具（`auto`, `off`, `rag-only`）。
- Ingest directory: set `RAG_INGEST_DIR` to point at a folder of docs (defaults to `./rag-docs`, supports md/txt/code/pdf/docx/xlsx).
- Embeddings: `RAG_EMBEDDING_MODEL` uses the Qwen OpenAI-compatible embeddings endpoint (`QWEN_BASE_URL`, `QWEN_API_KEY`).
- Reindex: set `RAG_FORCE_REINDEX=true` to rebuild embeddings after content changes.
- Optional: set `LOCAL_RAG_DB_PATH` to choose a different SQLite file (defaults to `./local-rag-vec.db`).

## Utility scripts
- Create or refresh the treasury wallet used by the demo flows: `npm run treasure:wallet`
- Send queued emails through your configured SMTP server: `npm run email:worker`

## Developer dependencies
When you run `npm run dev` the stack relies on several services. Use the provided npm scripts to bring them up in the correct order:

### macOS installation
Install the required tools before you start:

```bash
brew install colima redis libsql
colima start   # initialize docker daemon via Colima
```

`colima` gives you a lightweight Docker runtime, and `redis` provides the queue backend. If you prefer not to use Homebrew, follow the macOS sections on the [Colima](https://github.com/abiosoft/colima) and [Redis](https://redis.io/docs/getting-started/installation/install-redis-on-macos/) sites.

`npm run colima:start` is just a shortcut for `colima start` so you can launch the Colima-managed Docker daemon from within this project; Colima spins up the VM and `dockerd` underneath so later commands can talk to Docker. Use `npm run colima:stop` when you no longer need the daemon.

1. **Colima daemon** (macOS): `npm run colima:start` (and `npm run colima:stop` to tear it down).
2. **Docker Compose**: `npm run docker:up` to start the containers defined in `docker-compose.yml`. Redis is included in that stack, so you can ignore step 3 unless you prefer a host service.
3. **Redis** (optional): `npm run redis:start` starts Redis via Homebrew if you’re not relying on Docker for it—running it alongside the container stack may cause port conflicts, so skip this step when using Compose.
4. **Persistence file**: the agent stores memory directly in `agent-memory.db` under this project root; set `VOLTAGENT_MEMORY_URL` if you want to point the same LibSQL store somewhere else before starting the stack.

For convenience, start Colima and Docker Compose together with:

```bash
npm run dev:init
```

Once the services are running, `npm run dev` can bring up the Next.js app + worker + agent simultaneously. For convenience there is a single command that sequences everything:

```bash
npm run dev:all
```

When you’re done, tear everything down with:

```bash
npm run dev-shutdown
```

This script runs `docker:up` before launching `npm run dev`. If you see `MallocStackLogging: can't turn off malloc stack logging` in your terminal on macOS, it is harmless; to suppress it you can run `unset MallocStackLogging` before starting `npm run dev` (or rely on the done-for-you `npm run dev` where the `predev` hook already unsets it).

## Qwen (DashScope) setup
If you want to run the agent on Qwen via the OpenAI-compatible endpoint:
```
 MODEL_PROVIDER=qwen
QWEN_API_KEY=your_dashscope_key
QWEN_MODEL=qwen-plus-latest
# Optional:
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

## LM Studio setup
If you want to run the agent against LM Studio locally:
```
MODEL_PROVIDER=lmstudio
LM_STUDIO_MODEL=qwen/qwen3-4b
LM_STUDIO_TEMPERATURE=0.7
LM_STUDIO_MAX_TOKENS=-1
LM_STUDIO_NO_THINK=false
```

## Think toggle (UI)
The chat widget can show a Think switch only for models that support it:
```
AGENT_THINK_MODELS=qwen/qwen3-4b,qwen/qwen2.5-7b
```

## Using in production
1. Create a [production Crossmint API key](https://docs.crossmint.com/introduction/platform/api-keys/client-side) and swap it into `NEXT_PUBLIC_FINYX_API_KEY` before you deploy.
