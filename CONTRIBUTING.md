# Contributing to OpenTag

## Development

```bash
npm install
npm test
npm run check
npm run start:console
```

## Design constraints

- Keep gateways separate from runtime adapters.
- Keep Slack tokens out of runtime processes unless explicitly configured.
- Add tests for policy, storage, and adapter behavior before changing those modules.
- Prefer conservative runtime defaults. Read-only first; write access through approval.
