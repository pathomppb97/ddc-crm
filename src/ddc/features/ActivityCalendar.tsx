import { DesignSlots } from "@/ddc/pages/pageDesign";
import { useMemo, useState } from "react";
import { useGetList, useGetIdentity, useTranslate } from "ra-core";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDdcLocale } from "../ui/labels";

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Month calendar of visits and activities, with overdue follow-ups and
 * customer coverage (customers without a completed activity in 90 days).
 */
export const ActivityCalendar = () => {
  const translate = useTranslate();
  const locale = useDdcLocale();
  const { identity } = useGetIdentity();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [mineOnly, setMineOnly] = useState(false);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 42);

  const filter = {
    "start_at@gte": gridStart.toISOString(),
    "start_at@lt": gridEnd.toISOString(),
    ...(mineOnly && identity ? { sales_id: identity.id } : {}),
  };
  const { data: activities = [] } = useGetList("activities", {
    filter,
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "start_at", order: "ASC" },
  });
  const todayKey = dayKey(new Date());
  const { data: overdue = [] } = useGetList("action_items", {
    filter: {
      "status@in": "(open,in_progress)",
      "due_date@lt": todayKey,
      ...(mineOnly && identity ? { sales_id: identity.id } : {}),
    },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "due_date", order: "ASC" },
  });
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: companies = [] } = useGetList("companies", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: recent = [] } = useGetList("activities", {
    filter: { status: "completed", "start_at@gte": since },
    pagination: { page: 1, perPage: 5000 },
    sort: { field: "start_at", order: "DESC" },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, typeof activities>();
    for (const activity of activities) {
      const key = dayKey(new Date(activity.start_at));
      map.set(key, [...(map.get(key) ?? []), activity]);
    }
    return map;
  }, [activities]);
  const covered = new Set(recent.map((a) => String(a.company_id)));
  const uncovered = companies.filter((c) => !covered.has(String(c.id)));

  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    return date;
  });
  const localeTag = locale === "th" ? "th-TH" : "en-GB";

  return (
    <div className="grid gap-4 py-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={translate("ddc.calendar.previous")}
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              <ChevronLeft className="size-4" />
            </Button>
            <CardTitle className="text-base">
              {month.toLocaleDateString(localeTag, {
                month: "long",
                year: "numeric",
              })}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label={translate("ddc.calendar.next")}
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
              />
              {translate("ddc.calendar.mine_only")}
            </label>
            <Button size="sm" render={<Link to="/activities/create" />}>
              <Plus className="size-4" />
              {translate("ddc.calendar.plan_visit")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded border bg-border text-xs">
            {days.slice(0, 7).map((d) => (
              <div
                key={`h${d.getDay()}`}
                className="bg-muted p-1 text-center font-medium"
              >
                {d.toLocaleDateString(localeTag, { weekday: "short" })}
              </div>
            ))}
            {days.map((date) => {
              const key = dayKey(date);
              const inMonth = date.getMonth() === month.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-24 bg-background p-1 ${inMonth ? "" : "opacity-40"} ${key === todayKey ? "ring-2 ring-sky-500 ring-inset" : ""}`}
                >
                  <div className="mb-1 text-right text-muted-foreground">
                    {date.getDate()}
                  </div>
                  <ul className="space-y-0.5">
                    {(byDay.get(key) ?? []).slice(0, 4).map((a) => (
                      <li key={a.id}>
                        <Link
                          to={`/activities/${a.id}/show`}
                          className={`block truncate rounded px-1 ${a.status === "completed" ? "bg-emerald-100 dark:bg-emerald-950" : a.status === "cancelled" ? "bg-muted line-through" : "bg-sky-100 dark:bg-sky-950"}`}
                          title={a.subject}
                        >
                          {new Date(a.start_at).toLocaleTimeString(localeTag, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          {a.subject}
                        </Link>
                      </li>
                    ))}
                    {(byDay.get(key)?.length ?? 0) > 4 ? (
                      <li className="text-muted-foreground">
                        +{(byDay.get(key)?.length ?? 0) - 4}
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        <DesignSlots page="calendar">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {translate("ddc.calendar.overdue")} ({overdue.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {overdue.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={`/action_items/${item.id}/show`}
                      className="text-red-700 underline dark:text-red-300"
                    >
                      {item.due_date}
                    </Link>{" "}
                    {item.description}
                  </li>
                ))}
                {overdue.length === 0 ? (
                  <li className="text-muted-foreground">
                    {translate("ddc.common.no_records")}
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {translate("ddc.calendar.coverage")} (
                {companies.length - uncovered.length}/{companies.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                {translate("ddc.calendar.coverage_hint")}
              </p>
              <ul className="max-h-80 space-y-1 overflow-auto text-sm">
                {uncovered.slice(0, 100).map((company) => (
                  <li key={company.id}>
                    <Link
                      to={`/companies/${company.id}/show`}
                      className="underline"
                    >
                      {company.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </DesignSlots>
      </div>
    </div>
  );
};

ActivityCalendar.path = "/calendar";
