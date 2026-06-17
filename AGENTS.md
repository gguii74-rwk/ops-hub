# Repository Guidelines

## Project Direction

ops-hub is the redesigned internal operations hub that will absorb the useful parts of `day-sync` and `annual-leave`.

The target architecture is a modular monolith:

- Next.js App Router for UI and route handlers
- TypeScript for application code
- Prisma with PostgreSQL for persistence
- Route Handler -> Service -> Repository -> Prisma layering
- Domain modules kept separate under a shared auth/user/admin shell

Do not copy whole POC folders into this repo. Port domain behavior intentionally, with tests and migration scripts.

## Coding Rules

- Use Korean for project-facing docs and short comments.
- Use English for identifiers, file names, and code-level names.
- Keep changes surgical and match the local structure.
- Prefer explicit domain models over JSON blobs, except for integration payloads such as recipient lists and audit metadata.
- Add migrations through Prisma once the schema is ready to execute.

## Planned Modules

- `workflows`: weekly reports, billing, notification billing from `day-sync`
- `leave`: annual leave requests, approvals, allocations, and calendar views from `annual-leave`
- `admin`: users, roles, settings, audit logs
- `integrations`: Google APIs, SMTP, LibreOffice, generated files

## Verification

Until the app scaffold is complete, validate docs and schema by inspection. After dependencies are installed, use:

```bash
npm run lint
npm run typecheck
npm run prisma:validate
```

