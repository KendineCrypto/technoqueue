# Local runner security

TechnoQueue v0.3.0 introduces the identity and presence channel for a future local workforce. It does **not** execute tasks, read projects, open a shell, or receive provider API keys.

## Pairing flow

1. A signed-in office owner creates a 10-minute pairing code.
2. The server stores only a domain-separated SHA-256 hash of that code and a random challenge.
3. The runner creates a new Ed25519 keypair on the user's computer.
4. The runner signs a canonical payload containing the pairing code, server challenge, runner DID, label, platform, and version.
5. The server reconstructs the public key from the `did:key`, verifies the signature, consumes the code in a database transaction, and returns a random bearer token once.
6. The server stores only the SHA-256 hash of the bearer token.

Pairing requires both knowledge of the short-lived code and possession of the newly created DID private key. A code cannot be reused after the transaction commits.

## Heartbeats

Every heartbeat requires:

- the runner ID and bearer token;
- a strictly increasing sequence number;
- a canonical heartbeat payload signed by the paired runner DID.

The server rejects token failures, invalid DID signatures, and replayed sequence numbers. The UI marks a runner online for 30 seconds after a valid heartbeat, recent for another 90 seconds, then offline.

## Local secrets

The runner writes its private key, bearer token, DID, and last sequence number to:

```text
~/.technoqueue/runner.json
```

The file is created with user-only Unix permissions where supported. On Windows it inherits the current user's profile ACL. Do not sync, commit, upload, screenshot, or send this file to support. Anyone with both the file and access to its paired endpoint can impersonate that runner until the owner revokes it.

To revoke a machine, open **Runner** in the office and click the unplug button. Revocation invalidates the server token immediately. The local file is intentionally not remotely deleted.

## Explicit non-goals in v0.3.0

- no filesystem or repository access;
- no shell or process execution;
- no remote task dispatch;
- no provider credentials on the runner;
- no automatic privileges based on DID identity.

Those capabilities require a separate grant model, path allow-listing, per-job approval and execution sandbox. They must not be inferred from a successful heartbeat.
