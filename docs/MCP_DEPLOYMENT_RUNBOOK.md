# DDC Agriculture CRM — Remote MCP & Enterprise API Deployment Runbook

> **Production Safety Rule**: Never execute production deployments, schema drops, or secret rotations without explicit human approval and a verified pre-migration backup.

---

## 1. Environment Isolation Matrix

| Environment | CRM Web (`dist/`) | Admin Control Center (`dist-admin/`) | Enterprise API (`/api/v1`, `/admin/v1`, `/integrations/v1`) | Remote MCP Server (`/mcp`) | Database |
|---|---|---|---|---|---|
| **Development** | `http://localhost:5173` | `http://localhost:5179` | Local Supabase Edge (`api_v1`) or Node | `http://127.0.0.1:4100/mcp` (`MCP_ALLOW_INSECURE_LOCAL_ISSUER=true`) | Local Supabase Postgres / PGlite |
| **Staging** | `https://staging-crm.ddc.example.test` | `https://staging-admin.ddc.example.test` | `https://staging-api.ddc.example.test` | `https://staging-mcp.ddc.example.test/mcp` (HTTPS required) | Isolated Staging Supabase DB |
| **Production** | `https://crm.ddc.example.test` | `https://admin.ddc.example.test` | `https://api.ddc.example.test` | `https://mcp.ddc.example.test/mcp` (TLS 1.3 + HSTS + Origin allowlist) | Production Supabase DB (PITR + backups) |

---

## 2. Required Server Environment Variables (Never in `VITE_*` Client Bundles)

### Standalone Remote MCP Server (`apps/mcp/src/nodeServer.ts`)
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for RLS-scoped pool |
| `MCP_RESOURCE_URL` | Yes | Public canonical URL, e.g. `https://mcp.ddc.example.test/mcp` |
| `OAUTH_ISSUER_URL` | Yes | OAuth 2.1 / Supabase Auth issuer, e.g. `https://<ref>.supabase.co/auth/v1` |
| `OAUTH_EXPECTED_AUDIENCES` | Yes | Comma-separated expected `aud` values (`https://mcp.ddc.example.test/mcp,authenticated`) |
| `OAUTH_JWKS_URL` | Optional | Defaults to `${OAUTH_ISSUER_URL}/.well-known/jwks.json` |
| `MCP_ALLOWED_ORIGIN_HOSTNAMES` | Prod: Yes | Comma-separated allowed browser origins for DNS rebinding protection |
| `MCP_CORS_ORIGIN` | Prod: Yes | Explicit allowed origin (do not leave `*` in production) |
| `MCP_PORT` / `MCP_HOST` | Optional | Default `127.0.0.1:4100` behind TLS reverse proxy |
| `MCP_ALLOW_INSECURE_LOCAL_ISSUER` | Dev Only | Must be unset/`false` in staging & production |

### Supabase Edge Functions (`api_v1`, `mcp`)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` (injected by Supabase platform secrets).
- Ensure `[auth.oauth_server]` is enabled in `supabase/config.toml` and registered AI client redirect URIs are allowlisted.

---

## 3. Pre-Deployment Verification Checklist

Run all automated quality and security gates before promoting any release:
```bash
npm run typecheck
npm run typecheck:enterprise
npm run lint
npm run test:db
npm run test:enterprise
npm run test:unit:functions -- --run
npm run build
npm run build:admin
```

Verify database migration readiness:
1. Confirm `supabase/migrations/20261127150000_ddc_mcp_platform.sql` is tested against staging snapshot with zero data loss.
2. Verify `mcpApp.syncRegistry()` populates `public.mcp_tools` with all 71 registered operational tools.
3. Verify `GET /.well-known/oauth-protected-resource/mcp` returns `200` with HTTPS `resource` and `authorization_servers`.
4. Verify unauthenticated `POST /mcp` returns `401` with RFC 9728 `WWW-Authenticate` header.
5. Verify `GET /health` and `GET /api/v1/health` return `200` with `mcpProtocolVersion: "2025-11-25"`.

---

## 4. Rollback & Emergency Containment Procedures

### Immediate MCP Containment (Zero-Downtime, No Redeploy)
1. **Disable Single Misbehaving Tool**: Admin Control Center → Tool Registry → toggle tool off (`PATCH /admin/v1/mcp/tools/:toolName`).
2. **Global MCP Kill Switch**: Admin Control Center → MCP Overview → set `mcpEnabled = false` (`PUT /admin/v1/mcp/organization-policy`). All active MCP connections immediately receive `403 MCP_ACCESS_DISABLED`.
3. **Revoke Compromised Client or User**: Admin Control Center → AI Client Management / User MCP Access → Revoke.

### Application / Build Rollback
- **CRM Web (`dist/`)** and **Admin Control Center (`dist-admin/`)** are independently built and deployed; rolling back one never forces rolling back the other.
- **Standalone MCP Server (`apps/mcp`)**: Re-route reverse proxy to the previous immutable release artifact and run health + OAuth discovery smoke tests.
- **Database Migrations**: Migrations follow expand-and-contract rules (additive tables/columns only); never run destructive `DROP TABLE` rollbacks on production data.
