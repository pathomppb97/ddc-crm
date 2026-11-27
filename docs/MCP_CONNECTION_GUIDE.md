# DDC Agriculture CRM — Remote MCP Connection Guide

> **Transport**: Streamable HTTP (`2025-11-25`) over HTTPS  
> **Auth**: OAuth 2.1 Authorization Code + PKCE (`S256`) + RFC 9728 Protected Resource Metadata  
> **Admin Setup UI**: Admin Control Center → **AI & MCP Management → MCP Connection Setup** (`/mcp/setup`)

---

## 1. Endpoint URLs & Discovery

| Resource | Standalone MCP Server (`apps/mcp`) | Supabase Edge Function (`supabase/functions/mcp`) |
|---|---|---|
| Remote MCP Endpoint | `https://mcp.ddc.example.test/mcp` | `https://<project-ref>.supabase.co/functions/v1/mcp` |
| Protected Resource Metadata (RFC 9728) | `https://mcp.ddc.example.test/.well-known/oauth-protected-resource/mcp` | `https://<project-ref>.supabase.co/.well-known/oauth-protected-resource/functions/v1/mcp` |
| Authorization Server Metadata (RFC 8414) | `https://mcp.ddc.example.test/.well-known/oauth-authorization-server` | `https://<project-ref>.supabase.co/auth/v1/.well-known/oauth-authorization-server` |
| Health Check | `GET https://mcp.ddc.example.test/health` | `GET /api/v1/health` |

> **Local Development**: Run the standalone server (`apps/mcp/src/nodeServer.ts`) with `MCP_ALLOW_INSECURE_LOCAL_ISSUER=true` for `http://127.0.0.1:4100/mcp`. **Never** enable insecure HTTP issuers in staging or production.

---

## 2. AI Client Verification Matrix (Honest Status)

DDC distinguishes explicitly between clients verified in automated protocol tests and external commercial AI clients that require live tenant OAuth testing:

| AI Client | Transport | Auth Flow | Verification Status |
|---|---|---|---|
| **Official MCP Streamable HTTP Client (`@modelcontextprotocol/server@2.4.0` test harness)** | Streamable HTTP (`2025-11-25`) | OAuth 2.1 Bearer JWT + RFC 9728 / RFC 8414 | **Verified** in `apps/mcp/src/mcpPlatform.test.ts` (initialize, tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get, SSE + JSON responses) |
| **Claude Desktop / Claude Web (Remote MCP Connector)** | Streamable HTTP | OAuth 2.1 + PKCE (`S256`) | **Unverified in live tenant** — standards-aligned configuration template provided below; requires staging OAuth end-to-end test with registered redirect URI |
| **ChatGPT (Developer / MCP Connectors)** | Streamable HTTP | OAuth 2.1 + PKCE (`S256`) | **Unverified in live tenant** — standards-aligned configuration template provided below; requires staging OAuth end-to-end test |
| **VS Code / Cursor / Windsurf / Custom Enterprise Agents** | Streamable HTTP | OAuth 2.1 + PKCE (`S256`) | **Unverified in live tenant** — compatible with RFC 9728 discovery; register client redirect URI in Admin → AI Client Management |

---

## 3. Client Configuration Templates

### Generic Streamable HTTP + OAuth 2.1 Client Config (`mcp.json`)
```json
{
  "mcpServers": {
    "ddc-agriculture-crm": {
      "type": "streamable-http",
      "url": "https://mcp.ddc.example.test/mcp",
      "auth": {
        "type": "oauth2",
        "pkce": "S256",
        "scopes": ["mcp:read", "mcp:write"]
      }
    }
  }
}
```

### Step-by-Step Onboarding
1. **Administrator Registers AI Client**: In Admin Control Center → **AI Client Management**, register the client's `client_id`, HTTPS or loopback redirect URIs, allowed scopes (e.g. `mcp:read`, `mcp:write`), and rate limit.
2. **User Initiates Connection**: Point the AI client to `https://mcp.ddc.example.test/mcp`.
3. **OAuth Discovery & Consent**: The server returns `401` with `WWW-Authenticate: Bearer ... resource_metadata="..."`. The client fetches RFC 9728 metadata, opens the DDC OAuth consent screen (`/#/oauth/consent`), and completes PKCE (`S256`) code exchange.
4. **Scoped Discovery**: The client calls `initialize` and `tools/list`. Only tools authorized for the signed-in user's live role, OAuth scopes, and risk level are returned.
5. **First Health Verification**: Ask the assistant to run `get_my_profile` and `get_my_capabilities` to confirm your role, territory, and available tools.

---

## 4. Common Error Responses & Troubleshooting

| Error Code | HTTP / MCP Result | Cause & Resolution |
|---|---|---|
| `AUTHENTICATION_REQUIRED` | HTTP `401` | Missing or invalid Bearer JWT. Re-authenticate via OAuth 2.1 flow. |
| `TOKEN_EXPIRED` | HTTP `401` | Access token expired. Refresh token or reconnect AI client. |
| `ACCOUNT_SUSPENDED` | HTTP `403` | CRM account has `sales.disabled = true`. Contact System Administrator. |
| `MCP_ACCESS_DISABLED` | HTTP `403` | Organization, role, user, client, or connection MCP access was disabled/revoked. |
| `TOOL_DISABLED` | MCP `isError: true` | Tool is currently disabled in Admin → Tool Registry. |
| `PERMISSION_DENIED` | MCP `isError: true` | Missing CRM RBAC permission, OAuth scope, explicit DENY override, or risk limit exceeded. |
| `DATA_SCOPE_DENIED` | MCP `isError: true` | Target record belongs to another salesperson (`own` scope) or another organization. |
| `CONFIRMATION_REQUIRED` | MCP `isError: true` | L3 bulk/export operation requires a valid `confirmation_token` from `validate_import` or `preview_bulk_update`. |
| `APPROVAL_REQUIRED` | MCP `isError: true` | L4/L5 action created a pending request in Admin → Approval Center; wait for independent human approval and re-invoke with the exact approved payload and `approval_id`. |
| `RATE_LIMIT_EXCEEDED` | MCP `isError: true` | Slow down tool calls; check `details.retryAfterSeconds`. |

---

## 5. Disconnecting or Revoking Access

- **Single Connection**: Admin Control Center → **User MCP Access** or **MCP Connection Setup** → click **Revoke** on the active connection (`POST /admin/v1/mcp/connections/:uuid/revoke`).
- **All Connections for a User**: Admin Control Center → **User MCP Access** → **Revoke All** (`POST /admin/v1/mcp/users/:salesId/revoke`) — immediately invalidates all active grants, connections, and tokens issued before the revocation timestamp.
- **Emergency Organization Kill Switch**: Admin Control Center → **MCP Overview** → toggle **Organization MCP Access = Disabled** (`PUT /admin/v1/mcp/organization-policy`).
