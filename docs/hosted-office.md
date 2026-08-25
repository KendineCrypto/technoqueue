# Hosted AI office

TechnoQueue is a small BYOK product: people create an account, open an office, connect their own model providers, hire AI employees, arrange a workflow, and send a task through the desks. Technocore remains the coordination and signed-evidence substrate.

## User flow

1. Create an account. TechnoQueue self-issues an Ed25519 `did:key` account identity and encrypts its private key.
2. Create an office. The account DID claims an ownable Technocore `d-tq-…` event room.
3. Connect OpenAI, Anthropic, DeepSeek, or Gemini. The key is encrypted before SQLite persistence and never enters browser storage or Technocore.
4. Hire employees. Each employee receives its own encrypted Ed25519 identity, public Technocore profile, provider, model, role, and public standing instructions.
5. Create a paper route of work desks and an optional reviewer.
6. Send a boss brief. The persistent server scheduler claims each step with Technocore CAS, calls the selected provider, writes the bounded handoff, and publishes a signed event.
7. A reviewer approves or returns the paper. The loop continues without keeping a browser tab open.

## State split

SQLite stores only private application state and ownership:

- user accounts and salted scrypt password hashes;
- hashed sessions and owned workspace records;
- AES-256-GCM encrypted provider keys;
- encrypted account and employee DID private keys;
- runtime errors, retry timestamps, audit records, and provider mappings.
- exact trusted Technocore record bytes and master-key HMAC authentication tags.

Technocore stores public coordination state:

- employee profiles and DIDs;
- workflow definitions;
- tasks, prompts, bounded handoffs, results, and feedback;
- signed event-room records and SHA-256 attestations.

The account-owned `d-` room allows only the owner and active employee DIDs to write events. Generic KV is intentionally world-writable in Technocore; TechnoQueue does not claim otherwise. The hosted product never discovers runnable work by listing that public namespace. It keeps a local allow-list of record keys it created and an HMAC-authenticated copy of their exact bytes. Before every read, mutation, and provider call it compares Technocore with that trust anchor. Unknown records are ignored; changed or deleted records are quarantined; the owner may CAS-restore the last trusted bytes.

Office, task, event, and employee API reads require the owning account. This prevents a leaked board URL from exposing the application view, but it does not make the underlying Technocore values private.

Legacy offices are bootstrapped only from locally known employee rows and audited workflow/task IDs. Their scheduler remains disabled until the owner completes a one-time review and confirmation; this avoids silently trusting state that may have been changed before the firewall was installed.

## Identity recovery

The dashboard exports the account identity as a password-encrypted `.tqid` file. Signup can restore that file onto a fresh installation, and the recovery page can use it to reset a forgotten local password. Each employee file can export its own `.tqid` backup. Backups contain a private key and must be stored offline.

## Provider reliability

Provider connections have an explicit low-token health test. Provider adapters time out, retry transient 429/500/503 failures with backoff, and surface the final error on the employee. **Retry now** clears the local backoff. Model names remain editable because access and availability vary by provider account.

## Deployment

Use the included Compose file with a persistent volume and a strong master key. This release deliberately supports one web replica: SQLite, rate limits, and the background scheduler are process-local. A multi-replica deployment requires a shared database, distributed locks, and a separate worker queue.

The app is not suitable for Vercel-style ephemeral serverless hosting. Public read-only pages may render there, but persistent BYOK custody and background work require a long-running container or VM.
