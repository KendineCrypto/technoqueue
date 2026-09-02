# TechnoQueue staged roadmap

This roadmap orders the proposed agent-service economy by dependency and risk. Version numbers describe the intended sequence, not guaranteed dates. FLOP-network fields and settlement behavior remain provisional until the public testnet specification is final.

## Product boundary

TechnoQueue remains useful without payments. An office owner can connect an allowed provider API or local model, hire private employees, build workflows, and approve work. The future market lists a bounded service offered by an owner-controlled agent; it never lists a ChatGPT, Codex, Claude, or other consumer account, login, browser session, cookie, or transferable API key.

## v0.4 — define useful work before pricing it

### v0.4.0 · Specialist foundation — implemented

- Canonical employee capabilities and a structured specialty profile.
- Specialty data bound into the employee's public Technocore record.
- Specialty prompt section subordinate to the locked role blueprint.
- Pixel-art hiring and employee-file editors.
- Backward-compatible parsing for existing employees.

### v0.4.1 · Outcome contracts — implemented

- Task-level success criteria and required deliverables.
- Machine-readable output kinds such as report, source list, code proposal, test evidence, or final copy.
- Reviewer checklist derived from the contract rather than an unstructured approval guess.
- Immutable, DID-attested task digest covering the brief, criteria, workflow route, project, and expected deliverables.

### v0.4.2 · Reliable paper routes — implemented

- Task-bound retry policy with configurable maximum attempts and initial backoff.
- Exponential retry delays capped at fifteen minutes for rate limits, timeouts, empty output, and temporary upstream failures.
- Optional encrypted fallback provider and model per employee; role, DID, specialty, and locked prompt remain unchanged during failover.
- Permanent authentication and budget failures stop for a boss decision instead of consuming requests indefinitely.
- Canonical waiting, retrying, blocked, and exhausted states stored with the Technocore task.
- Owner-only task recovery resets the interrupted step without changing the signed outcome contract.
- Pixel-office status ribbons, employee speech bubbles, task diagnostics, and a manual recovery control.

### v0.4.3 · Workflow controls — implemented

- Configurable rejection target instead of always returning to the immediately preceding work step.
- Maximum revision count per workflow step.
- Human approval checkpoints between selected steps.
- Safe parallel branches followed by an explicit merge/review step.

## v0.5 — prove the market without real value

### v0.5.0 · Agent service directory

- Owner-controlled opt-in listing generated from a specialist profile.
- Public manifest with DID, capabilities, accepted input, promised deliverables, availability, privacy class, and Paper pricing.
- No provider name, provider credential, private prompt, private key, or consumer-account access in a listing.
- Search and shortlist only; an agent is not callable until its owner runs an authenticated worker endpoint.

### v0.5.1 · Paper contracts and remote workers

- Signed external job envelope bound to a TechnoQueue task and outcome contract.
- Seller-controlled local or hosted worker node with scoped tools and capacity limits.
- Temporary contractor desk and cross-office delivery tracking.
- PaperRail offer, accept, lock, reveal/refund, and receipt lifecycle with a prominent `NO REAL VALUE` label.

### v0.5.2 · Verification and reputation

- Automated evidence checks where the output permits them.
- Separate buyer, worker, reviewer, and optional arbiter identities.
- DID-linked completed-job history, delivery time, acceptance rate, and dispute rate.
- Sybil/spam resistance design before any score can influence payment.
- Privacy warnings and task classes; secrets are rejected from public or untrusted workers.

## v0.6 — tclk and FLOP testnet

- Replace the PaperRail adapter only after the actual testnet rail and contract semantics are published and reviewed.
- Office wallet onboarding, recovery, explicit spend approvals, and transaction receipts.
- Per-task and per-agent FLOP budgets, daily caps, and an owner reserve.
- Real tclk contract ID and settlement state in the Deal panel.
- Optional FLOP-funded inference for users without a provider connection.
- External specialist payment for an accepted result.
- No reward promise, synthetic activity loop, automatic faucet farming, or hidden spending.

## Later gates

These features require evidence that the preceding layer is safe and useful:

- Competitive bids and milestone contracts.
- Paid reusable workflow templates.
- Agent-to-agent subcontracting with explicit maximum depth and budget.
- Private workloads on trusted workers or an audited confidential-compute design.
- Platform fees or monetization only after reliable delivery, disputes, refunds, and accounting exist.

## Release rule

Payments do not ship merely because a wallet can send tokens. Before real value moves, TechnoQueue must be able to answer four questions from signed records: who accepted the job, what exact outcome was promised, what evidence was delivered, and who authorized settlement.
