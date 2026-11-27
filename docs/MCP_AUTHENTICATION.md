# DDC Agriculture CRM — Remote MCP Authentication & Identity Architecture

> **Implementation**: `apps/mcp/src/oauthAuth.ts`, `packages/shared-services/src/principalResolver.ts`, `supabase/config.toml` (`[auth.oauth_server]`), `src/components/supabase/oauth-consent-page.tsx`  
> **Standards**: OAuth 2.1 (Authorization Code + PKCE `S256`), RFC 9728 (Protected Resource Metadata), RFC 8414 (Authorization Server Metadata), RFC 8707 (Resource Indicators)

---

## 1. Identity Principle: User-Delegated OAuth 2.1

Every Remote MCP connection acts **strictly on behalf of an authenticated DDC CRM user** (or an explicitly authorized, least-privilege service account on `/integrations/v1/*`).

**Prohibited patterns:**
- No shared administrator API key across AI clients.
- No database credentials, `SUPABASE_SERVICE_ROLE_KEY`, or deployment secrets exposed to AI clients.
- No trusting of `user_id`, `role`, `role_key`, `organization_id`, `administrator`, or `permissions` passed inside MCP tool arguments.

---

## 2. OAuth Discovery Metadata Endpoints

| Endpoint | Standard | Purpose |
|---|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 (path-aware) | Advertises `resource` (`https://mcp.ddc.example.test/mcp`), `authorization_servers`, `scopes_supported`, and `resource_name` |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 (root alias) | Compatibility alias for AI clients probing root origin |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | Advertises `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `code_challenge_methods_supported: ["S256"]`, `response_types_supported: ["code"]` |

When an unauthenticated or invalid request hits `/mcp`, the server responds with `401 Unauthorized` and a spec-compliant `WWW-Authenticate` challenge:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="ddc-crm-mcp", resource_metadata="https://mcp.ddc.example.test/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Missing Bearer OAuth access token", scope="mcp:read"
Cache-Control: no-store
```

---

## 3. Token & Session Validation Checklist

Every request to `/mcp` runs **all 9 checks** before building a scoped `McpServer`:

1. **Signature / JWKS Verification**: Verified via `jose.jwtVerify` against the Authorization Server's remote JWKS (`${issuerUrl}/.well-known/jwks.json`) or configured key.
2. **Issuer (`iss`)**: Must match `issuerUrl` exactly.
3. **Audience / Resource Indicator (`aud`)**: Must match `expectedAudiences` (RFC 8707 canonical MCP endpoint URL).
4. **Expiration (`exp`)**: Mandatory; expired tokens fail with `401 TOKEN_EXPIRED`.
5. **Subject (`sub`)**: Mandatory UUID mapped to `public.sales.user_id`.
6. **Grant Revocation (`jti`)**: SHA-256 hash of `jti` checked against `public.oauth_grants.revoked_at` and `expires_at`.
7. **Connection Revocation (`connection_uuid` / `X-MCP-Connection-Id`)**: Verified active in `public.mcp_connections` (revoked connections fail with `403 MCP_ACCESS_DISABLED`).
8. **User Revocation Cutoff (`mcp_user_policies.revoked_before`)**: Tokens issued (`iat`) before the administrator's revocation timestamp are immediately rejected even if `exp` is still in the future.
9. **Live Account & Organization Status**: `public.sales.disabled = false` and `public.organizations.is_active = true` are verified live from PostgreSQL (never trusted from stale JWT role claims).

---

## 4. OAuth Scope Catalog

| Scope | Capability Granted (Still Capped by Authoritative CRM RBAC) |
|---|---|
| `mcp:read` | Read-only CRM queries, profiles, analytics, and permitted MCP resources (L0) |
| `mcp:write` | Routine CRM record creation/updates (L1–L2) and validated bulk operations (L3) |
| `mcp:export` | Authorized, field-masked data exports (L3) |
| `mcp:admin` | Administrative inspection and L4 approval-gated user/role operations |
| `mcp:config` | Versioned Web Design / UI Configuration drafts and L4 publish requests |
| `mcp:release` | Release inspection and L5 privileged deployment/rollback requests |
| `mcp:automation` | Background automation job creation and cancellation |

Tokens issued by Supabase Auth without explicit MCP scopes default to least-privilege `["mcp:read"]`.

---

## 5. AI Client Registration & Redirect URI Policy

Registered in `public.mcp_clients` via Admin Control Center (`/admin/v1/mcp/clients`):
- **PKCE (`S256`)** is enforced (`pkce_required = true`).
- **Redirect URI validation** (`McpGovernanceService.registerClient`) allows **only** `https://` URIs or loopback `http://127.0.0.1` / `http://localhost` (native desktop clients per RFC 8252). Arbitrary `http://`, `javascript:`, or custom unvalidated schemes are rejected.
- **Revocation**: Revoking a client (`POST /admin/v1/mcp/clients/:clientId/revoke`) atomically marks `mcp_clients.status = 'revoked'`, revokes all its `oauth_grants` and `mcp_connections`, bumps `organizations.policy_version`, and invalidates `AuthorizationPolicyCache`.
