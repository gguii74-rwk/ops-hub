# Codex session shell and sync lessons

Date: 2026-06-22

Lessons from the Codex session that should not be repeated.

## PowerShell command hygiene

- Quote paths containing parentheses. In PowerShell, `src/app/(app)/...` without quotes is parsed as an expression and can fail with `app : The term 'app' is not recognized...`. Use `git diff -- 'src/app/(app)/...'`.
- Prefer `npm.cmd` on Windows PowerShell. Calling `npm` can resolve to `npm.ps1`, which may be blocked by execution policy. Use `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test -- ...`, and `npm.cmd run build`.
- For remote Linux commands with quoted paths, parentheses, pipes, or several commands, avoid one-line SSH quoting. Use the stdin script pattern:
  `@'...script...'@ | ssh host "tr -d '\r' | bash"`.
- If Korean text looks broken in `Get-Content` or `Select-String`, do not use that rendered output as logic evidence. Prefer ASCII paths/classes, `git diff`, source bytes, or app behavior.

## Next.js generated files

- `next dev` can create `.next/dev/types`. If `next-env.d.ts` points at `.next/types/routes.d.ts`, `tsc --noEmit` may fail with a `LayoutRoutes` mismatch even when code is fine. Clear `.next/dev/types` and retry before treating it as a code bug.
- `next build` or `next dev` can flip `next-env.d.ts` between `.next/types` and `.next/dev/types`. Check the diff and do not keep generated type-reference churn unless it is intentionally part of the task.

## ops-hub local vs dev-server sync

- When the dev-server UI differs from local, compare branch and commit first:
  `git rev-parse HEAD`, `git branch -vv`, `git log --oneline --decorate --graph --all`.
  On the server: `cd /home/kgs/apps/ops-hub && git rev-parse HEAD && git status -sb`.
- 2026-06-22 example: local was `feat/navigation-cms` at `78a9f02`; dev server was `fix/admin-submenu-tabs` at `071c388`. The admin submenu commit `b463b5c` existed locally, but was not an ancestor of the current branch, so it was not in the working tree.
- If local ops-hub shows Prisma `localhost:5432` connection errors, check `workspace-env/INVENTORY.md` first. The dev DB is remote `kgs-dev:5433` tunneled to local `localhost:5432`:
  `ssh -fN -L 5432:localhost:5433 kgs-dev`.

## Product Design / skill install

- `frontend-skill` may be mentioned on the Open Design page while missing from the current `openai/skills` main catalog. Do not install an archived commit or Open Design stub as "official latest". If the user says official-only, stop and judge by the current official catalog.
