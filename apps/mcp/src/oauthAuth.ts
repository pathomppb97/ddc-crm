import {
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  type AuthInfo,
  type AuthMetadataOptions,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import * as jose from "jose";
import { PlatformError } from "../../../packages/shared-auth/src/index";
import { MCP_SUPPORTED_OAUTH_SCOPES } from "./toolRegistry";

export interface McpOAuthConfig {
  /** Public canonical URL of this MCP endpoint (RFC 8707 resource), e.g. https://mcp.ddc.example.test/mcp */
  resourceServerUrl: string;
  /** Authoritative OAuth 2.1 / OIDC issuer (e.g. https://<project>.supabase.co/auth/v1) */
  issuerUrl: string;
  /** Expected JWT audience (defaults to resourceServerUrl or "authenticated" for Supabase GoTrue) */
  expectedAudiences: string[];
  /** Optional JWKS URL (defaults to `${issuerUrl}/.well-known/jwks.json`) */
  jwksUrl?: string;
  /** Optional local verification key (e.g. test symmetric or asymmetric public key) */
  verificationKey?: jose.CryptoKey | Uint8Array;
  /** Allow HTTP localhost issuer in local dev/test ONLY */
  allowInsecureLocalIssuer?: boolean;
  /** Optional service documentation URL */
  serviceDocumentationUrl?: string;
}

export interface VerifiedMcpToken {
  userId: string;
  clientId?: string;
  scopes: string[];
  jti?: string;
  connectionUuid?: string;
  expiresAt: number;
  issuedAt?: number;
  audience: string | string[];
  rawToken: string;
  authInfo: AuthInfo;
}

export function buildMcpAuthMetadataOptions(
  cfg: McpOAuthConfig,
): AuthMetadataOptions {
  const issuer = cfg.issuerUrl.replace(/\/$/, "");
  const oauthMetadata: OAuthMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_SUPPORTED_OAUTH_SCOPES],
  };

  return {
    oauthMetadata,
    resourceServerUrl: new URL(cfg.resourceServerUrl),
    resourceName: "DDC Agriculture CRM Remote MCP Server",
    scopesSupported: [...MCP_SUPPORTED_OAUTH_SCOPES],
    serviceDocumentationUrl: cfg.serviceDocumentationUrl
      ? new URL(cfg.serviceDocumentationUrl)
      : undefined,
    dangerouslyAllowInsecureIssuerUrl: Boolean(cfg.allowInsecureLocalIssuer),
  };
}

export function handleOAuthDiscoveryRequest(
  req: Request,
  cfg: McpOAuthConfig,
): Response | undefined {
  const opts = buildMcpAuthMetadataOptions(cfg);
  // SDK serves /.well-known/oauth-protected-resource[/<path>] and /.well-known/oauth-authorization-server
  const sdkRes = oauthMetadataResponse(req, opts);
  if (sdkRes) return sdkRes;

  // Also serve root /.well-known/oauth-protected-resource alias for clients probing root
  const url = new URL(req.url);
  if (
    req.method === "GET" &&
    url.pathname === "/.well-known/oauth-protected-resource"
  ) {
    const metadata = buildOAuthProtectedResourceMetadata(opts);
    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  return undefined;
}

export function buildUnauthorizedChallengeResponse(
  cfg: McpOAuthConfig,
  error: PlatformError,
  requestId: string,
  requiredScopes: string[] = ["mcp:read"],
): Response {
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(
    new URL(cfg.resourceServerUrl),
  );
  const oauthErrorCode =
    error.code === "TOKEN_EXPIRED" ? "invalid_token" : "invalid_token";
  const scopePart =
    requiredScopes.length > 0 ? `, scope="${requiredScopes.join(" ")}"` : "";
  const wwwAuth = `Bearer realm="ddc-crm-mcp", resource_metadata="${metadataUrl}", error="${oauthErrorCode}", error_description="${error.message.replace(/"/g, "'")}"${scopePart}`;

  return new Response(
    JSON.stringify({
      error: error.toSafePayload(requestId),
    }),
    {
      status: error.httpStatus === 403 ? 403 : 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": wwwAuth,
        "X-Request-Id": requestId,
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": "WWW-Authenticate, X-Request-Id",
      },
    },
  );
}

