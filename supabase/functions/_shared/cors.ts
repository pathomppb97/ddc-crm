const ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key, if-match";
const ALLOWED_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  "Access-Control-Allow-Methods": ALLOWED_METHODS,
  "Access-Control-Expose-Headers":
    "x-request-id, x-ratelimit-limit, x-ratelimit-remaining, retry-after",
};

const parseAllowedOrigins = (): string[] => {
  const raw =
    typeof Deno !== "undefined" ? Deno.env.get("ALLOWED_ORIGINS") : undefined;
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
};

export function resolveCorsHeaders(req?: Request): Record<string, string> {
  const allowlist = parseAllowedOrigins();
  if (allowlist.length === 0) {
    return { ...corsHeaders };
  }
  const origin = req?.headers.get("origin") ?? "";
  const allowedOrigin = allowlist.includes(origin) ? origin : allowlist[0];
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  };
}

export function getRequestId(req?: Request): string {
  const incoming = req?.headers.get("x-request-id")?.trim();
  if (incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)) {
    return incoming;
  }
  return `req_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Handle OPTIONS requests for CORS preflight.
 */
export function OptionsMiddleware(
  req: Request,
  next: (req: Request) => Promise<Response>,
) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...resolveCorsHeaders(req),
        "X-Request-Id": getRequestId(req),
      },
    });
  }

  return next(req);
}
