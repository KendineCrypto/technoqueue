# TechnoQueue

**A pixel-art AI office coordinated through Technocore.**

[![CI](https://github.com/KendineCrypto/technoqueue/actions/workflows/ci.yml/badge.svg)](https://github.com/KendineCrypto/technoqueue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6fc2b0.svg)](LICENSE)
[![Live](https://img.shields.io/badge/live-technoqueue.fun-f3bd59.svg)](https://technoqueue.fun)

People create an office, connect their own OpenAI, Anthropic, DeepSeek, or Gemini account, hire specialized AI employees, and arrange a paper route such as **planner → developer → reviewer**. Tasks move desk to desk through Technocore conditional writes. Employee actions are signed with self-issued Ed25519 DIDs and shown in the live office.

TechnoQueue is independent open-source software. It is not affiliated with FLOP Labs, does not represent the FLOP protocol, and cannot promise rewards or airdrop eligibility.

The project has a [DID-signed public contribution record](docs/technocore-contribution.md) in Technocore, linking the live product, source code, and the exact signed room sequence.

## What is stored where

Technocore is the public coordination and evidence layer:

- employee profiles, workflows, tasks, prompts, results, and review feedback;
- exact-value CAS claims and state transitions;
- account-owned `d-` event rooms with signed employee activity;
- prompt/result SHA-256 attestations.

The application database is the private custody and ownership layer:

- accounts, password hashes, sessions, and owned offices;
- provider keys encrypted with AES-256-GCM;
- account and employee private DID keys encrypted with AES-256-GCM;
- provider mappings, runtime retries, audit records, and HMAC-authenticated trust anchors for every Technocore record created by the hosted office.

Secrets never enter Technocore or browser storage. Office and task pages require the owning account. Technocore generic KV remains public and world-writable by design; CAS coordinates races but does not create authorization. The hosted runtime therefore reads only locally allow-listed record keys, verifies their exact bytes against master-key HMAC trust anchors, and stops before any provider call when an outside write is observed. The owner can restore the last trusted bytes from the office UI. Read [SECURITY.md](SECURITY.md) before publishing an instance.

## Requirements

- Node.js 24+
- pnpm 11+
- one persistent Node/container process
- a persistent disk for SQLite

## Local development

In Command Prompt (`cmd.exe`):

```bat
copy .env.example .env.local
pnpm install
pnpm dev
```

In PowerShell:

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:3000`, create an account, then:

1. Create an office from **My offices**.
2. Open **Office Setup** and connect a provider.
3. Use **TEST** to verify the default model and key.
4. Hire a planner, worker/developer, and optional reviewer.
5. Add public standing instructions to each employee.
6. Create a workflow in **Office Setup**.
7. Send a brief from **New Task**.

The server scheduler keeps working after the browser tab closes. Click an employee to pause, change provider/model, retry an error, back up its DID, or fire it.

Office URLs are not access credentials. A signed-in user receives `404` for another account's office, and anonymous users are sent to login. The underlying Technocore records are still public; do not put confidential material in a task.

After upgrading an older installation to the state-firewall release, each existing office pauses its scheduler until the owner reviews the imported employees, workflows, and tasks and completes the one-time activation banner. Newly created offices are protected immediately.

Local development automatically creates a Git-ignored `.secrets/master.key`. Back it up if you care about local encrypted keys.

## Production deployment

Generate a master key in PowerShell:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[Convert]::ToBase64String($bytes)
```

Put the result in `.env.local` as `TECHNOQUEUE_MASTER_KEY`, set `NEXT_PUBLIC_SITE_URL` to the HTTPS public URL, then run:

```bash
docker compose up -d --build
```

The Compose file mounts `/data` for SQLite. Back up the database and master key separately. Run exactly one web replica. SQLite plus the in-process scheduler is intentionally not a horizontally scaled design.

### Railway

1. Push this repository to GitHub and create a Railway service from it. Railway automatically detects the root `Dockerfile`.
2. Add a Railway volume mounted at `/data` and keep the service at exactly one replica.
3. Add the production variables from `.env.example`. At minimum set:

   ```dotenv
   TECHNOCORE_BASE_URL=https://technocore.chat
   NEXT_PUBLIC_SITE_URL=https://technoqueue.fun
   TECHNOQUEUE_DB_PATH=/data/technoqueue.sqlite
   TECHNOQUEUE_MASTER_KEY=<32-random-bytes-as-base64>
   TECHNOQUEUE_BACKGROUND_RUNTIME=true
   ```

4. Set the Railway healthcheck path to `/api/live`, generate a temporary Railway domain, and verify the deployment before attaching the custom domain. Use `/api/health` separately to inspect database and vault readiness.
5. Add `technoqueue.fun` under Railway **Networking > Custom Domain**. Railway requires both the displayed routing `CNAME` and ownership `TXT` records.
6. Because Unstoppable's DNS does not provide an apex `ALIAS`/CNAME-flattening record, add the domain to Cloudflare's free DNS plan, replace the nameservers at Unstoppable with the two Cloudflare nameservers, and add Railway's root `CNAME` and `TXT` records in Cloudflare. Railway then provisions HTTPS automatically.

Do not commit `.env.local`, expose the master key, or deploy without the `/data` volume. A fresh deployment can start with an empty database. To preserve existing accounts, provider connections, and DID custody, migrate the current SQLite database and use the exact same master key.

## Identity and recovery

Signup creates a self-issued `did:key`; Technocore does not register or issue it. The dashboard can export the account key as a passphrase-encrypted `.tqid` file. That file can:

- restore the same DID during signup on a fresh installation;
- reset a forgotten password on the same installation through `/recover`.

Employees have separate DIDs and separate `.tqid` exports. A signature proves possession of a key for specific bytes—not legal identity, truth, ownership of generic KV, or reward eligibility.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `TECHNOCORE_BASE_URL` | Server-controlled Technocore origin | `https://technocore.chat` |
| `NEXT_PUBLIC_SITE_URL` | Canonical HTTPS web URL | `http://localhost:3000` |
| `TECHNOQUEUE_DB_PATH` | Persistent SQLite path | `.data/technoqueue.sqlite` |
| `TECHNOQUEUE_MASTER_KEY` | 32 random bytes, base64; required in production | local generated key |
| `TECHNOQUEUE_BACKGROUND_RUNTIME` | Enable persistent office scheduler | `true` |
| `TECHNOQUEUE_RUNTIME_INTERVAL_MS` | Scheduler interval | `5000` |
| `TECHNOQUEUE_LEASE_SECONDS` | Technocore claim lease | `120` |
| `TECHNOQUEUE_PUBLIC_FEED` | Publish sanitized, high-signal production events to the project room | canonical deployment only |
| `TECHNOQUEUE_PUBLIC_FEED_ROOM` | Owned Technocore room used by the public relay | `d-technoqueue` |
| `TECHNOQUEUE_MAX_WORKSPACES_PER_USER` | Account office quota | `10` |
| `TECHNOQUEUE_MAX_PROVIDERS_PER_USER` | Account provider quota | `12` |
| `TECHNOQUEUE_MAX_AGENTS_PER_WORKSPACE` | Office employee quota | `24` |

Provider keys are supplied by users through the UI; never put shared production provider keys in the client bundle.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Packages:

```text
apps/web       Next.js product, accounts, vault, scheduler, pixel office
apps/agent     optional standalone worker/reviewer CLI
packages/core  Technocore client, schemas, crypto, queue and providers
docs           architecture and hosted product notes
```

## Trust and retention

Technocore data is public, untrusted, and not durable storage. Never submit confidential or regulated content. Owned `d-` rooms protect who may append activity, but employee/workflow/task notes remain generic Technocore KV. An outside writer can still cause availability problems, but altered or injected records are quarantined and cannot trigger hosted provider spend. Missing old room evidence is shown as unavailable rather than invalid. For permanent evidence or private work, operate storage and access controls you own.

## License

[MIT](LICENSE). Contributions are welcome—read [CONTRIBUTING.md](CONTRIBUTING.md), use the [issue tracker](https://github.com/KendineCrypto/technoqueue/issues), and report vulnerabilities through [private security advisories](https://github.com/KendineCrypto/technoqueue/security/advisories/new).
