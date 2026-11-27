import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sql, type Selectable } from "https://esm.sh/kysely@0.27.2";
import { db, type ContactsTable, CompiledQuery } from "../_shared/db.ts";
import {
  getRequestId,
  OptionsMiddleware,
  resolveCorsHeaders,
} from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";

type Contact = Selectable<ContactsTable>;

function mergeArraysUnique<T>(arr1: T[], arr2: T[]): T[] {
  return [...new Set([...arr1, ...arr2])];
}

function mergeObjectArraysUnique<T>(
  arr1: T[],
  arr2: T[],
  getKey: (item: T) => string,
): T[] {
  const map = new Map<string, T>();

  arr1.forEach((item) => {
    const key = getKey(item);
    if (key) map.set(key, item);
  });

  arr2.forEach((item) => {
    const key = getKey(item);
    if (key && !map.has(key)) {
      map.set(key, item);
    }
  });

  return Array.from(map.values());
}

function mergeContactData(winner: Contact, loser: Contact) {
  const mergedEmails = mergeObjectArraysUnique(
    (winner.email_jsonb as any[]) || [],
    (loser.email_jsonb as any[]) || [],
    (email: any) => email.email,
  );

  const mergedPhones = mergeObjectArraysUnique(
    (winner.phone_jsonb as any[]) || [],
    (loser.phone_jsonb as any[]) || [],
    (phone: any) => phone.number,
  );

  const selectedAvatar =
    (winner.avatar as any) && (winner.avatar as any).src
      ? winner.avatar
      : loser.avatar;

  const mergedCustomFields = {
    ...(loser.custom_fields ?? {}),
    ...(winner.custom_fields ?? {}),
  };

  return {
    avatar: selectedAvatar ? (JSON.stringify(selectedAvatar) as any) : null,
    gender: winner.gender ?? loser.gender,
    first_name: winner.first_name ?? loser.first_name,
    last_name: winner.last_name ?? loser.last_name,
    nickname: winner.nickname ?? loser.nickname ?? null,
    line_id: winner.line_id ?? loser.line_id ?? null,
    department: winner.department ?? loser.department ?? null,
    is_primary: Boolean(winner.is_primary || loser.is_primary),
    custom_fields: JSON.stringify(mergedCustomFields) as any,
    title: winner.title ?? loser.title,
    company_id: winner.company_id ?? loser.company_id,
    email_jsonb: JSON.stringify(mergedEmails) as any,
    phone_jsonb: JSON.stringify(mergedPhones) as any,
    linkedin_url: winner.linkedin_url || loser.linkedin_url,
    background: winner.background ?? loser.background,
    has_newsletter: winner.has_newsletter ?? loser.has_newsletter,
    first_seen: winner.first_seen ?? loser.first_seen,
    last_seen:
      winner.last_seen && loser.last_seen
        ? winner.last_seen > loser.last_seen
          ? winner.last_seen
          : loser.last_seen
        : (winner.last_seen ?? loser.last_seen),
    sales_id: winner.sales_id ?? loser.sales_id,
    tags: mergeArraysUnique(winner.tags || [], loser.tags || []),
  };
}

async function mergeContacts(
  loserId: number,
  winnerId: number,
  userId: string,
  requestId: string,
) {
  return await db.transaction().execute(async (trx) => {
    // Enable RLS by switching to authenticated role with parameterized JWT subject
    await trx.executeQuery(CompiledQuery.raw("SET LOCAL ROLE authenticated"));
    await trx.executeQuery(
      CompiledQuery.raw(
        "SELECT set_config('request.jwt.claim.sub', $1, true), set_config('app.request_id', $2, true)",
        [userId, requestId],
      ),
    );

    const [winner, loser] = await Promise.all([
      trx
        .selectFrom("contacts")
        .selectAll()
        .where("id", "=", winnerId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("contacts")
        .selectAll()
        .where("id", "=", loserId)
        .executeTakeFirstOrThrow(),
    ]);

    await trx
      .updateTable("tasks")
      .set({ contact_id: winnerId })
      .where("contact_id", "=", loserId)
      .execute();

    await trx
      .updateTable("contact_notes")
      .set({ contact_id: winnerId })
      .where("contact_id", "=", loserId)
      .execute();

    const deals = await trx
      .selectFrom("deals")
      .selectAll()
      .where(sql`contact_ids @> ARRAY[${loserId}]::bigint[]`)
      .execute();

    for (const deal of deals) {
      const newContactIds = [
        ...new Set(
          deal.contact_ids.filter((id) => id !== loserId).concat(winnerId),
        ),
      ];
      await trx
        .updateTable("deals")
        .set({ contact_ids: newContactIds })
        .where("id", "=", deal.id)
        .execute();
    }

    const mergedData = mergeContactData(winner as Contact, loser as Contact);
    await trx
      .updateTable("contacts")
      .set(mergedData)
      .where("id", "=", winnerId)
      .execute();

    await trx.deleteFrom("contacts").where("id", "=", loserId).execute();

    return { success: true, winnerId };
  });
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed", {}, req);
        }

        const currentUserSale = user ? await getUserSale(user) : null;
        if (!currentUserSale || currentUserSale.disabled) {
          return createErrorResponse(401, "Unauthorized", {}, req);
        }

        try {
          const { loserId, winnerId } = await req.json();
          const parsedLoserId = Number(loserId);
          const parsedWinnerId = Number(winnerId);

          if (
            !Number.isInteger(parsedLoserId) ||
            parsedLoserId <= 0 ||
            !Number.isInteger(parsedWinnerId) ||
            parsedWinnerId <= 0
          ) {
            return createErrorResponse(
              400,
              "Invalid loserId or winnerId",
              {},
              req,
            );
          }

          if (parsedLoserId === parsedWinnerId) {
            return createErrorResponse(
              400,
              "Cannot merge a contact into itself",
              {},
              req,
            );
          }

          const requestId = getRequestId(req);
          const result = await mergeContacts(
            parsedLoserId,
            parsedWinnerId,
            user!.id,
            requestId,
          );

          return new Response(JSON.stringify({ ...result, requestId }), {
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": requestId,
              ...resolveCorsHeaders(req),
            },
          });
        } catch (error) {
          console.error("Merge failed:", error);
          return createErrorResponse(500, "Failed to merge contacts", {}, req);
        }
      }),
    ),
  ),
);
