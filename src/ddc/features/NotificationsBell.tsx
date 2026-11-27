import {
  useGetIdentity,
  useGetList,
  useTranslate,
  useUpdateMany,
} from "ra-core";
import { Link } from "react-router";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDdcLocale } from "../ui/labels";

/**
 * In-app notifications (approval requests and decisions) plus the user's
 * overdue follow-ups, refreshed every minute.
 */
export const NotificationsBell = () => {
  const translate = useTranslate();
  const locale = useDdcLocale();
  const { identity } = useGetIdentity();
  const [updateMany] = useUpdateMany();
  const enabled = identity?.id != null;
  const { data: notifications = [], refetch } = useGetList(
    "notifications",
    {
      filter: { recipient_sales_id: identity?.id, "read_at@is": null },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled, refetchInterval: 60_000 },
  );
  const today = new Date().toISOString().slice(0, 10);
  const { total: overdue = 0 } = useGetList(
    "action_items",
    {
      filter: {
        sales_id: identity?.id,
        "status@in": "(open,in_progress)",
        "due_date@lt": today,
      },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "due_date", order: "ASC" },
    },
    { enabled, refetchInterval: 60_000 },
  );
  const count = notifications.length + (overdue > 0 ? 1 : 0);

  const markAllRead = () =>
    updateMany(
      "notifications",
      {
        ids: notifications.map((n) => n.id),
        data: { read_at: new Date().toISOString() },
      },
      { onSuccess: () => refetch() },
    );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={translate("ddc.notifications.title")}
          >
            <Bell className="size-5" />
            {count > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
                {count}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">
            {translate("ddc.notifications.title")}
          </p>
          {notifications.length ? (
            <Button size="sm" variant="ghost" onClick={markAllRead}>
              {translate("ddc.notifications.mark_all_read")}
            </Button>
          ) : null}
        </div>
        <ul className="max-h-96 space-y-2 overflow-auto text-sm">
          {overdue > 0 ? (
            <li>
              <Link
                to={`/action_items?filter=${encodeURIComponent(JSON.stringify({ sales_id: identity?.id, status: "open" }))}`}
                className="text-red-700 underline dark:text-red-300"
              >
                {translate("ddc.notifications.overdue", { count: overdue })}
              </Link>
            </li>
          ) : null}
          {notifications.map((n) => (
            <li key={n.id} className="border-l-2 border-sky-500 pl-2">
              <Link
                to={
                  n.entity_type ? `/${n.entity_type}/${n.entity_id}/show` : "#"
                }
                className="font-medium underline-offset-2 hover:underline"
              >
                {translate(`ddc.notifications.kind.${n.kind}`, { _: n.title })}
              </Link>
              <div className="text-xs text-muted-foreground">
                {n.body} ·{" "}
                {new Date(n.created_at).toLocaleString(
                  locale === "th" ? "th-TH" : "en-GB",
                )}
              </div>
            </li>
          ))}
          {count === 0 ? (
            <li className="text-muted-foreground">
              {translate("ddc.notifications.none")}
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
