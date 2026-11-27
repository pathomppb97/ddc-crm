import { describe, expect, it } from "vitest";
import {
  createD365FOConnector,
  createEntraTokenProvider,
} from "./d365Connector.ts";
import { ErpThrottledError, ErpTransientError } from "./types.ts";

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const fakeTokens = { getToken: async () => "fake-token" };
const BASE = "https://env.example.test";

describe("Dynamics 365 F&O OData connector (fake HTTP)", () => {
  it("scopes the query to one legal entity and applies the incremental filter", async () => {
    const calls: string[] = [];
    const connector = createD365FOConnector({
      baseUrl: BASE,
      tokenProvider: fakeTokens,
      modifiedField: "ModifiedDateTime",
      fetchImpl: async (url) => {
        calls.push(url);
        return json(200, {
          value: [{ CustomerAccount: "A" }],
          "@odata.nextLink": `${BASE}/data/CustomersV3?$skiptoken=1`,
        });
      },
    });

    const page = await connector.fetchPage({
      entityName: "CustomersV3",
      dataAreaId: "o'x",
      modifiedSince: "2026-01-01T00:00:00Z",
      pageSize: 50,
    });
    const url = decodeURIComponent(calls[0].replaceAll("+", " "));

    expect(url).toContain("cross-company=true");
    expect(url).toContain("dataAreaId eq 'o''x'");
    expect(url).toContain("ModifiedDateTime gt 2026-01-01T00:00:00.000Z");
    expect(page.nextLink).toContain("$skiptoken=1");
  });

  it("maps HTTP 429 to a throttling error with Retry-After", async () => {
    const connector = createD365FOConnector({
      baseUrl: BASE,
      tokenProvider: fakeTokens,
      fetchImpl: async () => json(429, {}, { "Retry-After": "7" }),
    });

    const error = await connector
      .fetchPage({ entityName: "CustomersV3", dataAreaId: "x", pageSize: 1 })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ErpThrottledError);
    expect(error.retryAfterMs).toBe(7000);
  });

  it("treats 5xx as transient", async () => {
    const connector = createD365FOConnector({
      baseUrl: BASE,
      tokenProvider: fakeTokens,
      fetchImpl: async () => json(503, {}),
    });

    await expect(
      connector.fetchPage({
        entityName: "CustomersV3",
        dataAreaId: "x",
        pageSize: 1,
      }),
    ).rejects.toBeInstanceOf(ErpTransientError);
  });

  it("refuses continuation links pointing outside the environment", async () => {
    const connector = createD365FOConnector({
      baseUrl: BASE,
      tokenProvider: fakeTokens,
      fetchImpl: async () => json(200, {}),
    });

    await expect(
      connector.fetchPage({
        entityName: "X",
        dataAreaId: "x",
        pageSize: 1,
        nextLink: "https://evil.example.test/data",
      }),
    ).rejects.toThrow("outside the configured environment");
  });

  it("refuses a non HTTPS environment and invalid entity names", async () => {
    expect(() =>
      createD365FOConnector({
        baseUrl: "http://env.example.test",
        tokenProvider: fakeTokens,
      }),
    ).toThrow("HTTPS");
    const connector = createD365FOConnector({
      baseUrl: BASE,
      tokenProvider: fakeTokens,
      fetchImpl: async () => json(200, {}),
    });
    await expect(
      connector.fetchPage({
        entityName: "Customers?$x",
        dataAreaId: "x",
        pageSize: 1,
      }),
    ).rejects.toThrow("Invalid data entity name");
  });

  it("caches the Entra ID token and never leaks the secret in errors", async () => {
    let requests = 0;
    const provider = createEntraTokenProvider(
      {
        tenantId: "t",
        clientId: "c",
        clientSecret: "super-secret-value",
        resource: BASE,
      },
      async () => {
        requests += 1;
        return json(200, { access_token: "tok", expires_in: 3600 });
      },
    );
    await provider.getToken();
    await provider.getToken();
    const failing = createEntraTokenProvider(
      {
        tenantId: "t",
        clientId: "c",
        clientSecret: "super-secret-value",
        resource: BASE,
      },
      async () => json(400, { error: "super-secret-value" }),
    );
    const error = await failing.getToken().catch((e: Error) => e);

    expect(requests).toBe(1);
    expect((error as Error).message).not.toContain("super-secret-value");
  });
});
