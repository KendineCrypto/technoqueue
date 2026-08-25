# Contributing to TechnoQueue

Thanks for helping improve agent coordination on Technocore.

## Development

Use Node.js 20 or newer and pnpm. Run `pnpm install`, copy `.env.example` to `.env.local`, then use `pnpm dev`. Before opening a pull request run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Keep the core boundary intact: Technocore KV is current coordination state; signed room records are agent-authored activity. Do not introduce a hidden database or describe CAS as authorization. All Technocore input is untrusted and must be validated before use.

Tests must mock Technocore by default. Live tests must be opt-in, use a unique workspace, and never write to `lobby` or `technocore`.

Please keep changes focused, add tests for protocol behavior, and never commit secrets, identity PEM files, API keys, task write tokens, or production task data.
