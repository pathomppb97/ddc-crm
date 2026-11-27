import {
  ErpThrottledError,
  ErpTransientError,
  type ErpConnector,
  type ErpPage,
  type ErpQuery,
} from "./types.ts";

/**
 * Dynamics 365 Finance and Operations OData connector.
 *
 * SERVER SIDE ONLY. It must never be bundled in the web application: it needs
 * Microsoft Entra ID client credentials, which are read from the edge function
 * environment and never stored in the database, the repository or logs.
 *
 * This adapter is exercised by unit tests against a fake HTTP layer only. It
 * has NOT been run against any DDC environment: entity names, field names, the
 * modified-date field and throttling behaviour must be verified in an
 * authorized sandbox before use.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenProvider {
  getToken(forceRefresh?: boolean): Promise<string>;
}

export interface EntraCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The F&O environment root, e.g. https://example.operations.dynamics.com */
  resource: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** OAuth 2.0 client credentials flow against Microsoft Entra ID, with in-memory caching. */
export const createEntraTokenProvider = (
  credentials: EntraCredentials,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): TokenProvider => {
  let cached: { token: string; expiresAt: number } | null = null;

  return {
    async getToken(forceRefresh = false) {
      if (!forceRefresh && cached && cached.expiresAt - 60_000 > now()) {
        return cached.token;
      }
      const response = await fetchImpl(
        `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            scope: `${trimSlash(credentials.resource)}/.default`,
          }).toString(),
        },
      );
      if (!response.ok) {
        // The response body may echo request details: never include it in the error
        throw new Error(
          `Microsoft Entra ID token request failed with HTTP ${response.status}`,
        );
      }
      const payload = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!payload.access_token) {
        throw new Error("Microsoft Entra ID returned no access token");
      }
      cached = {
        token: payload.access_token,
        expiresAt: now() + (payload.expires_in ?? 300) * 1000,
      };
      return cached.token;
    },
  };
};

export interface D365ConnectorOptions {
  /** Environment root URL. */
  baseUrl: string;
  tokenProvider: TokenProvider;
  fetchImpl?: FetchLike;
  /** Name of the modification timestamp field, if the enabled entities expose one. Unverified. */
  modifiedField?: string | null;
  defaultRetryAfterMs?: number;
}

const escapeODataString = (value: string) => value.replace(/'/g, "''");

export const createD365FOConnector = ({
  baseUrl,
  tokenProvider,
  fetchImpl = fetch,
  modifiedField = null,
  defaultRetryAfterMs = 5000,
}: D365ConnectorOptions): ErpConnector => {
  const root = trimSlash(baseUrl);
  const origin = new URL(root).origin;
  if (new URL(root).protocol !== "https:") {
    throw new Error("The ERP environment URL must use HTTPS");
  }

  const buildUrl = (query: ErpQuery): string => {
    if (query.nextLink) {
      // Follow server driven paging only inside the configured environment
      if (new URL(query.nextLink).origin !== origin) {
        throw new Error(
          "The ERP returned a continuation link outside the configured environment",
        );
      }
      return query.nextLink;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(query.entityName)) {
      throw new Error(`Invalid data entity name: ${query.entityName}`);
    }
    const filters = [`dataAreaId eq '${escapeODataString(query.dataAreaId)}'`];
    if (query.modifiedSince && modifiedField) {
      filters.push(
        `${modifiedField} gt ${new Date(query.modifiedSince).toISOString()}`,
      );
    }
    const params = new URLSearchParams({
      "cross-company": "true",
      $filter: filters.join(" and "),
    });
    return `${root}/data/${query.entityName}?${params.toString()}`;
  };

  const request = async (
    url: string,
    pageSize: number,
    retryAuth = true,
  ): Promise<Response> => {
    const token = await tokenProvider.getToken();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          Prefer: `odata.maxpagesize=${pageSize}`,
        },
      });
    } catch (error) {
      throw new ErpTransientError(
        `Network error: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    if (response.status === 401 && retryAuth) {
      await tokenProvider.getToken(true);
      return request(url, pageSize, false);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new ErpThrottledError(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : defaultRetryAfterMs,
      );
    }
    if (response.status >= 500) {
      throw new ErpTransientError(`ERP responded with HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`ERP responded with HTTP ${response.status}`);
    }
    return response;
  };

  return {
    type: "d365fo",
    modifiedField,

    async healthCheck() {
      try {
        await request(`${root}/data/$metadata`, 1);
        return { ok: true, message: "ERP OData endpoint reachable" };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "ERP unreachable",
        };
      }
    },

    async listLegalEntities() {
      const response = await request(
        `${root}/data/LegalEntities?$select=LegalEntityId,Name`,
        1000,
      );
      const payload = (await response.json()) as {
        value?: Array<{ LegalEntityId?: string; Name?: string }>;
      };
      return (payload.value ?? [])
        .filter((row) => row.LegalEntityId)
        .map((row) => ({
          dataAreaId: String(row.LegalEntityId).toLowerCase(),
          name: row.Name ?? "",
        }));
    },

    async fetchPage(query: ErpQuery): Promise<ErpPage> {
      const response = await request(buildUrl(query), query.pageSize);
      const payload = (await response.json()) as {
        value?: unknown;
        "@odata.nextLink"?: string;
      };
      if (!Array.isArray(payload.value)) {
        throw new Error("Unexpected ERP response: missing value array");
      }
      return {
        records: payload.value,
        nextLink: payload["@odata.nextLink"] ?? null,
      };
    },
  };
};
