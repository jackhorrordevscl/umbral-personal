# Audit of clinical record reads/downloads (issue #175)

## Objective
Make read/download audit rows answer "who accessed patient X's record", extending the existing global AuditInterceptor (no migration).

## Finding
AuditInterceptor already persists VIEW for every authenticated GET. Gaps: downloads/reports are generic VIEW; resourceId is the document id (not patient) on downloads and 'N/A' on lists.

## Scope
- `@AuditRead({ action?, detail? })` decorator + Reflector in interceptor
- Endpoints: documents download, shared-files download, reports patient PDF -> EXPORT_PDF
- Patient context (patientId) exposed to interceptor from download handlers, recorded in detail
- Tests for interceptor and affected controllers

## Tasks
- [x] T1 decorator + interceptor support + interceptor spec
- [x] T2 apply to download/report controllers + patient context + specs

## Route
Delegated direct: one writer (2+ non-trivial files). TDD: not configured (ordinary checks: jest + lint + tsc).