/**
 * Verifies an OAuth 2.1 Bearer JWT for the Remote MCP Server:
 * - Signature (JWKS or configured verification key)
 * - Issuer (exact match)
 * - Audience / RFC 8707 resource indicator
 * - Expiration (exp required & enforced)
 * - Subject (user UUID required)
 * - Scopes (scope string or scp array)
 */
export class McpOAuthVerifier {
  private readonly jwks?: ReturnType<typeof jose.createRemoteJWKSet>;

  constructor(private readonly cfg: McpOAuthConfig) {
    if (!cfg.verificationKey) {
      const jwksEndpoint =
        cfg.jwksUrl ??
        `${cfg.issuerUrl.replace(/\/$/, "")}/.well-known/jwks.json`;
      this.jwks = jose.createRemoteJWKSet(new URL(jwksEndpoint));
    }
  }

  async verifyRequest(req: Request): Promise<VerifiedMcpToken> {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Missing Bearer OAuth access token",
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Empty Bearer OAuth access token",
      );
    }

    let payload: jose.JWTPayload;
    try {
      const verifyOpts: jose.JWTVerifyOptions = {
        issuer: this.cfg.issuerUrl.replace(/\/$/, ""),
        audience: this.cfg.expectedAudiences,
      };
      const verified = this.cfg.verificationKey
        ? await jose.jwtVerify(token, this.cfg.verificationKey, verifyOpts)
        : await jose.jwtVerify(token, this.jwks!, verifyOpts);
      payload = verified.payload;
    } catch (err) {
      if (err instanceof jose.errors.JWTExpired) {
        throw new PlatformError(
          "TOKEN_EXPIRED",
          "OAuth access token has expired",
        );
      }
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "OAuth access token failed signature, issuer, or audience verification",
      );
    }

    if (!payload.sub || typeof payload.sub !== "string") {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "OAuth access token is missing subject (sub) user identity",
      );
    }

    if (!payload.exp || typeof payload.exp !== "number") {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "OAuth access token must carry an explicit expiration (exp)",
      );
    }

    // Parse scopes from standard OAuth "scope" (space-separated) or "scp" (array)
    let scopes: string[] = [];
    const rawScope = payload.scope;
    const rawScp = payload.scp;
    if (typeof rawScope === "string" && rawScope.trim()) {
      scopes = rawScope.trim().split(/\s+/);
    } else if (Array.isArray(rawScp)) {
      scopes = rawScp.filter((s): s is string => typeof s === "string");
    } else {
      // Supabase GoTrue user tokens without explicit MCP scopes default to read-only least privilege
      scopes = ["mcp:read"];
    }

    const clientId =
      typeof payload.client_id === "string"
        ? payload.client_id
        : typeof payload.azp === "string"
          ? payload.azp
          : undefined;

    const connectionUuid =
      typeof payload.connection_uuid === "string"
        ? payload.connection_uuid
        : req.headers.get("x-mcp-connection-id")?.trim() || undefined;

    const authInfo: AuthInfo = {
      token,
      clientId: clientId ?? "unknown",
      scopes,
      expiresAt: payload.exp,
      resource: new URL(this.cfg.resourceServerUrl),
      extra: {
        userId: payload.sub,
        jti: payload.jti,
        connectionUuid,
      },
    };

    return {
      userId: payload.sub,
      clientId,
      scopes,
      jti: typeof payload.jti === "string" ? payload.jti : undefined,
      connectionUuid,
      expiresAt: payload.exp,
      issuedAt: typeof payload.iat === "number" ? payload.iat : undefined,
      audience: payload.aud ?? [],
      rawToken: token,
      authInfo,
    };
  }
}
