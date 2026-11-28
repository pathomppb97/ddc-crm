import { useMemo, useState } from "react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
} from "ra-core";
import { Link } from "react-router";
import {
  Camera,
  Check,
  Clock,
  ExternalLink,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Plus,
  Tractor,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildGoogleMapsUrl,
  extractCoordsFromText,
  formatThaiDateTime,
  PHOTO_TAGS,
  REPLACEMENT_INTERVAL_UNITS,
  toLineUrl,
  toTelHref,
  totalFleetVehicles,
  type CustomerGroupCode,
  type FleetEntry,
} from "../../domain/fieldSales";
import { formatUserErrorMessage, logCrmError } from "../../errors/crmError";
import { SectionErrorState } from "../../ui/SectionErrorState";
import { useDdcLocale } from "../../ui/labels";
import {
  CustomerGroupBadge,
  CustomerGroupIcon,
  useCustomerGroupOptions,
} from "./CustomerGroupBadge";

export const Customer360Panel = () => {
  const record = useRecordContext<Record<string, any>>();
  const locale = useDdcLocale();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider();
  const { identity } = useGetIdentity();
  const { groups, byCode, resolveForCompany } = useCustomerGroupOptions();

  const [addingContact, setAddingContact] = useState(false);
  const [ctName, setCtName] = useState("");
  const [ctRole, setCtRole] = useState("");
  const [ctPhone, setCtPhone] = useState("");
  const [ctLine, setCtLine] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [lightbox, setLightbox] = useState<{
    src: string;
    title: string;
  } | null>(null);

  const companyId = record?.id;

  const {
    data: contacts = [],
    error: contactsError,
    refetch: refetchContacts,
  } = useGetList(
    "contacts",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: companyId != null },
  );
  const {
    data: activities = [],
    error: activitiesError,
    refetch: refetchActivities,
  } = useGetList(
    "activities",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "logged_at", order: "DESC" },
    },
    { enabled: companyId != null },
  );
  const { data: activityProducts = [], error: activityProductsError } =
    useGetList("activity_products", {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "id", order: "ASC" },
    });
  const { data: products = [] } = useGetList("products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "id", order: "ASC" },
  });
  const {
    data: photos = [],
    error: photosError,
    refetch: refetchPhotos,
  } = useGetList(
    "activity_photos",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "taken_at", order: "DESC" },
    },
    { enabled: companyId != null },
  );
  const {
    data: capacities = [],
    error: capacitiesError,
    refetch: refetchCapacities,
  } = useGetList(
    "customer_capacity_profiles",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "updated_at", order: "DESC" },
    },
    { enabled: companyId != null },
  );
  const {
    data: partUsages = [],
    error: partUsagesError,
    refetch: refetchPartUsages,
  } = useGetList(
    "customer_part_usage",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 50 },
      sort: { field: "updated_at", order: "DESC" },
    },
    { enabled: companyId != null },
  );
  const {
    data: excelFleets = [],
    error: excelFleetsError,
    refetch: refetchExcelFleets,
  } = useGetList(
    "customer_fleets",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: companyId != null },
  );
  const {
    data: excelReqs = [],
    error: excelReqsError,
    refetch: refetchExcelReqs,
  } = useGetList(
    "customer_requirements",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 20 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: companyId != null },
  );
  const { data: salesList = [] } = useGetList("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "id", order: "ASC" },
  });

  const productById = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products],
  );
  const salesById = useMemo(
    () => new Map(salesList.map((s) => [String(s.id), s])),
    [salesList],
  );

  const productsByActivity = useMemo(() => {
    const map = new Map<string, typeof activityProducts>();
    for (const row of activityProducts) {
      const k = String(row.activity_id);
      map.set(k, [...(map.get(k) ?? []), row]);
    }
    return map;
  }, [activityProducts]);

  const photosByActivity = useMemo(() => {
    const map = new Map<string, typeof photos>();
    for (const ph of photos) {
      if (ph.activity_id == null) continue;
      const k = String(ph.activity_id);
      map.set(k, [...(map.get(k) ?? []), ph]);
    }
    return map;
  }, [photos]);

  const sortedActivities = useMemo(
    () =>
      [...activities].sort(
        (a, b) =>
          new Date(b.logged_at ?? b.start_at ?? b.created_at ?? 0).getTime() -
          new Date(a.logged_at ?? a.start_at ?? a.created_at ?? 0).getTime(),
      ),
    [activities],
  );

  if (!record) return null;

  const groupRes = resolveForCompany(record);
  const parsedCoords =
    record.latitude != null && record.longitude != null
      ? { lat: Number(record.latitude), lng: Number(record.longitude) }
      : extractCoordsFromText(
          `${record.google_maps_url ?? ""} ${record.name ?? ""} ${record.address ?? ""}`,
        );
  const mapsUrl =
    record.google_maps_url ||
    buildGoogleMapsUrl(
      parsedCoords?.lat,
      parsedCoords?.lng,
      [record.name, record.city, record.province].filter(Boolean).join(" "),
    );

  const latestCap = capacities[0];
  const latestFleets = Array.isArray(latestCap?.fleet_breakdown)
    ? (latestCap.fleet_breakdown as FleetEntry[])
    : [];
  const capVehicles =
    latestCap?.total_vehicles ?? totalFleetVehicles(latestFleets);

  const handleAssignGroup = async (code: CustomerGroupCode) => {
    const optionId = byCode.get(code)?.optionId;
    if (!optionId) return;
    try {
      await dataProvider.update("companies", {
        id: record.id,
        previousData: record,
        data: { ...record, customer_group_id: optionId },
      });
      refresh();
      notify(
        locale === "th" ? "บันทึกกลุ่มลูกค้าแล้ว" : "Customer group saved",
        { type: "success" },
      );
    } catch (error) {
      const normalized = logCrmError(error, {
        resource: "companies",
        operation: "update",
      });
      notify(formatUserErrorMessage(normalized, locale), {
        type: "error",
      });
    }
  };

  const handleQuickAddContact = async () => {
    if (!ctName.trim()) {
      notify(locale === "th" ? "กรุณาระบุชื่อผู้ติดต่อ" : "Name required", {
        type: "warning",
      });
      return;
    }
    setSavingContact(true);
    try {
      const parts = ctName.trim().split(/\s+/);
      const nowIso = new Date().toISOString();
      await dataProvider.create("contacts", {
        data: {
          first_name: parts[0] ?? ctName.trim(),
          last_name: parts.slice(1).join(" "),
          title: ctRole.trim() || null,
          company_id: record.id,
          company_name: record.name,
          line_id: ctLine.trim() || null,
          phone_jsonb: ctPhone.trim()
            ? [{ number: ctPhone.trim(), type: "Work" }]
            : [],
          email_jsonb: [],
          is_primary: contacts.length === 0,
          sales_id: identity?.id ?? null,
          first_seen: nowIso,
          last_seen: nowIso,
          tags: [],
        },
      });
      setCtName("");
      setCtRole("");
      setCtPhone("");
      setCtLine("");
      setAddingContact(false);
      await refetchContacts();
      notify(locale === "th" ? "เพิ่มผู้ติดต่อแล้ว" : "Contact added", {
        type: "success",
      });
    } catch (error) {
      const normalized = logCrmError(error, {
        resource: "contacts",
        operation: "create",
      });
      notify(formatUserErrorMessage(normalized, locale), {
        type: "error",
      });
    } finally {
      setSavingContact(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3 sm:space-y-4">
      {/* Customer 360 Header Card */}
      <Card className="min-w-0 overflow-hidden">
        <CardContent className="min-w-0 space-y-2.5 px-3.5 pt-4 pb-4 sm:space-y-3 sm:px-6 sm:pt-5 sm:pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {record.customer_code && (
                  <span className="rounded bg-secondary px-2 py-0.5 font-mono text-xs font-semibold">
                    {record.customer_code}
                  </span>
                )}
                {groupRes.group && (
                  <CustomerGroupBadge
                    code={groupRes.group.code}
                    inferred={groupRes.inferred}
                  />
                )}
              </div>
              <h2 className="break-words text-lg font-bold sm:text-xl">
                {record.name}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1 break-words">
                  <MapPin className="size-3.5 shrink-0" />
                  {[
                    record.city ? `อ.${record.city}` : null,
                    record.province ? `จ.${record.province}` : null,
                    record.location_note,
                  ]
                    .filter(Boolean)
                    .join(" · ") ||
                    (locale === "th" ? "ยังไม่ระบุที่ตั้ง" : "No location")}
                </span>
                {parsedCoords && (
                  <span className="font-mono">
                    ({parsedCoords.lat.toFixed(4)},{" "}
                    {parsedCoords.lng.toFixed(4)})
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {mapsUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 flex-1 sm:min-h-10 sm:flex-initial"
                  render={
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-4" />
                  Google Maps
                </Button>
              )}
              <Button
                size="sm"
                className="min-h-11 flex-1 font-semibold sm:min-h-10 sm:flex-initial"
                render={<Link to={`/field-visit?companyId=${record.id}`} />}
              >
                <Plus className="size-4" />
                {locale === "th" ? "บันทึกเข้าพบรายนี้" : "Log visit"}
              </Button>
            </div>
          </div>

          {/* 1-tap group assignment for legacy records without explicit group */}
          {record.customer_group_id == null && (
            <div className="rounded-xl border border-dashed bg-muted/20 p-2.5">
              <p className="mb-1.5 text-xs text-muted-foreground">
                {locale === "th"
                  ? "ยืนยันกลุ่มลูกค้า (1–5):"
                  : "Assign customer group (1–5):"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <button
                    key={g.code}
                    type="button"
                    onClick={() => handleAssignGroup(g.code)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg border bg-background px-2.5 py-1 text-xs font-medium hover:bg-secondary sm:min-h-9"
                  >
                    <CustomerGroupIcon code={g.code} className="size-3.5" />
                    <span>
                      {g.order}. {locale === "en" ? g.labelEn : g.labelTh}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4-Tab Customer 360° Workspace */}
          <Tabs defaultValue="timeline" className="w-full min-w-0 pt-1">
            <TabsList className="grid h-auto! w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
              <TabsTrigger
                value="timeline"
                className="min-h-11 gap-1 px-2 text-xs sm:min-h-9"
              >
                <Clock className="size-3.5 shrink-0" />
                <span className="truncate">
                  {locale === "th" ? "ไทม์ไลน์" : "Timeline"} (
                  {sortedActivities.length})
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="contacts"
                className="min-h-11 gap-1 px-2 text-xs sm:min-h-9"
              >
                <Users className="size-3.5 shrink-0" />
                <span className="truncate">
                  {locale === "th" ? "ผู้ติดต่อ" : "Contacts"} (
                  {contacts.length})
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="capacity"
                className="min-h-11 gap-1 px-2 text-xs sm:min-h-9"
              >
                <Tractor className="size-3.5 shrink-0" />
                <span className="truncate">
                  Cap. ({capacities.length + excelFleets.length})
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="photos"
                className="min-h-11 gap-1 px-2 text-xs sm:min-h-9"
              >
                <Camera className="size-3.5 shrink-0" />
                <span className="truncate">
                  {locale === "th" ? "รูปถ่าย" : "Photos"} ({photos.length})
                </span>
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: TIMELINE */}
            <TabsContent value="timeline" className="mt-3 space-y-2.5">
              {activitiesError ? (
                <SectionErrorState
                  error={activitiesError}
                  resource="activities"
                  operation="list"
                  onRetry={() => refetchActivities()}
                />
              ) : null}
              {activityProductsError ? (
                <SectionErrorState
                  error={activityProductsError}
                  resource="activity_products"
                  operation="list"
                />
              ) : null}
              {!activitiesError && sortedActivities.length === 0 ? (
                <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                  {locale === "th"
                    ? "ยังไม่มีบันทึกการเข้าพบลูกค้ารายนี้"
                    : "No visits logged for this customer yet"}
                </div>
              ) : (
                <ol className="space-y-2.5 border-l-2 border-primary/30 pl-4">
                  {sortedActivities.map((act) => {
                    const rep =
                      act.sales_id != null
                        ? salesById.get(String(act.sales_id))
                        : undefined;
                    const parts = productsByActivity.get(String(act.id)) ?? [];
                    const actPhotos =
                      photosByActivity.get(String(act.id)) ?? [];
                    return (
                      <li
                        key={String(act.id)}
                        className="relative rounded-xl border bg-background p-3 space-y-1.5"
                      >
                        <span className="absolute top-4 -left-[23px] size-2.5 rounded-full bg-primary" />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-primary">
                            {formatThaiDateTime(
                              act.logged_at ?? act.start_at ?? act.created_at,
                              locale,
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            {rep
                              ? `${rep.first_name} ${rep.last_name ?? ""}`.trim()
                              : "DDC Sales"}
                          </span>
                        </div>
                        <div className="text-sm font-semibold break-words">
                          {act.subject}
                        </div>
                        {act.discussion && (
                          <p className="whitespace-pre-line break-words text-xs text-foreground/90">
                            {act.discussion}
                          </p>
                        )}
                        {parts.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {parts.map((line) => {
                              const prod = line.product_id
                                ? productById.get(String(line.product_id))
                                : null;
                              return (
                                <span
                                  key={String(line.id)}
                                  className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-xs"
                                >
                                  <Package className="size-3 text-primary" />
                                  {prod
                                    ? `${prod.part_number} · ${prod.name}`
                                    : line.custom_part_name || line.notes}
                                  {line.quantity != null && (
                                    <strong className="text-primary">
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
                        {actPhotos.length > 0 && (
                          <div className="flex gap-2 overflow-x-auto pt-1">
                            {actPhotos.map((ph) => (
                              <button
                                key={String(ph.id)}
                                type="button"
                                onClick={() =>
                                  setLightbox({
                                    src: ph.image_src,
                                    title: ph.caption || "Photo",
                                  })
                                }
                                className="shrink-0 overflow-hidden rounded border"
                              >
                                <img
                                  src={ph.image_src}
                                  alt={ph.caption || "Photo"}
                                  className="h-16 w-24 object-cover"
                                  loading="lazy"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </TabsContent>

            {/* TAB 2: CONTACTS + INLINE ADD */}
            <TabsContent value="contacts" className="mt-3 space-y-2.5">
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setAddingContact((v) => !v)}
                >
                  <UserPlus className="size-4" />
                  {locale === "th" ? "เพิ่มผู้ติดต่อใหม่" : "Add contact"}
                </Button>
              </div>

              {addingContact && (
                <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={ctName}
                      onChange={(e) => setCtName(e.target.value)}
                      placeholder="ชื่อ / ชื่อเล่น *"
                      className="h-11 sm:h-10"
                    />
                    <Input
                      value={ctRole}
                      onChange={(e) => setCtRole(e.target.value)}
                      placeholder="ตำแหน่ง / บทบาท"
                      className="h-11 sm:h-10"
                    />
                    <Input
                      inputMode="tel"
                      value={ctPhone}
                      onChange={(e) => setCtPhone(e.target.value)}
                      placeholder="เบอร์โทร"
                      className="h-11 sm:h-10"
                    />
                    <Input
                      value={ctLine}
                      onChange={(e) => setCtLine(e.target.value)}
                      placeholder="LINE ID"
                      className="h-11 sm:h-10"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 sm:min-h-9"
                      onClick={() => setAddingContact(false)}
                    >
                      {locale === "th" ? "ยกเลิก" : "Cancel"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      disabled={savingContact}
                      onClick={handleQuickAddContact}
                    >
                      <Check className="size-4" />
                      {locale === "th" ? "บันทึกผู้ติดต่อ" : "Save contact"}
                    </Button>
                  </div>
                </div>
              )}

              {contactsError ? (
                <SectionErrorState
                  error={contactsError}
                  resource="contacts"
                  operation="list"
                  onRetry={() => refetchContacts()}
                />
              ) : contacts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {locale === "th" ? "ยังไม่มีผู้ติดต่อ" : "No contacts yet"}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {contacts.map((ct) => {
                    const phone = ct.phone_jsonb?.[0]?.number ?? "";
                    const fullName = [ct.first_name, ct.last_name]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <div
                        key={String(ct.id)}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-xl border bg-background p-3"
                      >
                        <div className="min-w-0">
                          <Link
                            to={`/contacts/${ct.id}/show`}
                            className="block truncate text-sm font-semibold underline-offset-2 hover:underline"
                          >
                            {fullName}
                          </Link>
                          {ct.title && (
                            <div className="truncate text-xs text-muted-foreground">
                              {ct.title}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            {phone && <span>📞 {phone}</span>}
                            {ct.line_id && <span>💬 LINE: {ct.line_id}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {phone && toTelHref(phone) && (
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-11 sm:size-9"
                              render={<a href={toTelHref(phone)!} />}
                              aria-label="Call"
                            >
                              <Phone className="size-4" />
                            </Button>
                          )}
                          {ct.line_id && toLineUrl(ct.line_id) && (
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-11 text-emerald-600 sm:size-9"
                              render={
                                <a
                                  href={toLineUrl(ct.line_id)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                />
                              }
                              aria-label="LINE"
                            >
                              <MessageCircle className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* TAB 3: CAPACITY & REPLACEMENT FREQUENCY */}
            <TabsContent value="capacity" className="mt-3 space-y-3">
              {capacitiesError ? (
                <SectionErrorState
                  error={capacitiesError}
                  resource="customer_capacity_profiles"
                  operation="list"
                  onRetry={() => refetchCapacities()}
                />
              ) : null}
              {partUsagesError ? (
                <SectionErrorState
                  error={partUsagesError}
                  resource="customer_part_usage"
                  operation="list"
                  onRetry={() => refetchPartUsages()}
                />
              ) : null}
              {excelFleetsError ? (
                <SectionErrorState
                  error={excelFleetsError}
                  resource="customer_fleets"
                  operation="list"
                  onRetry={() => refetchExcelFleets()}
                />
              ) : null}
              {excelReqsError ? (
                <SectionErrorState
                  error={excelReqsError}
                  resource="customer_requirements"
                  operation="list"
                  onRetry={() => refetchExcelReqs()}
                />
              ) : null}

              {latestCap ? (
                <div className="space-y-2.5 rounded-xl border bg-background p-3 sm:p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">
                      {locale === "th"
                        ? `ข้อมูล Cap. ล่าสุด (ฤดู ${latestCap.season_label})`
                        : `Latest Capacity (Season ${latestCap.season_label})`}
                    </span>
                    <Link
                      to={`/field-visit?companyId=${record.id}`}
                      className="text-primary underline"
                    >
                      {locale === "th" ? "อัปเดต Cap." : "Update"}
                    </Link>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
                    <div className="rounded-lg bg-muted/40 p-2 sm:p-2.5">
                      <div className="text-base font-bold tabular-nums sm:text-lg">
                        {capVehicles || "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground sm:text-xs">
                        {locale === "th" ? "รถ (คัน)" : "Vehicles"}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 sm:p-2.5">
                      <div className="text-base font-bold tabular-nums sm:text-lg">
                        {latestCap.tons_per_vehicle != null
                          ? Number(latestCap.tons_per_vehicle).toLocaleString(
                              "th-TH",
                            )
                          : "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground sm:text-xs">
                        {locale === "th" ? "ตัน/คัน" : "Tons/unit"}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 sm:p-2.5">
                      <div className="text-base font-bold tabular-nums sm:text-lg">
                        {latestCap.total_tons_per_season != null
                          ? Number(
                              latestCap.total_tons_per_season,
                            ).toLocaleString("th-TH")
                          : "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground sm:text-xs">
                        {locale === "th" ? "ตัน/ฤดู" : "Tons/season"}
                      </div>
                    </div>
                  </div>
                  {latestFleets.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {latestFleets.map((f, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-secondary px-2.5 py-0.5 text-xs"
                        >
                          {f.brand} {f.model}: <strong>{f.count} คัน</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {partUsages.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold">
                    {locale === "th"
                      ? "ความถี่การเปลี่ยนอะไหล่แต่ละพาร์ท"
                      : "Part replacement frequencies"}
                  </div>
                  {partUsages.map((u) => {
                    const unit = REPLACEMENT_INTERVAL_UNITS.find(
                      (x) => x.id === u.change_interval_unit,
                    );
                    return (
                      <div
                        key={String(u.id)}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold break-words">
                            {u.part_label}
                          </div>
                          <div className="text-muted-foreground break-words">
                            ใช้ {u.qty_per_change ?? "—"} ชิ้น ทุกๆ{" "}
                            {u.change_interval_value ?? "—"}{" "}
                            {locale === "en" ? unit?.labelEn : unit?.labelTh}
                            {u.current_brand
                              ? ` · ยี่ห้อเดิม: ${u.current_brand}`
                              : ""}
                          </div>
                        </div>
                        {u.estimated_season_qty != null && (
                          <span className="font-bold text-primary tabular-nums">
                            ~
                            {Number(u.estimated_season_qty).toLocaleString(
                              "th-TH",
                            )}{" "}
                            ชิ้น/ฤดู
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legacy Excel Survey Reference */}
              {(excelFleets.length > 0 || excelReqs.length > 0) && (
                <div className="space-y-1.5 rounded-xl border border-dashed bg-muted/20 p-3 text-xs">
                  <div className="font-semibold text-muted-foreground">
                    {locale === "th"
                      ? "ข้อมูลสำรวจเดิมจาก Excel (อ้างอิง)"
                      : "Legacy Excel survey evidence"}
                  </div>
                  {excelFleets.map((f) => (
                    <div key={String(f.id)} className="break-words">
                      🚜 {f.brands_raw?.replace(/\n/g, ", ") || "—"} · จำนวน:{" "}
                      {f.quantities_raw?.replace(/\n/g, " / ") || "—"}
                      {f.capacity_kton_raw
                        ? ` · กำลังตัด: ${f.capacity_kton_raw} พันตัน/ฤดู`
                        : ""}
                    </div>
                  ))}
                  {excelReqs.map((r) => (
                    <div
                      key={String(r.id)}
                      className="break-words text-muted-foreground"
                    >
                      ⚙️ {r.product_family}: สเปค {r.specification_raw || "—"} ·
                      เดิม {r.old_brands_raw || "—"} · ใช้/ฤดู{" "}
                      {r.seasonal_usage_raw || "—"} ชิ้น
                    </div>
                  ))}
                </div>
              )}

              {!capacitiesError &&
                !partUsagesError &&
                !excelFleetsError &&
                !excelReqsError &&
                !latestCap &&
                partUsages.length === 0 &&
                excelFleets.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {locale === "th"
                      ? "ยังไม่มีข้อมูล Cap. การใช้งาน — กด 'บันทึกเข้าพบรายนี้' เพื่อกรอกจำนวนรถและตันอ้อย"
                      : "No capacity profile recorded yet"}
                  </p>
                )}
            </TabsContent>

            {/* TAB 4: FIELD PHOTOS GALLERY */}
            <TabsContent value="photos" className="mt-3">
              {photosError ? (
                <SectionErrorState
                  error={photosError}
                  resource="activity_photos"
                  operation="list"
                  onRetry={() => refetchPhotos()}
                />
              ) : photos.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {locale === "th"
                    ? "ยังไม่มีรูปถ่ายหน้างานสำหรับลูกค้ารายนี้"
                    : "No field photos yet"}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
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
                            title: ph.caption || tagMeta?.labelTh || "Photo",
                          })
                        }
                        className="overflow-hidden rounded-xl border bg-background text-left transition hover:opacity-90"
                      >
                        <img
                          src={ph.image_src}
                          alt={ph.caption || "Field photo"}
                          className="h-32 w-full object-cover"
                          loading="lazy"
                        />
                        <div className="p-2 text-xs">
                          <div className="truncate font-semibold">
                            {locale === "en"
                              ? tagMeta?.labelEn
                              : tagMeta?.labelTh}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {ph.caption ||
                              formatThaiDateTime(ph.taken_at, locale)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

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
