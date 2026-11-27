import { getRequestId, resolveCorsHeaders } from "./cors.ts";

export function createErrorResponse(
  status: number,
  message: string,
  custom: Record<string, unknown> = {},
  req?: Request,
) {
  const requestId = getRequestId(req);
  return new Response(
    JSON.stringify({ status, message, requestId, ...custom }),
    {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...resolveCorsHeaders(req),
      },
      status,
    },
  );
}
