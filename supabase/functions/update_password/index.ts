import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getRequestId,
  OptionsMiddleware,
  resolveCorsHeaders,
} from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";

async function updatePassword(user: any, req: Request) {
  const { data, error } = await supabaseAdmin.auth.resetPasswordForEmail(
    user.email,
  );

  if (!data || error) {
    return createErrorResponse(500, "Internal Server Error", {}, req);
  }

  const requestId = getRequestId(req);
  return new Response(
    JSON.stringify({
      data,
      requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...resolveCorsHeaders(req),
      },
    },
  );
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "PATCH") {
          return createErrorResponse(405, "Method Not Allowed", {}, req);
        }
        const sale = user ? await getUserSale(user) : null;
        if (!sale || sale.disabled) {
          return createErrorResponse(401, "Unauthorized", {}, req);
        }
        return updatePassword(user, req);
      }),
    ),
  ),
);
