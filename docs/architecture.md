# Architecture

TechnoQueue uses a hybrid state + event model:

```text
Technocore KV            Technocore d- room
current task state       DID-authored activity
        \                    /
         exact-byte verification
                  |
       local HMAC trust anchor
                  |
        owner-only dashboard/runtime
```

KV says what a task currently says. The room says who signed a claim, submission, or review event. The integrity analyzer correlates the current prompt/result hashes and DIDs with currently available signed records.

## Protocol notes

The implementation targets Technocore 0.7.0 as observed on 2026-08-25. Current protocol names allow 48 characters (`^[a-z0-9][a-z0-9_-]{0,47}$`), while TechnoQueue keeps workspaces to 40 characters so the `tq-` prefix remains safe. Technocore now supports POST envelopes for long messages and notes; TechnoQueue uses those lanes while retaining exact-value `if` and `if_absent` semantics.

Current note reads prepend a server-defined untrusted-content banner. `TechnocoreClient` removes that protocol envelope and its optional rate-budget footer, preserving the exact stored note bytes. That exact raw string—not reserialized JSON—is used as the expected value for CAS.

## Queue safety

Claiming, reclaiming, result submission, reviewer claiming and review completion all use CAS. A timeout has an unknown outcome: the client refetches and compares the intended exact value before continuing. A 409 is normal contention and the loser does no work.

Leases reduce dead tasks but do not fence external side effects. TechnoQueue V1 performs only text generation, so the winning KV transition and signed result are the relevant effects. Tool-capable agents require a stronger fencing design and remain roadmap work.

## Hosted state firewall

Generic KV authorization is not assumed. Each hosted write records the key, record kind, exact raw bytes, and an HMAC made with the deployment master key in SQLite. Reads enumerate this local allow-list rather than the public namespace. Before an agent calls a provider, the current Technocore bytes must equal the authenticated local anchor. A mismatch is audited, quarantined, displayed to the owner, and fails closed. Authorized CAS transitions replace the anchor only after the intended exact value is confirmed.

This prevents injected tasks from consuming provider credit and prevents altered profiles, workflows, or tasks from executing. It cannot prevent an outside writer from overwriting world-writable KV and causing denial of service. The repair endpoint restores trusted bytes with CAS; persistent write contention still requires Technocore-side authenticated/owned KV.

## Trust model

Technocore KV is world-writable coordination state, not authenticated state. Signed room records prove DID authorship of their signed bytes. Room `seq` and `ts` are server-assigned, unsigned, and room history is ephemeral. TechnoQueue is not a blockchain, consensus protocol, permanent audit store, or authorization service.
