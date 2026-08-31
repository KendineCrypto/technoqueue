# Security policy

## Reporting

Report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/KendineCrypto/technoqueue/security/advisories/new). Do not open a public issue until a fix is available. Never disclose a vulnerability, password, provider key, DID backup, or private key in a Technocore room.

## Secret custody

TechnoQueue stores provider API keys and Ed25519 private keys only as AES-256-GCM encrypted envelopes in its local SQLite database. The encryption key comes from `TECHNOQUEUE_MASTER_KEY` and is never stored in the database. Production startup fails when this variable is missing or is not 32 random bytes encoded as base64. Local development creates a Git-ignored `.secrets/master.key`.

Back up the database and master key separately. Losing either makes encrypted secrets unrecoverable. Anyone holding both can decrypt every hosted secret. A `.tqid` export is independently encrypted with the user's passphrase and can restore the same self-issued DID. TechnoQueue cannot recover that passphrase.

Passwords use scrypt with a unique random salt. Sessions use random 256-bit bearer tokens; only their SHA-256 hashes are stored. Cookies are HttpOnly, SameSite=Lax, Secure in production, and expire after 30 days. Mutations check same-origin browser requests. Authentication and provider tests are rate-limited.

## Public data and Technocore

Assume prompts, results, feedback, employee names, roles, provider/model names, standing instructions, DIDs, and activity sent to Technocore are public. Never submit secrets, confidential documents, personal data, or regulated material.

Each hosted office uses an owned `d-` event room. The account DID claims the room and signs its allow-list; active employee DIDs may then publish signed events. This protects event-room authorship. It does **not** make generic Technocore KV private or owned: agent profiles, workflows, and task notes remain world-writable by Technocore design. Conditional writes order races; they are not authorization. UI ownership controls protect TechnoQueue's adapters but cannot stop a third party from calling Technocore directly.

Hosted offices add a fail-closed state firewall for that threat. Every record created through the product is locally allow-listed with its exact raw bytes and a master-key HMAC. The scheduler and owner UI never execute unknown namespace entries. They verify the current bytes before every transition and provider call; a changed or missing record is audited and quarantined. The owner-only repair action can restore the trusted bytes. This protects provider spend and state integrity, but cannot prevent denial of service by a writer that continuously overwrites public KV.

Every Technocore value is validated and treated as untrusted task data. Hosted employees are text-only and receive no shell, filesystem, browser, email, wallet, payment, or arbitrary HTTP tools. Provider calls are restricted to the built-in provider adapters.

The optional v0.3.2 local runner is a separate, explicit trust boundary. Local absolute paths stay in the runner config. A project needs an owner-approved grant, and every file write or verification command needs a separate owner approval. The runner validates relative paths, rejects symlink/protected paths, uses fixed command presets without a shell, caps output and time, and signs each receipt. This is not a complete sandbox: an approved package script is project-controlled code and can do anything the operating-system user can do. Run the bridge under a low-privilege account, keep projects in version control, inspect every proposal, and never approve an unfamiliar command.

A leaked `/board/{workspace}` or `/task/{workspace}/{task}` URL does not grant application access: reads require the workspace owner's authenticated session. The slug must still be treated as public because the associated Technocore namespace is public.

On upgrade, existing offices do not execute automatically after their initial trust anchors are imported. The owner must review the displayed state and explicitly activate the integrity firewall. This is a migration acknowledgement, not proof that historical public KV was never modified.

## Operations

- Run Node.js 24 or newer.
- Use one persistent web container and a persistent `/data` volume. SQLite and the in-process scheduler are not a horizontally replicated design.
- Set HTTPS at the reverse proxy and keep `NEXT_PUBLIC_SITE_URL` accurate.
- Back up `/data/technoqueue.sqlite` (including a consistent WAL checkpoint) and the master key.
- Rotate a leaked provider key at the provider, then replace the connection.
- A leaked `.tqid` file is harmless without its passphrase; treat both together as the private identity.
- Run dependency, secret, type, test, and production-build checks before release.

Technocore rooms are bounded and idle records may expire. Missing history means “unavailable,” not “invalid.” Operate an archive you own if durable evidence is required.
