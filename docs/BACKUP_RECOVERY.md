# DDC Agriculture CRM — Backup & Recovery Plan

> **Governance Table**: `public.backup_records`
> **Orchestration**: Background Worker (`backup_database` job type) + Managed PostgreSQL / Supabase PITR

---

## 1. Recovery Objectives (Target SLAs — Pending DDC Infrastructure Sign-Off)

| Metric | Target | Notes |
|---|---|---|
| **RPO (Recovery Point Objective)** | `<= 15 minutes` (with WAL archiving / PITR enabled) or `<= 24 hours` (daily snapshot baseline) | Requires Supabase Pro/Enterprise PITR or managed PostgreSQL WAL archiving |
| **RTO (Recovery Time Objective)** | `<= 2 hours` | Includes verification of restored database and application smoke tests |

---

## 2. Backup Layers

1. **Automated Daily Logical & Physical Snapshots**:
   - Managed PostgreSQL daily base backup + continuous WAL archiving (PITR).
   - Encrypted at rest (AES-256) in a separate region/storage account from primary compute.
2. **Pre-Migration Snapshots (`backup_type = 'pre_migration'`)**:
   - Mandatory snapshot taken before any production migration window and logged in `public.backup_records` with `checksum`, `size_bytes`, and `storage_uri`.
3. **On-Demand Administrative Backups (`backup_type = 'manual'`)**:
   - Triggered by `Super Admin`, `System Admin`, or `Data Admin` via Admin Control Center → Backup & Recovery (enqueues an idempotent `backup_database` job; credentials stay server-side).
4. **Storage Bucket Replication**:
   - Attachments, logos, and field photos in Supabase Storage backed up on a daily sync schedule with immutable object versioning.

---

## 3. Retention Policy

| Backup Type | Retention Window | Disposal |
|---|---|---|
| Continuous WAL / PITR | 7–14 days | Automatic managed pruning |
| Daily Automated Backups | 30 days | Automated lifecycle expiry |
| Monthly End-of-Month Archive | 12 months | Cold encrypted archive |
| Pre-Migration / Release Snapshots | 90 days | Recorded in `backup_records.retention_until` |
| Audit Log Archives | 5 years (or per Thai statutory/PDPA policy) | WORM / immutable storage |

---

## 4. Verification & Restore Drill Procedure

An untested backup is not a backup. Quarterly restore drills (to an isolated staging/recovery database, NEVER production) must verify:

1. Download latest snapshot and verify SHA-256 `checksum` matches `backup_records.checksum`.
2. Restore into isolated recovery PostgreSQL instance.
3. Verify table row counts (`companies`, `contacts`, `products`, `quotations`, `activities`, `audit_log`), RLS enablement (`schema.test.ts` checks), and sequence values (`setval` integrity).
4. Run smoke test against recovered staging instance.
5. Record `verified_at = now()` and drill report reference in `backup_records`.

---

## 5. Production Disaster Recovery Procedure

> **Approval Requirement**: Destructive production restore requires explicit written authorization from DDC IT Management & `Super Admin`.

1. Enable maintenance mode / pause `apps/worker` job claims to halt concurrent writes.
2. Capture a forensic snapshot of the current damaged database state before overwriting.
3. Restore to target PITR timestamp or verified snapshot into a fresh database instance (preferred over in-place overwrite).
4. Verify integrity checksums, RLS status, and recent `audit_log` entries.
5. Re-point backend connection string to recovered instance, run smoke tests, resume worker, and record post-incident report.
