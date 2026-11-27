import { useMemo, useState } from "react";
import { useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";
import {
  Clock,
  ExternalLink,
  FileSpreadsheet,
  MapPin,
  Package,
  Plus,
  Search,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  buildGoogleMapsUrl,
  formatThaiDateTime,
  PHOTO_TAGS,
} from "../../domain/fieldSales";
import { useDdcLocale } from "../../ui/labels";
import { downloadXlsx } from "../spreadsheet";
import {
  CustomerGroupBadge,
  CustomerGroupIcon,
  useCustomerGroupOptions,
} from "./CustomerGroupBadge";

export const VisitTimelinePage = () => {
  const locale = useDdcLocale();
  const translate = useTranslate();
  const { groups, resolveForCompany } = useCustomerGroupOptions();

  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [salesFilter, setSalesFilter] = useState<string>("all");
  const [lightbox, setLightbox] = useState<{
    src: string;
    title: string;
  } | null>(null);

  const { data: activities = [], isPending } = useGetList("activities", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "logged_at", order: "DESC" },
  });
  const { data: companies = [] } = useGetList("companies", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: salesList = [] } = useGetList("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  const { data: activityProducts = [] } = useGetList("activity_products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: activityPhotos = [] } = useGetList("activity_photos", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "taken_at", order: "DESC" },
  });
  const { data: participants = [] } = useGetList("activity_participants", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: contacts = [] } = useGetList("contacts", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: products = [] } = useGetList("products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: activityTypes = [] } = useGetList("master_options", {
    filter: { category: "activity_type" },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "sort_order", order: "ASC" },
  });

  const companyById = useMemo(
    () => new Map(companies.map((c) => [String(c.id), c])),
    [companies],
  );
  const salesById = useMemo(
    () => new Map(salesList.map((s) => [String(s.id), s])),
    [salesList],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products],
  );
  const contactById = useMemo(
    () => new Map(contacts.map((c) => [String(c.id), c])),
    [contacts],
  );
  const typeById = useMemo(
    () => new Map(activityTypes.map((t) => [String(t.id), t])),
    [activityTypes],
  );

  const productsByActivity = useMemo(() => {
    const map = new Map<string, typeof activityProducts>();
    for (const item of activityProducts) {
      const k = String(item.activity_id);
      map.set(k, [...(map.get(k) ?? []), item]);
    }
    return map;
  }, [activityProducts]);

  const photosByActivity = useMemo(() => {
    const map = new Map<string, typeof activityPhotos>();
    for (const ph of activityPhotos) {
      if (ph.activity_id == null) continue;
      const k = String(ph.activity_id);
      map.set(k, [...(map.get(k) ?? []), ph]);
    }
    return map;
  }, [activityPhotos]);

  const participantsByActivity = useMemo(() => {
    const map = new Map<string, typeof participants>();
    for (const pt of participants) {
      const k = String(pt.activity_id);
      map.set(k, [...(map.get(k) ?? []), pt]);
    }
    return map;
  }, [participants]);

  const sortedAndFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...activities]
      .sort(
        (a, b) =>
          new Date(b.logged_at ?? b.start_at ?? b.created_at ?? 0).getTime() -
          new Date(a.logged_at ?? a.start_at ?? a.created_at ?? 0).getTime(),
      )
      .filter((act) => {
        const company =
          act.company_id != null
            ? companyById.get(String(act.company_id))
            : undefined;
        if (groupFilter !== "all") {
          const resolved = company ? resolveForCompany(company) : null;
          if (resolved?.group?.code !== groupFilter) return false;
        }
        if (salesFilter !== "all" && String(act.sales_id) !== salesFilter) {
          return false;
        }
        if (!q) return true;
        return [
          act.subject,
          act.discussion,
          act.outcome,
          act.location,
          company?.name,
          company?.province,
        ].some((val) =>
          String(val ?? "")
            .toLowerCase()
            .includes(q),
        );
      });
  }, [
    activities,
    companyById,
    groupFilter,
    salesFilter,
    query,
    resolveForCompany,
  ]);

  const handleExport = () => {
    const rows = sortedAndFiltered.map((act) => {
      const comp =
        act.company_id != null
          ? companyById.get(String(act.company_id))
          : undefined;
      const rep =
        act.sales_id != null ? salesById.get(String(act.sales_id)) : undefined;
      const parts = (productsByActivity.get(String(act.id)) ?? []).map((p) => {
        const prod = p.product_id
          ? productById.get(String(p.product_id))
          : null;
        const label = prod
          ? `${prod.part_number} ${prod.name}`
          : p.custom_part_name || p.notes || "";
        return `${label}${p.quantity != null ? ` (${p.quantity} ${p.uom || "pcs"})` : ""}`;
      });
      return {
        logged_at: formatThaiDateTime(act.logged_at ?? act.start_at, "th"),
        sales: rep ? `${rep.first_name} ${rep.last_name ?? ""}`.trim() : "",
        customer: comp?.name ?? "",
        group: comp ? (resolveForCompany(comp).group?.labelTh ?? "") : "",
        location: act.location ?? comp?.province ?? "",
        parts: parts.join("; "),
        summary: act.discussion ?? "",
        outcome: act.outcome ?? "",
        follow_up: act.follow_up_date ?? "",
      };
    });
    downloadXlsx(
      [
        { key: "logged_at", header: "วัน-เวลาที่ลงข้อมูล" },
        { key: "sales", header: "พนักงานขาย" },
        { key: "customer", header: "ลูกค้า" },
        { key: "group", header: "กลุ่มลูกค้า" },
        { key: "location", header: "สถานที่/พิกัด" },
        { key: "parts", header: "พาร์ท DDC & จำนวน" },
        { key: "summary", header: "รายละเอียดการเข้าพบ" },
        { key: "outcome", header: "ผลลัพธ์" },
        { key: "follow_up", header: "วันติดตาม" },
      ],
      rows,
      `ddc-visit-timeline-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 py-4 pb-24 md:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">
            {translate("ddc.field.visit_timeline")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {locale === "th"
              ? "เรียงลำดับตามวัน-เวลาที่ทีมงานลงข้อมูลล่าสุด (Log)"
              : "Chronological team visit log ordered by latest timestamp"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sortedAndFiltered.length === 0}
            onClick={handleExport}
          >
            <FileSpreadsheet className="size-4" />
            {translate("ddc.import.export_excel")}
          </Button>
          <Button size="sm" render={<Link to="/field-visit" />}>
            <Plus className="size-4" />
            {translate("ddc.field.quick_visit")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  locale === "th"
                    ? "ค้นหาลูกค้า, จังหวัด, รายละเอียดการคุย..."
                    : "Search customer, province, discussion..."
                }
                className="h-10 pl-9"
              />
            </div>
            <select
              value={salesFilter}
              onChange={(e) => setSalesFilter(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">
                {locale === "th" ? "พนักงานขายทั้งหมด" : "All reps"}
              </option>
              {salesList.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.first_name} {s.last_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setGroupFilter("all")}
              className={`min-h-8 shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                groupFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-secondary"
              }`}
            >
              {locale === "th" ? "ทุกกลุ่ม" : "All groups"}
            </button>
            {groups.map((g) => (
              <button
                key={g.code}
                type="button"
                onClick={() => setGroupFilter(g.code)}
                className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                  groupFilter === g.code
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                <CustomerGroupIcon code={g.code} className="size-3.5" />
                <span>{locale === "en" ? g.labelEn : g.labelTh}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Timeline Feed */}
      {isPending ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {translate("ra.page.loading")}
        </p>
      ) : sortedAndFiltered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Clock className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {locale === "th"
                ? "ยังไม่มีบันทึกการเข้าพบลูกค้า — กดปุ่มด้านล่างเพื่อเริ่มบันทึกแรก"
                : "No visit logs yet — create your first field visit"}
            </p>
            <Button render={<Link to="/field-visit" />}>
              <Plus className="size-4" />
              {translate("ddc.field.quick_visit")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
          {sortedAndFiltered.map((act) => {
            const company =
              act.company_id != null
                ? companyById.get(String(act.company_id))
                : undefined;
            const resolvedGroup = company ? resolveForCompany(company) : null;
            const rep =
              act.sales_id != null
                ? salesById.get(String(act.sales_id))
                : undefined;
            const typeOpt =
              act.activity_type_id != null
                ? typeById.get(String(act.activity_type_id))
                : undefined;
            const parts = productsByActivity.get(String(act.id)) ?? [];
            const photos = photosByActivity.get(String(act.id)) ?? [];
            const met = participantsByActivity.get(String(act.id)) ?? [];
            const mapsUrl = buildGoogleMapsUrl(
              act.checkin_lat ?? company?.latitude,
              act.checkin_lng ?? company?.longitude,
              act.location,
            );

            return (
              <li key={String(act.id)} className="relative">
                <span className="absolute top-5 -left-[23px] size-3 rounded-full border-2 border-background bg-primary" />
                <Card>
                  <CardContent className="space-y-2.5 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                        <Clock className="size-3.5" />
                        {formatThaiDateTime(
                          act.logged_at ?? act.start_at ?? act.created_at,
                          locale,
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {typeOpt && (
                          <span className="rounded-full bg-secondary px-2 py-0.5 font-medium">
                            {locale === "en" && typeOpt.name_en
                              ? typeOpt.name_en
                              : typeOpt.name}
                          </span>
                        )}
                        <Link
                          to={`/activities/${act.id}/show`}
                          className="text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {locale === "th" ? "รายละเอียด" : "Details"}
                        </Link>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {company ? (
                        <Link
                          to={`/companies/${company.id}/show`}
                          className="text-base font-bold underline-offset-2 hover:underline"
                        >
                          {company.name}
                        </Link>
                      ) : (
                        <span className="text-base font-bold">
                          {act.subject}
                        </span>
                      )}
                      {resolvedGroup?.group && (
                        <CustomerGroupBadge
                          code={resolvedGroup.group.code}
                          inferred={resolvedGroup.inferred}
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3.5" />
                        {rep
                          ? `${rep.first_name} ${rep.last_name ?? ""}`.trim()
                          : locale === "th"
                            ? "ทีมขาย DDC"
                            : "DDC Sales"}
                      </span>
                      {met.length > 0 && (
                        <span>
                          {locale === "th" ? "ผู้ติดต่อที่พบ: " : "Met: "}
                          {met
                            .map((pt) => {
                              const ct = pt.contact_id
                                ? contactById.get(String(pt.contact_id))
                                : null;
                              return ct
                                ? `${ct.first_name} ${ct.last_name ?? ""}`.trim()
                                : pt.external_name || "";
                            })
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                      {(act.location || act.checkin_lat != null) && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" />
                          {act.location ||
                            `${Number(act.checkin_lat).toFixed(4)}, ${Number(act.checkin_lng).toFixed(4)}`}
                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-primary underline"
                            >
                              <ExternalLink className="size-3" />
                              Maps
                            </a>
                          )}
                        </span>
                      )}
                    </div>

                    {act.discussion && (
                      <p className="whitespace-pre-line text-sm">
                        {act.discussion}
                      </p>
                    )}
                    {act.outcome && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {locale === "th" ? "ผลลัพธ์: " : "Outcome: "}
                        </span>
                        {act.outcome}
                      </p>
                    )}

                    {/* DDC Parts requested */}
                    {parts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {parts.map((line) => {
                          const prod = line.product_id
                            ? productById.get(String(line.product_id))
                            : null;
                          return (
                            <span
                              key={String(line.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1 text-xs font-medium"
                            >
                              <Package className="size-3.5 text-primary" />
                              <span>
                                {prod
                                  ? `${prod.part_number} · ${prod.name}`
                                  : line.custom_part_name || line.notes}
                              </span>
                              {line.quantity != null && (
                                <strong className="text-primary tabular-nums">
                                  ×{" "}
                                  {Number(line.quantity).toLocaleString(
                                    "th-TH",
                                  )}{" "}
                                  {line.uom || "pcs"}
                                </strong>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Photos strip */}
                    {photos.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pt-1">
                        {photos.map((ph) => {
                          const tagMeta = PHOTO_TAGS.find(
                            (t) => t.id === ph.photo_tag,
                          );
                          return (
                            <button
                              key={String(ph.id)}
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  src: ph.image_src,
                                  title:
                                    ph.caption || tagMeta?.labelTh || "Photo",
                                })
                              }
                              className="group relative shrink-0 overflow-hidden rounded-lg border"
                            >
                              <img
                                src={ph.image_src}
                                alt={ph.caption || "Field photo"}
                                className="h-20 w-28 object-cover transition group-hover:scale-105"
                                loading="lazy"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {act.follow_up_date && (
                      <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        📅 {locale === "th" ? "นัดติดตาม: " : "Follow-up: "}
                        {act.follow_up_date}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {lightbox && (
        <Dialog open onOpenChange={(open) => !open && setLightbox(null)}>
          <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
            <DialogTitle>{lightbox.title}</DialogTitle>
            <img
              src={lightbox.src}
              alt={lightbox.title}
              className="mt-2 max-h-[72vh] w-full rounded object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

VisitTimelinePage.path = "/timeline";
