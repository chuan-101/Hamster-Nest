# Companion scheduler database smoke

This smoke test runs the companion scheduler migration against an ephemeral
PostgreSQL 17.6 instance. The fixture contains only local fake data and must
never be pointed at a linked or remote database.

Install the pinned runtime packages into a one-time module directory:

```sh
COMPANION_SMOKE_MODULES=$(mktemp -d /tmp/hamster-companion-modules.XXXXXX)
npm install \
  --prefix "$COMPANION_SMOKE_MODULES" \
  --no-package-lock \
  --no-save \
  embedded-postgres@17.6.0-beta.15 \
  @supabase/postgres-meta@0.96.6
```

Run the complete forward, permission, idempotency, rollback, type-generation,
and advisor smoke:

```sh
npm run db:smoke:companion -- --module-root "$COMPANION_SMOKE_MODULES"
```

After the command exits, confirm the variable still resolves under the exact
`/tmp/hamster-companion-modules.` prefix, then remove that one directory. The
runner always stops and removes its ephemeral database directory in `finally`.
