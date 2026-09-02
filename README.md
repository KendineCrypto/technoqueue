# TechnoQueue

**A pixel-art AI office coordinated through Technocore.**

[![CI](https://github.com/KendineCrypto/technoqueue/actions/workflows/ci.yml/badge.svg)](https://github.com/KendineCrypto/technoqueue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6fc2b0.svg)](LICENSE)
[![Live](https://img.shields.io/badge/live-technoqueue.fun-f3bd59.svg)](https://technoqueue.fun)

People create an office, connect their own OpenAI, Anthropic, DeepSeek, or Gemini account, hire specialized AI employees, and arrange a paper route such as **planner → developer → reviewer**. Tasks move desk to desk through Technocore conditional writes. Employee actions are signed with self-issued Ed25519 DIDs and shown in the live office.

TechnoQueue is independent open-source software. It is not affiliated with FLOP Labs, does not represent the FLOP protocol, and cannot promise rewards or airdrop eligibility.

The project has a [DID-signed public contribution record](docs/technocore-contribution.md) in Technocore, linking the live product, source code, and the exact signed room sequence.

## v0.4.3 workflow controls

- A workflow can place up to three specialist desks in one logical parallel stage. Each branch receives the same prior handoff independently, then an explicit merge desk receives their labeled outputs.
- Selected work steps can stop at a boss checkpoint. The owner reviews the handoff and either approves the paper route or returns it with revision feedback.
- Every work step has its own zero-to-five revision allowance. Exhausting that allowance stops the task visibly instead of creating an infinite review loop.
- Final reviewers can return rejected work to a configured earlier desk, including the merge desk, rather than always using the immediately preceding step.
- Workflow topology and controls are stored in trusted Technocore records. Existing linear workflows and tasks are upgraded in memory with safe defaults and require no data migration.
- The pixel-art workflow builder, task brief, and verified task file show parallel branches, merge desks, checkpoints, revision counters, and owner controls.

Parallel branches are logically isolated but are currently executed one at a time by the hosted scheduler. This keeps provider spending and Technocore conditional writes deterministic while preserving independent branch context.

## v0.4.2 reliable paper routes

- Every task carries a Technocore-backed delivery state: `waiting`, `retrying`, `blocked`, or `exhausted`, with its retry count, next attempt, provider, and a compact reason.
- The boss chooses one to eight route retries and the first delay when creating a task. Rate limits, timeouts, empty responses, and temporary upstream failures use exponential backoff capped at fifteen minutes.
- Each hosted employee can privately use a second provider connection and model as a backup brain. Fallback credentials and configuration are never published in the employee profile.
- Authentication and office-budget failures stop for a human decision instead of consuming requests indefinitely.
- The task file exposes route diagnostics and lets the authenticated owner reset the interrupted step without changing its signed outcome contract.
- Existing task records receive a backward-compatible default route policy when parsed.

## v0.4.1 outcome contracts

- Every new task records one to five explicit success criteria and one to four required deliverable kinds before the paper leaves the boss desk.
- The immutable contract digest binds the title, brief, initial role, selected local project, full workflow route with employee DIDs, required deliverables, and success criteria.
- The account DID signs that digest at task creation; each employee signs the same digest when starting a workflow step. The task proof view reports contract attestation separately from prompt, result, and approval attestations.
- Work prompts carry the locked contract through every handoff. Reviewers are instructed to check every criterion and reject a generally useful response that omits a required deliverable.
- The pixel boss desk includes a contract editor, while the owner-only task file shows the locked checklist, deliverables, digest, and attestation status.
- Existing tasks remain readable with a legacy default contract and do not require a migration.

## v0.4.0 specialist foundation

- Every employee can now carry a structured specialty profile: a short specialist headline, a bounded description, and up to six canonical capabilities.
- Specialty profiles are part of the DID-linked public employee record on Technocore, making them suitable for a future signed service manifest without publishing provider keys or account credentials.
- The hosted runtime injects specialties beneath the immutable role blueprint. A specialty can focus a Researcher on crypto or a Developer on security, but cannot grant tools, switch roles, or create approval authority.
- The pixel-art employee file and hiring desk include a dedicated specialty editor with canonical skills such as web research, software development, security review, writing, and translation.
- Legacy employee records receive an empty specialty profile automatically when parsed; no database or manual migration is required.

This release deliberately does **not** list employees publicly, accept external jobs, move value, or resell consumer AI subscriptions. Read the staged [product roadmap](docs/roadmap.md).

## v0.3.3 runner security and reliability

- Rate limiting now uses the proxy-observed client address rather than the attacker-controlled first forwarding value, and its in-memory bucket store is bounded.
- Browser mutations fail closed when the `Origin` header is missing. Production responses include HSTS, and API responses are explicitly non-cacheable.
- Every approved runner request is bound to its SHA-256 digest. Verification and dependency/CI changes require a prominent risk acknowledgement and show their exact contents or command.
- Runner jobs have expiring leases. Late receipts, revoked permissions, and request mutations are rejected; completed and failed receipts remain visible in the approval inbox.
- Filtered project snapshots are never returned to the browser, are encrypted at rest while needed, and are deleted as soon as the change proposal is created or after a 24-hour safety TTL.
- Windows verification uses pinned pnpm/npm JavaScript entrypoints without a shell; non-zero process exits now fail the job. CI repeats the runner test on Windows.
- Path checks reject Windows device names, alternate data streams, ambiguous trailing characters, generated/dependency directories, and more secret-like filenames. Receipts hash the bytes observed after the final write.

## v0.3.2 pre-FLOP workforce foundation

- A paired runner can request a grant for a local project folder. The absolute path stays only in `~/.technoqueue/runner.json`; the server receives a label and DID-bound SHA-256 fingerprint.
- Office owners approve project permissions and explicitly approve every proposed file write and verification command in a pixel-art **Boss Approval Inbox**.
- Developer steps can use a filtered project snapshot, propose complete UTF-8 file changes, wait for approval, apply them inside the granted root, and return DID-signed job receipts.
- The runner blocks traversal, absolute paths, symlink writes, `.env`, credentials, private-key-like names, generated directories, and oversized context. File changes use temporary files with best-effort rollback.
- Provider token usage is recorded per employee and task. Owners can set daily request and token limits; the scheduler stops before the provider call when a limit is reached.
- TechnoQueue does not guess currency cost. Prices vary by provider, model, cache, and account; future FLOP accounting will use the testnet's actual settlement data.

Read [Local runner security](docs/local-runner.md) before granting a project. Verification runs project-controlled package scripts and therefore requires the same care as running them manually.

## v0.3.1 role blueprints

- Every generalist, planner, researcher, writer, developer, analyst, and reviewer now receives a detailed built-in role blueprint on every provider request.
- The blueprint defines the employee's mission, responsibilities, boundaries, and output contract. It is server-owned and cannot be removed from the employee form.
- Office owners can add public custom constraints or use quick presets for language, brevity, source handling, assumptions, and missing requirements.
- Custom constraints are lower priority than the locked blueprint: they cannot switch roles, grant tools, authorize external actions, or let an employee approve its own work.
- Existing employees gain their role blueprint automatically; no profile or database migration is required.

Read [Role blueprints and custom constraints](docs/role-blueprints.md) for the prompt authority model and its enforcement boundary.

## v0.3.0 local runner foundation

- Office owners can pair up to five local computers with short-lived, one-time codes from a new pixel-art **Runner** console.
- Every runner creates a separate Ed25519 `did:key` locally and signs both pairing proof and monotonically sequenced heartbeats.
- Pairing codes and runner bearer tokens are stored only as SHA-256 hashes on the server. Owners can revoke a runner immediately from the office.
- The office shows paired, online, recent, and offline runner states. This foundation release deliberately does not grant filesystem access or execute shell commands.

The next runner milestone will add explicit project grants and approval-gated jobs on top of this identity channel. Read [Local runner security](docs/local-runner.md) before pairing a machine.

## v0.2.1 public beta

- The full product now shares one pixel-art office design system.
- `/board/demo` is a safe, account-free Tour Mode with sample employees and a sample paper route. It never calls a provider or writes demo records to Technocore.
- New office owners receive an in-product first-day checklist: connect an AI, hire an employee, build a route, and send the first task.
- Empty, loading, unavailable, and not-found states explain what happened without substituting mock data for a real office.
- Mobile office controls wrap into touch-friendly rows while keeping the desktop room layout intact.

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
5. Review the employee's locked role blueprint and optionally add public custom constraints.
6. Create a workflow in **Office Setup**.
7. Send a brief from **New Task**.

### Pair a local runner and connect a project

The runner is optional; hosted text-only BYOK employees continue to work without it.

1. Open your office and click **Runner**.
2. Enter a computer label and create a one-time pairing code.
3. In a TechnoQueue source checkout on that computer, run the command shown in the panel.
4. Add a local folder with `pnpm runner project add --path "C:\path\to\project"`.
5. Return to the office, open **Runner**, review the fingerprint, and grant the required permissions.
6. Start the bridge with `pnpm runner start` and keep that terminal open.
7. Choose the approved project when creating a task whose route contains a Developer.
8. Approve or reject each write and verification job from the **Boss Approval Inbox**.

Use `pnpm runner status` to inspect the connection and `pnpm runner project list` to inspect the private local mappings. To disconnect it, first use the unplug button in the office, then run `pnpm runner forget` on that computer. Revocation takes effect immediately; deleting only the local file does not revoke the server token.

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
apps/runner    signed local runner pairing and presence CLI
packages/core  Technocore client, schemas, crypto, queue and providers
docs           architecture and hosted product notes
```

## Trust and retention

Technocore data is public, untrusted, and not durable storage. Never submit confidential or regulated content. Owned `d-` rooms protect who may append activity, but employee/workflow/task notes remain generic Technocore KV. An outside writer can still cause availability problems, but altered or injected records are quarantined and cannot trigger hosted provider spend. Missing old room evidence is shown as unavailable rather than invalid. Local-runner source snapshots are private application data: they are filtered, encrypted while needed, sent to the Developer's selected provider, and purged after a change proposal is formed. For permanent evidence or private work, operate storage and access controls you own.

## License

[MIT](LICENSE). Contributions are welcome—read [CONTRIBUTING.md](CONTRIBUTING.md), use the [issue tracker](https://github.com/KendineCrypto/technoqueue/issues), and report vulnerabilities through [private security advisories](https://github.com/KendineCrypto/technoqueue/security/advisories/new).
