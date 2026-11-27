import { useMemo, useState } from "react";
import { useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Package, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDdcLocale } from "../../ui/labels";
import { partImages } from "../PartImages";

export const PartCatalogPage = () => {
  const locale = useDdcLocale();
  const translate = useTranslate();
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");

  const { data: products = [], isPending } = useGetList("products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "part_number", order: "ASC" },
  });
  const { data: families = [] } = useGetList("product_hierarchy_nodes", {
    filter: { level: "family" },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "sort_order", order: "ASC" },
  });
  const { data: activityProducts = [] } = useGetList("activity_products", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "id", order: "ASC" },
  });

  const demandByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of activityProducts) {
      if (row.product_id == null || row.quantity == null) continue;
      const k = String(row.product_id);
      map.set(k, (map.get(k) ?? 0) + Number(row.quantity));
    }
    return map;
  }, [activityProducts]);

  const familyNameById = useMemo(
    () =>
      new Map(
        families.map((f) => [
          String(f.id),
          locale === "en" && f.name_en ? String(f.name_en) : String(f.name),
        ]),
      ),
    [families, locale],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (familyFilter === "other") {
        if (p.node_id != null) return false;
      } else if (familyFilter !== "all" && String(p.node_id) !== familyFilter) {
        return false;
      }
      if (!q) return true;
      return [p.part_number, p.name, p.name_en, p.material, p.description].some(
        (v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
      );
    });
  }, [products, familyFilter, query]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 py-4 pb-24 md:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">
            {translate("ddc.field.part_catalog")} ({filtered.length})
          </h1>
          <p className="text-xs text-muted-foreground">
            {locale === "th"
              ? "ค้นหาพาร์ทเกษตร DDC เพื่อเปิดดูหน้างานหรือกดเพิ่มเข้าบันทึกการเข้าพบได้ทันที"
              : "Quick field reference for DDC Agriculture parts and field demand totals"}
          </p>
        </div>
        <Button size="sm" variant="outline" render={<Link to="/products" />}>
          {locale === "th" ? "จัดการสินค้าทั้งหมด" : "Manage products"}
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                locale === "th"
                  ? "ค้นหารหัสพาร์ท (1DD05011), ขนาด (5mm, 17T) หรือรุ่นรถ (JD, CASE, CAMECO)..."
                  : "Search part number, spec, or machine..."
              }
              className="h-11 pl-9"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setFamilyFilter("all")}
              className={`min-h-9 shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                familyFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-secondary"
              }`}
            >
              {locale === "th" ? "ทั้งหมด" : "All"}
            </button>
            {families.map((f) => (
              <button
                key={String(f.id)}
                type="button"
                onClick={() => setFamilyFilter(String(f.id))}
                className={`min-h-9 shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                  familyFilter === String(f.id)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                {locale === "en" && f.name_en ? f.name_en : f.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFamilyFilter("other")}
              className={`min-h-9 shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                familyFilter === "other"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-secondary"
              }`}
            >
              {locale === "th" ? "Shear Plate / อื่นๆ" : "Shear Plate / Other"}
            </button>
          </div>
        </CardContent>
      </Card>

      {isPending ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {translate("ra.page.loading")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((prod) => {
            const thumb = partImages(prod.custom_fields?.photo_images)[0]?.src;
            const demand = demandByProduct.get(String(prod.id)) ?? 0;
            const famName =
              prod.node_id != null
                ? familyNameById.get(String(prod.node_id))
                : undefined;
            return (
              <Card
                key={String(prod.id)}
                className="flex flex-col justify-between"
              >
                <CardContent className="flex flex-1 flex-col gap-3 pt-4">
                  <div className="flex items-start gap-3">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={String(prod.part_number)}
                        className="size-16 shrink-0 rounded-lg border object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Package className="size-7" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-semibold">
                          {prod.part_number}
                        </span>
                        {famName && (
                          <span className="text-xs text-muted-foreground">
                            {famName}
                          </span>
                        )}
                      </div>
                      <Link
                        to={`/products/${prod.id}/show`}
                        className="mt-1 block text-sm font-bold underline-offset-2 hover:underline"
                      >
                        {prod.name}
                      </Link>
                      {demand > 0 && (
                        <div className="mt-1 text-xs font-semibold text-primary tabular-nums">
                          {locale === "th"
                            ? `ยอดต้องการจากภาคสนาม: ${demand.toLocaleString("th-TH")} ${prod.uom || "pcs"}`
                            : `Field demand: ${demand.toLocaleString("en-US")} ${prod.uom || "pcs"}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
                    <Link
                      to={`/products/${prod.id}/show`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {locale === "th" ? "ดูสเปค & รูป 3D" : "Specs & 3D"}
                    </Link>
                    <Button
                      size="sm"
                      variant="secondary"
                      render={<Link to={`/field-visit?productId=${prod.id}`} />}
                    >
                      <Plus className="size-3.5" />
                      {locale === "th" ? "บันทึกพบลูกค้า" : "Add to visit"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

PartCatalogPage.path = "/catalog";
