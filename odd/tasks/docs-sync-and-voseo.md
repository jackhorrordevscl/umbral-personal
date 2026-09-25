# docs-sync-and-voseo

Objective: bring README and docs in line with the code at main 6820ed0, and remove voseo.
Scope: documentation and comments only, plus one UI placeholder. No behavior change.
TDD: not applicable (docs). Checks: frontend lint/typecheck/tests for the placeholder change.
Route: T1 inline (3 mechanical edits); T2-T4 delegated writer (2+ non-trivial files).

- [x] T1 Remove voseo: README `generá`/`usala`, ProfilePage placeholder `sobre vos`
- [x] T2 README: frontend/backend structure trees, tech stack, endpoint list, env var table, stale "#170 parte pendiente"
- [x] T3 docs: registro-actividades-tratamiento (schema.prisma line refs), incident-log (#61 is CLOSED), npm-audit README (post-2026-09-25 note)
- [x] T4 code comments: document-encryption.service.ts (backup.sh -> backup.yml), RecoveryCodesReveal.tsx (SettingsPage -> SecurityPage)

Out of scope (decision left to the user): `acá` regionalism (~150 occurrences), render.yaml optional keys.
Evidence: audit report from the read-only mapper; #170 and #61 verified CLOSED via gh.
