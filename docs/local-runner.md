# Local runner security

TechnoQueue v0.3.3 provides a deliberately narrow local execution bridge. It can prepare a filtered project snapshot, apply an exact owner-approved set of UTF-8 file contents, and run one of four owner-approved verification presets. It does not receive provider keys, expose a general shell API, deploy, push Git commits, delete files, spend funds, or grant itself access.

## Pairing and identity

1. A signed-in office owner creates a 10-minute pairing code.
2. The server stores only a domain-separated SHA-256 hash of the code and a random challenge.
3. The runner creates an Ed25519 keypair locally and signs the pairing payload.
4. The server consumes the code transactionally and returns a random bearer token once; only its hash is stored server-side.
5. Heartbeats carry a strictly increasing sequence and runner DID signature. Replay, token, and signature failures are rejected.

## Project grants

Run:

```powershell
pnpm runner project add --path "C:\path\to\project" --label "My app"
```

The canonical absolute path remains only in `~/.technoqueue/runner.json`. The server receives the label and a SHA-256 fingerprint domain-separated with the runner DID. The office shows the full fingerprint for verification and copying. The owner must approve the project before a job can read it. Revoking the grant cancels queued and running jobs; a warning remains when local changes may already have happened.

Permissions are independent:

- `read`: create a filtered context snapshot;
- `write`: accept exact file-content proposals after per-job approval;
- `verify`: run an allow-listed package command after per-job approval.

## Execution boundary

Context collection skips symlinks, `.git`, dependency/build/cache directories, `.env*`, credentials, secret/private-key/service-account-like filenames, unsupported extensions, large files, and configured byte/file limits. This filtering reduces accidental disclosure but is not a data-loss-prevention guarantee. Review the project before connecting it. The private snapshot is encrypted with the server master key while it is needed, never returned by the browser API, supplied to the employee's configured AI provider for a Developer task, and purged after the file proposal is created. Unconsumed snapshots expire after 24 hours by default (`TECHNOQUEUE_RUNNER_SNAPSHOT_TTL_HOURS`). It is not written into the public Technocore task record.

File proposals are parsed against a strict schema. The runner rejects absolute paths, traversal, Windows device names and alternate data streams, ambiguous trailing dots/spaces, protected or generated paths, parent directories resolving outside the grant, and symlink targets. It never deletes a project file. Proposed contents are written to exclusive temporary files first, then renamed into place; an error triggers best-effort restoration of already changed files. The signed receipt hashes the final bytes read back from disk.

Verification has no arbitrary command string. Current presets are `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `npm test`. They use pinned package-manager JavaScript entrypoints without a shell on Windows and Unix, with a reduced environment, a 120-second timeout, and capped output. A non-zero exit fails the job and its output remains visible to the owner. **Package scripts are project code and can execute arbitrary behavior with the runner user's access, including inherited network and credentials.** Approve a verification job only if you would run that script yourself.

Every approved request is bound to its exact SHA-256 digest. Every completed job sends a result hash, timestamp, status, and DID signature. Jobs carry an expiring lease; the server verifies the current permission, hash, signature, and lease before accepting a receipt. Late and replayed receipts are rejected.

## Local custody and revocation

`~/.technoqueue/runner.json` contains the runner private key, bearer token, sequence, and local project paths. It is created with user-only Unix permissions where supported and inherits the Windows profile ACL. Never sync, commit, upload, screenshot, or send it to support.

Revoke a project grant or unplug the runner from the office before deleting the local config. Runner revocation invalidates the bearer token immediately. Project and runner revocation do not undo files already changed by an approved completed job; use source control to inspect and revert those changes.

## Still out of scope

- arbitrary shell commands;
- package installation;
- file deletion or unrestricted binary writes;
- browser, wallet, email, deployment, Git push, or payment actions;
- automatic privileges based only on DID identity;
- FLOP balances, settlement, inference purchases, or testnet assumptions.
