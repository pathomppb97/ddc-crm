import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useNotify,
  useTranslate,
} from "ra-core";
import { useNavigate, useSearchParams } from "react-router";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  ImagePlus,
  LocateFixed,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Tractor,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { findDuplicateCandidates } from "../../domain/duplicates";
import {
  buildGoogleMapsUrl,
  compressFieldImage,
  computeCapacityTotals,
  computeEstimatedSeasonQty,
  CUSTOMER_GROUPS,
  extractCoordsFromText,
  formatThaiDateTime,
  PHOTO_TAGS,
  REPLACEMENT_INTERVAL_UNITS,
  toLineUrl,
  toTelHref,
  totalFleetVehicles,
  type CustomerGroupCode,
  type FleetEntry,
  type ReplacementIntervalUnit,
} from "../../domain/fieldSales";
import { useDdcLocale } from "../../ui/labels";
import { partImages } from "../PartImages";
import {
  CustomerGroupBadge,
  CustomerGroupIcon,
  useCustomerGroupOptions,
} from "./CustomerGroupBadge";
import { CustomerLocationFields } from "./CustomerLocationFields";

const DRAFT_STORAGE_KEY = "ddc_field_visit_draft_v1";

interface SelectedPartLine {
  key: string;
  productId: number | string | null;
  partNumber: string;
  name: string;
  quantity: number;
  uom: string;
  urgency: "immediate" | "this_season" | "inquiry";
  isCustom: boolean;
}

interface DraftContact {
  tempId: string;
  name: string;
  role: string;
  phone: string;
  lineId: string;
}

interface DraftPartUsage {
  tempId: string;
  partLabel: string;
  qtyPerChange: string;
  intervalValue: string;
  intervalUnit: ReplacementIntervalUnit;
  currentBrand: string;
}

interface DraftPhoto {
  id: string;
  tag: "part_sample" | "machine" | "shop" | "business_card" | "other";
  caption: string;
  fileName: string;
  src: string;
  approxKb?: number;
}

interface FieldVisitDraft {
  companyId: string | null;
  creatingNewCustomer: boolean;
  newCustomerName: string;
  newCustomerGroupCode: CustomerGroupCode;
  newCustomerProvince: string;
  newCustomerCity: string;
  newCustomerPhone: string;
  activityTypeCode: string;
  locationText: string;
  lat: number | null;
  lng: number | null;
  gpsAccuracyM: number | null;
  updateCustomerLocation: boolean;
  selectedContactIds: string[];
  pendingContacts: DraftContact[];
  partLines: SelectedPartLine[];
  createRfq: boolean;
  capExpanded: boolean;
  capSeason: string;
  capRole: "owner" | "service_shop" | "dealer_network";
  capFleets: FleetEntry[];
  capTonsPerVehicle: string;
  capTotalTons: string;
  capPartUsage: DraftPartUsage[];
  photos: DraftPhoto[];
  summary: string;
  outcome: string;
  followUpDate: string;
}

const emptyDraft = (): FieldVisitDraft => ({
  companyId: null,
  creatingNewCustomer: false,
  newCustomerName: "",
  newCustomerGroupCode: "farm_owner",
  newCustomerProvince: "",
  newCustomerCity: "",
  newCustomerPhone: "",
  activityTypeCode: "onsite_visit",
  locationText: "",
  lat: null,
  lng: null,
  gpsAccuracyM: null,
  updateCustomerLocation: true,
  selectedContactIds: [],
  pendingContacts: [],
  partLines: [],
  createRfq: false,
  capExpanded: false,
  capSeason: "2569/70",
  capRole: "owner",
  capFleets: [{ brand: "John Deere", model: "", count: 1 }],
  capTonsPerVehicle: "",
  capTotalTons: "",
  capPartUsage: [
    {
      tempId: "usage-1",
      partLabel: "ใบมีดตัดโคนอ้อย",
      qtyPerChange: "10",
      intervalValue: "350",
      intervalUnit: "tons",
      currentBrand: "",
    },
  ],
  photos: [],
  summary: "",
  outcome: "",
  followUpDate: "",
});

const ROLE_CHIPS = [
  "เจ้าของ",
  "ผู้จัดการ",
  "หัวหน้าช่าง / ช่าง",
  "จัดซื้อ / พัสดุ",
  "วิศวกร",
];

const QUICK_ACTIVITY_TYPES = [
  { code: "onsite_visit", th: "เข้าพบหน้างาน", en: "Onsite visit" },
  { code: "dealer_visit", th: "เยี่ยมดีลเลอร์/ร้าน", en: "Dealer visit" },
  { code: "phone_call", th: "โทรศัพท์", en: "Phone call" },
  { code: "line_chat", th: "แชท LINE", en: "LINE chat" },
  { code: "sample_delivery", th: "ส่งตัวอย่างทดสอบ", en: "Sample delivery" },
  { code: "follow_up", th: "ติดตามผล", en: "Follow-up" },
];

export const FieldVisitPage = () => {
  const locale = useDdcLocale();
  const translate = useTranslate();
  const notify = useNotify();
  const navigate = useNavigate();
  const dataProvider = useDataProvider();
  const { identity } = useGetIdentity();
  const [searchParams] = useSearchParams();
  const { groups, byCode, resolveForCompany } = useCustomerGroupOptions();

  const [draft, setDraft] = useState<FieldVisitDraft>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FieldVisitDraft>;
        return { ...emptyDraft(), ...parsed };
      }
    } catch {
      // Ignore corrupt local draft
    }
    return emptyDraft();
  });
  const [restoredDraft, setRestoredDraft] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(DRAFT_STORAGE_KEY));
    } catch {
      return false;
    }
  });

  const [customerSearch, setCustomerSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [customPartName, setCustomPartName] = useState("");
  const [customPartQty, setCustomPartQty] = useState("10");
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactInput, setContactInput] = useState<
    Omit<DraftContact, "tempId">
  >({
    name: "",
    role: "เจ้าของ",
    phone: "",
    lineId: "",
  });
  const [gpsBusy, setGpsBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [activePhotoTag, setActivePhotoTag] =
    useState<DraftPhoto["tag"]>("part_sample");
  const [lightboxPhoto, setLightboxPhoto] = useState<DraftPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [nowText, setNowText] = useState(() =>
    formatThaiDateTime(new Date(), locale),
  );

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Live clock for auto-timestamp visibility
  useEffect(() => {
    setNowText(formatThaiDateTime(new Date(), locale));
    const timer = window.setInterval(() => {
      setNowText(formatThaiDateTime(new Date(), locale));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [locale]);

  // Persist draft locally (excluding oversized photos beyond 4MB safeguard)
  useEffect(() => {
    try {
      const payload = JSON.stringify(draft);
      if (payload.length < 3_500_000) {
        localStorage.setItem(DRAFT_STORAGE_KEY, payload);
      }
    } catch {
      // Quota exceeded in private mode - keep in memory
    }
  }, [draft]);

  // Master data queries
  const {
    data: companies = [],
    total: customerTotal,
    isPending: customersPending,
    isError: customersError,
  } = useGetList("companies", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: products = [] } = useGetList("products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "part_number", order: "ASC" },
  });
  const { data: families = [] } = useGetList("product_hierarchy_nodes", {
    filter: { level: "family" },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "sort_order", order: "ASC" },
  });
  const { data: activityTypes = [] } = useGetList("master_options", {
    filter: { category: "activity_type" },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "sort_order", order: "ASC" },
  });

  const selectedCompany = useMemo(
    () =>
      draft.companyId
        ? (companies.find((c) => String(c.id) === String(draft.companyId)) ??
          null)
        : null,
    [companies, draft.companyId],
  );

  // Contacts, Capacity, Part Usage & Excel Fleet for the chosen customer
  const { data: companyContacts = [] } = useGetList(
    "contacts",
    {
      filter: selectedCompany ? { company_id: selectedCompany.id } : {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: Boolean(selectedCompany) },
  );
  const { data: existingCapacities = [] } = useGetList(
    "customer_capacity_profiles",
    {
      filter: selectedCompany ? { company_id: selectedCompany.id } : {},
      pagination: { page: 1, perPage: 5 },
      sort: { field: "updated_at", order: "DESC" },
    },
    { enabled: Boolean(selectedCompany) },
  );
  const { data: existingPartUsages = [] } = useGetList(
    "customer_part_usage",
    {
      filter: selectedCompany ? { company_id: selectedCompany.id } : {},
      pagination: { page: 1, perPage: 30 },
      sort: { field: "updated_at", order: "DESC" },
    },
    { enabled: Boolean(selectedCompany) },
  );
  const { data: excelFleets = [] } = useGetList(
    "customer_fleets",
    {
      filter: selectedCompany ? { company_id: selectedCompany.id } : {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: Boolean(selectedCompany) },
  );

  // Apply URL prefill (?companyId=... or ?productId=...) once master lists arrive
  const appliedParamRef = useRef<string>("");
  useEffect(() => {
    const paramKey = searchParams.toString();
    if (!paramKey || appliedParamRef.current === paramKey) return;
    const companyIdParam = searchParams.get("companyId");
    const productIdParam = searchParams.get("productId");

    if (companyIdParam && companies.length > 0) {
      const target = companies.find(
        (c) => String(c.id) === String(companyIdParam),
      );
      if (target) {
        selectExistingCompany(target);
        appliedParamRef.current = paramKey;
      }
    }
    if (productIdParam && products.length > 0) {
      const prod = products.find(
        (p) => String(p.id) === String(productIdParam),
      );
      if (prod) {
        setDraft((prev) => {
          if (
            prev.partLines.some(
              (line) => String(line.productId) === String(prod.id),
            )
          ) {
            return prev;
          }
          return {
            ...prev,
            partLines: [
              ...prev.partLines,
              {
                key: `prod-${prod.id}`,
                productId: prod.id,
                partNumber: String(prod.part_number ?? ""),
                name: String(prod.name ?? ""),
                quantity: 100,
                uom: String(prod.uom || "pcs"),
                urgency: "this_season",
                isCustom: false,
              },
            ],
          };
        });
        appliedParamRef.current = paramKey;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, companies.length, products.length]);

  // Hydrate capacity defaults when switching customer
  const hydratedCapForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCompany) return;
    const cid = String(selectedCompany.id);
    if (hydratedCapForRef.current === cid) return;
    const latestCap = existingCapacities[0];
    if (latestCap) {
      hydratedCapForRef.current = cid;
      const fleets = Array.isArray(latestCap.fleet_breakdown)
        ? (latestCap.fleet_breakdown as FleetEntry[])
        : [];
      setDraft((prev) => ({
        ...prev,
        capSeason: String(latestCap.season_label || "2569/70"),
        capRole:
          (latestCap.capacity_role as FieldVisitDraft["capRole"]) || "owner",
        capFleets: fleets.length
          ? fleets
          : [
              {
                brand: "John Deere",
                model: "",
                count: Number(latestCap.total_vehicles || 0),
              },
            ],
        capTonsPerVehicle:
          latestCap.tons_per_vehicle != null
            ? String(latestCap.tons_per_vehicle)
            : "",
        capTotalTons:
          latestCap.total_tons_per_season != null
            ? String(latestCap.total_tons_per_season)
            : "",
        capPartUsage: existingPartUsages.length
          ? existingPartUsages.map((u) => ({
              tempId: `db-${u.id}`,
              partLabel: String(u.part_label ?? ""),
              qtyPerChange:
                u.qty_per_change != null ? String(u.qty_per_change) : "",
              intervalValue:
                u.change_interval_value != null
                  ? String(u.change_interval_value)
                  : "",
              intervalUnit:
                (u.change_interval_unit as ReplacementIntervalUnit) || "tons",
              currentBrand: String(u.current_brand ?? ""),
            }))
          : prev.capPartUsage,
      }));
    }
  }, [selectedCompany, existingCapacities, existingPartUsages]);

  function selectExistingCompany(company: Record<string, any>) {
    const coords =
      company.latitude != null && company.longitude != null
        ? { lat: Number(company.latitude), lng: Number(company.longitude) }
        : extractCoordsFromText(
            `${company.google_maps_url ?? ""} ${company.name ?? ""} ${company.address ?? ""}`,
          );
    const locParts = [
      company.city ? `อ.${company.city}` : null,
      company.province ? `จ.${company.province}` : null,
      company.location_note || null,
    ].filter(Boolean);
    hydratedCapForRef.current = null;
    setDraft((prev) => ({
      ...prev,
      companyId: String(company.id),
      creatingNewCustomer: false,
      lat: coords?.lat ?? prev.lat,
      lng: coords?.lng ?? prev.lng,
      locationText: locParts.join(" ") || prev.locationText,
      selectedContactIds: [],
    }));
    setCustomerSearch("");
  }

  // Filtered customer list
  const filteredCompanies = useMemo(() => {
    const q = customerSearch.trim().normalize("NFKC").toLowerCase();
    if (!q) {
      return companies.filter(
        (company) => !/^(?:ERP_Code_|รหัส ERP )/i.test(company.name ?? ""),
      );
    }
    return companies.filter((c) => {
      const source = c.custom_fields?.customer_segmentation_2026;
      return [
        c.name,
        c.customer_code,
        c.province,
        c.city,
        c.phone_number,
        ...(Array.isArray(source?.erp_codes) ? source.erp_codes : []),
        ...(Array.isArray(source?.names) ? source.names : []),
      ].some((val) =>
        String(val ?? "")
          .normalize("NFKC")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [companies, customerSearch]);

  // Duplicate check when creating a new customer (fuzzy score + Thai substring match)
  const duplicateCandidates = useMemo(() => {
    const rawName = draft.newCustomerName.trim();
    if (
      !draft.creatingNewCustomer ||
      (!rawName && !draft.newCustomerPhone.trim())
    )
      return [];
    const strict = findDuplicateCandidates(
      {
        name: rawName,
        phone_number: draft.newCustomerPhone,
      },
      companies,
    );
    const seen = new Set(strict.map((m) => String(m.record.id)));
    const norm = (s: string) =>
      s
        .normalize("NFKC")
        .replace(/น\u0e4d\u0e32/g, "น้ำ")
        .toLowerCase()
        .replace(/[\s_(),.\-/]+/g, "");
    const needle = norm(rawName);
    const substringMatches =
      needle.length >= 4
        ? companies
            .filter((c) => {
              if (seen.has(String(c.id))) return false;
              const hay = norm(String(c.name ?? ""));
              return (
                hay.includes(needle) ||
                (hay.length >= 4 && needle.includes(hay))
              );
            })
            .map((record) => ({
              record,
              score: 0.75,
              reasons: ["name"],
            }))
        : [];
    return [...strict, ...substringMatches].slice(0, 4);
  }, [
    draft.creatingNewCustomer,
    draft.newCustomerName,
    draft.newCustomerPhone,
    companies,
  ]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    return products
      .filter((p) => {
        if (familyFilter !== "all") {
          if (familyFilter === "other") {
            if (p.node_id != null) return false;
          } else if (String(p.node_id) !== familyFilter) {
            return false;
          }
        }
        if (!q) return true;
        return [
          p.part_number,
          p.name,
          p.name_en,
          p.material,
          p.description,
        ].some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        );
      })
      .slice(0, 24);
  }, [products, familyFilter, partSearch]);

  const totalVehicles = totalFleetVehicles(draft.capFleets);
  const totalTonsNum = draft.capTotalTons ? Number(draft.capTotalTons) : null;

  // Assign group directly to an existing company if unassigned
  const handleQuickAssignGroup = async (groupCode: CustomerGroupCode) => {
    if (!selectedCompany) return;
    const optionId = byCode.get(groupCode)?.optionId;
    if (!optionId) return;
    try {
      await dataProvider.update("companies", {
        id: selectedCompany.id,
        previousData: selectedCompany,
        data: { ...selectedCompany, customer_group_id: optionId },
      });
      notify(
        locale === "th"
          ? "อัปเดตกลุ่มลูกค้าเรียบร้อยแล้ว"
          : "Customer group updated",
        { type: "success" },
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };

  // GPS Capture
  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      notify(translate("ddc.field.gps_unavailable"), { type: "warning" });
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Math.round(pos.coords.accuracy || 0);
        setDraft((prev) => ({
          ...prev,
          lat,
          lng,
          gpsAccuracyM: acc,
          locationText:
            prev.locationText ||
            `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}${acc ? ` (±${acc} ม.)` : ""}`,
        }));
        setGpsBusy(false);
        notify(translate("ddc.field.gps_captured"), { type: "success" });
      },
      () => {
        setGpsBusy(false);
        notify(translate("ddc.field.gps_unavailable"), { type: "warning" });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  // Handle pasting a Google Maps URL or DMS coords into locationText
  const handleLocationInputChange = (value: string) => {
    const parsed = extractCoordsFromText(value);
    setDraft((prev) => ({
      ...prev,
      locationText: value,
      ...(parsed ? { lat: parsed.lat, lng: parsed.lng } : {}),
    }));
  };

  // Parts cart operations
  const adjustProductQty = (product: Record<string, any>, delta: number) => {
    setDraft((prev) => {
      const existing = prev.partLines.find(
        (l) => !l.isCustom && String(l.productId) === String(product.id),
      );
      if (existing) {
        const nextQty = Math.max(0, existing.quantity + delta);
        if (nextQty === 0) {
          return {
            ...prev,
            partLines: prev.partLines.filter((l) => l.key !== existing.key),
          };
        }
        return {
          ...prev,
          partLines: prev.partLines.map((l) =>
            l.key === existing.key ? { ...l, quantity: nextQty } : l,
          ),
        };
      }
      if (delta <= 0) return prev;
      return {
        ...prev,
        partLines: [
          ...prev.partLines,
          {
            key: `prod-${product.id}`,
            productId: product.id,
            partNumber: String(product.part_number ?? ""),
            name: String(product.name ?? ""),
            quantity: delta,
            uom: String(product.uom || "pcs"),
            urgency: "this_season",
            isCustom: false,
          },
        ],
      };
    });
  };

  const updatePartLine = (key: string, patch: Partial<SelectedPartLine>) => {
    setDraft((prev) => ({
      ...prev,
      partLines: prev.partLines
        .map((line) => (line.key === key ? { ...line, ...patch } : line))
        .filter((line) => line.quantity > 0),
    }));
  };

  const addCustomPartLine = () => {
    const name = customPartName.trim();
    const qty = Math.max(1, Number(customPartQty) || 1);
    if (!name) return;
    setDraft((prev) => ({
      ...prev,
      partLines: [
        ...prev.partLines,
        {
          key: `custom-${Date.now()}`,
          productId: null,
          partNumber: "CUSTOM",
          name,
          quantity: qty,
          uom: "pcs",
          urgency: "this_season",
          isCustom: true,
        },
      ],
    }));
    setCustomPartName("");
    setCustomPartQty("10");
  };

  // Inline contact addition (staged in draft, persisted on save)
  const addPendingContact = () => {
    if (!contactInput.name.trim()) {
      notify(
        locale === "th"
          ? "กรุณาระบุชื่อผู้ติดต่อ"
          : "Please enter contact name",
        { type: "warning" },
      );
      return;
    }
    const created: DraftContact = {
      tempId: `pending-${Date.now()}`,
      name: contactInput.name.trim(),
      role: contactInput.role.trim(),
      phone: contactInput.phone.trim(),
      lineId: contactInput.lineId.trim(),
    };
    setDraft((prev) => ({
      ...prev,
      pendingContacts: [...prev.pendingContacts, created],
    }));
    setContactInput({ name: "", role: "เจ้าของ", phone: "", lineId: "" });
    setContactFormOpen(false);
  };

  // Photos capture / attach with auto-compression
  const handlePhotosPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setPhotoBusy(true);
    try {
      const processed: DraftPhoto[] = [];
      for (const file of files) {
        const compressed = await compressFieldImage(file, 1400, 0.78);
        processed.push({
          id: crypto.randomUUID(),
          tag: activePhotoTag,
          caption: "",
          fileName: compressed.fileName,
          src: compressed.dataUrl,
          approxKb: compressed.approxKb,
        });
      }
      setDraft((prev) => ({
        ...prev,
        photos: [...prev.photos, ...processed],
      }));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : locale === "th"
            ? "ไม่สามารถอ่านรูปภาพได้"
            : "Could not process image",
        { type: "error" },
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  // Capacity bidirectional update
  const handleCapTonnageChange = (
    field: "tonsPerVehicle" | "totalTons",
    raw: string,
  ) => {
    const num = raw.trim() === "" ? null : Number(raw);
    const calc = computeCapacityTotals({
      totalVehicles,
      tonsPerVehicle:
        field === "tonsPerVehicle"
          ? num
          : draft.capTonsPerVehicle
            ? Number(draft.capTonsPerVehicle)
            : null,
      totalTons:
        field === "totalTons"
          ? num
          : draft.capTotalTons
            ? Number(draft.capTotalTons)
            : null,
      editedField: field,
    });
    setDraft((prev) => ({
      ...prev,
      capTonsPerVehicle:
        field === "tonsPerVehicle"
          ? raw
          : calc.tonsPerVehicle != null
            ? String(calc.tonsPerVehicle)
            : "",
      capTotalTons:
        field === "totalTons"
          ? raw
          : calc.totalTons != null
            ? String(calc.totalTons)
            : "",
    }));
  };

  const handleFleetRowChange = (index: number, patch: Partial<FleetEntry>) => {
    setDraft((prev) => {
      const nextFleets = prev.capFleets.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      );
      const nextVeh = totalFleetVehicles(nextFleets);
      const calc = computeCapacityTotals({
        totalVehicles: nextVeh,
        tonsPerVehicle: prev.capTonsPerVehicle
          ? Number(prev.capTonsPerVehicle)
          : null,
        totalTons: prev.capTotalTons ? Number(prev.capTotalTons) : null,
        editedField: "vehicles",
      });
      return {
        ...prev,
        capFleets: nextFleets,
        capTonsPerVehicle:
          calc.tonsPerVehicle != null
            ? String(calc.tonsPerVehicle)
            : prev.capTonsPerVehicle,
        capTotalTons:
          calc.totalTons != null ? String(calc.totalTons) : prev.capTotalTons,
      };
    });
  };

  const handleClearDraft = () => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setDraft(emptyDraft());
    setRestoredDraft(false);
    setCustomerSearch("");
    setPartSearch("");
  };

  // Save entire Field Visit atomically across resources
  const handleSaveVisit = async () => {
    if (!selectedCompany && !draft.creatingNewCustomer) {
      notify(
        locale === "th"
          ? "กรุณาเลือกลูกค้า หรือกดเพิ่มลูกค้าใหม่ก่อนบันทึก"
          : "Please select or create a customer first",
        { type: "warning" },
      );
      return;
    }
    if (draft.creatingNewCustomer && !draft.newCustomerName.trim()) {
      notify(
        locale === "th" ? "กรุณาระบุชื่อลูกค้าใหม่" : "Enter customer name",
        { type: "warning" },
      );
      return;
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      let companyId = selectedCompany?.id;
      let companyName = selectedCompany?.name ?? draft.newCustomerName.trim();
      const groupOptionId =
        byCode.get(draft.newCustomerGroupCode)?.optionId ?? null;
      const mapsUrl = buildGoogleMapsUrl(
        draft.lat,
        draft.lng,
        draft.locationText,
      );

      // 1. Create or update customer (Group & GPS location)
      if (!companyId) {
        const createdCompany = await dataProvider.create("companies", {
          data: {
            name: draft.newCustomerName.trim(),
            customer_group_id: groupOptionId,
            province: draft.newCustomerProvince.trim() || null,
            city: draft.newCustomerCity.trim() || null,
            phone_number: draft.newCustomerPhone.trim() || null,
            country: "TH",
            org_type: "standalone",
            latitude: draft.lat,
            longitude: draft.lng,
            google_maps_url: mapsUrl,
            location_note: draft.locationText.trim() || null,
            sales_id: identity?.id ?? null,
          },
        });
        companyId = createdCompany.data.id;
        companyName = createdCompany.data.name;
      } else if (
        draft.updateCustomerLocation &&
        draft.lat != null &&
        draft.lng != null
      ) {
        // Best-effort update customer primary pin (ignores if rep lacks update on another owner's company)
        await dataProvider
          .update("companies", {
            id: companyId,
            previousData: selectedCompany!,
            data: {
              ...selectedCompany,
              latitude: draft.lat,
              longitude: draft.lng,
              google_maps_url: mapsUrl,
              location_note:
                draft.locationText.trim() ||
                selectedCompany?.location_note ||
                null,
            },
          })
          .catch(() => undefined);
      }

      // 2. Create any newly added contacts
      const createdContactIds: Array<number | string> = [];
      for (let i = 0; i < draft.pendingContacts.length; i += 1) {
        const ct = draft.pendingContacts[i];
        const parts = ct.name.trim().split(/\s+/);
        const firstName = parts[0] ?? ct.name.trim();
        const lastName = parts.slice(1).join(" ");
        const res = await dataProvider.create("contacts", {
          data: {
            first_name: firstName,
            last_name: lastName,
            title: ct.role || null,
            company_id: companyId,
            company_name: companyName,
            line_id: ct.lineId || null,
            phone_jsonb: ct.phone ? [{ number: ct.phone, type: "Work" }] : [],
            email_jsonb: [],
            is_primary: companyContacts.length === 0 && i === 0,
            sales_id: identity?.id ?? null,
            first_seen: nowIso,
            last_seen: nowIso,
            tags: [],
          },
        });
        createdContactIds.push(res.data.id);
      }

      // 3. Create Activity (Visit Timeline Log)
      const matchedType =
        activityTypes.find((opt) => opt.code === draft.activityTypeCode) ??
        activityTypes[0];
      const typeLabel =
        QUICK_ACTIVITY_TYPES.find((t) => t.code === draft.activityTypeCode)
          ?.th ?? "เข้าพบลูกค้า";
      const subject = `${typeLabel} · ${companyName}`;
      const activityRes = await dataProvider.create("activities", {
        data: {
          activity_type_id: matchedType?.id ?? null,
          subject,
          company_id: companyId,
          start_at: nowIso,
          logged_at: nowIso,
          location: draft.locationText.trim() || null,
          checkin_lat: draft.lat,
          checkin_lng: draft.lng,
          checkin_accuracy_m: draft.gpsAccuracyM,
          status: "completed",
          discussion: draft.summary.trim() || null,
          outcome: draft.outcome.trim() || null,
          follow_up_date: draft.followUpDate || null,
          sales_id: identity?.id ?? null,
        },
      });
      const activityId = activityRes.data.id;

      // 4. Link contacts met -> activity_participants
      const allMetContactIds = [
        ...draft.selectedContactIds,
        ...createdContactIds.map(String),
      ];
      for (const contactId of allMetContactIds) {
        await dataProvider
          .create("activity_participants", {
            data: {
              activity_id: activityId,
              contact_id: Number.isNaN(Number(contactId))
                ? contactId
                : Number(contactId),
            },
          })
          .catch(() => undefined);
      }

      // 5. Persist DDC Parts needed + Qty -> activity_products
      for (const line of draft.partLines) {
        await dataProvider.create("activity_products", {
          data: {
            activity_id: activityId,
            product_id: line.productId,
            custom_part_name: line.isCustom ? line.name : null,
            quantity: line.quantity,
            uom: line.uom || "pcs",
            urgency: line.urgency,
            notes: line.isCustom
              ? line.name
              : `${line.partNumber} · ${line.name}`,
          },
        });
      }

      // 5b. Optional: Auto-create RFQ + rfq_items when checked
      if (draft.createRfq && draft.partLines.length > 0) {
        const rfqRes = await dataProvider.create("rfqs", {
          data: {
            company_id: companyId,
            contact_id: allMetContactIds[0]
              ? Number(allMetContactIds[0]) || allMetContactIds[0]
              : null,
            subject: `RFQ จากการเข้าพบ · ${companyName}`,
            received_date: nowIso.slice(0, 10),
            customer_requirements: draft.summary.trim() || null,
            status: "registered",
            engineering_review_status: "not_required",
            follow_up_date: draft.followUpDate || null,
            sales_id: identity?.id ?? null,
          },
        });
        for (let idx = 0; idx < draft.partLines.length; idx += 1) {
          const line = draft.partLines[idx];
          await dataProvider.create("rfq_items", {
            data: {
              rfq_id: rfqRes.data.id,
              line_no: idx + 1,
              product_id: line.productId,
              description: `${line.partNumber} ${line.name}`.trim(),
              quantity: line.quantity,
              uom: line.uom || "pcs",
            },
          });
        }
      }

      // 6. Persist Field Photos -> activity_photos
      for (const ph of draft.photos) {
        await dataProvider.create("activity_photos", {
          data: {
            company_id: companyId,
            activity_id: activityId,
            photo_tag: ph.tag,
            caption: ph.caption.trim() || ph.fileName,
            file_name: ph.fileName,
            image_src: ph.src,
            latitude: draft.lat,
            longitude: draft.lng,
            taken_at: nowIso,
            sales_id: identity?.id ?? null,
          },
        });
      }

      // 7. Persist Customer Capacity & Part Replacement Frequency (if opened/filled)
      const validFleets = draft.capFleets.filter(
        (f) => f.brand.trim() || f.model.trim() || Number(f.count) > 0,
      );
      const capVehicles = totalFleetVehicles(validFleets);
      const capTotalTons = draft.capTotalTons
        ? Number(draft.capTotalTons)
        : null;
      const capTonsPerVeh = draft.capTonsPerVehicle
        ? Number(draft.capTonsPerVehicle)
        : null;

      if (
        draft.capExpanded &&
        (capVehicles > 0 || capTotalTons || capTonsPerVeh)
      ) {
        await dataProvider.create("customer_capacity_profiles", {
          data: {
            company_id: companyId,
            season_label: draft.capSeason || "2569/70",
            capacity_role: draft.capRole,
            total_vehicles: capVehicles || null,
            tons_per_vehicle: capTonsPerVeh,
            total_tons_per_season: capTotalTons,
            fleet_breakdown: validFleets,
            sales_id: identity?.id ?? null,
          },
        });

        for (const u of draft.capPartUsage) {
          if (!u.partLabel.trim()) continue;
          const qtyChange = u.qtyPerChange ? Number(u.qtyPerChange) : null;
          const intVal = u.intervalValue ? Number(u.intervalValue) : null;
          const estSeason = computeEstimatedSeasonQty({
            qtyPerChange: qtyChange,
            intervalValue: intVal,
            intervalUnit: u.intervalUnit,
            totalTonsPerSeason: capTotalTons,
            totalVehicles: capVehicles,
          });
          await dataProvider.create("customer_part_usage", {
            data: {
              company_id: companyId,
              part_label: u.partLabel.trim(),
              qty_per_change: qtyChange,
              change_interval_value: intVal,
              change_interval_unit: u.intervalUnit,
              estimated_season_qty: estSeason,
              current_brand: u.currentBrand.trim() || null,
              recorded_activity_id: activityId,
              sales_id: identity?.id ?? null,
            },
          });
        }
      }

      // 8. Optional follow-up reminder -> action_items
      if (draft.followUpDate) {
        await dataProvider
          .create("action_items", {
            data: {
              activity_id: activityId,
              company_id: companyId,
              description:
                draft.outcome.trim() ||
                draft.summary.trim() ||
                `ติดตามผลลูกค้า ${companyName}`,
              due_date: draft.followUpDate,
              status: "open",
              sales_id: identity?.id ?? null,
            },
          })
          .catch(() => undefined);
      }

      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setDraft(emptyDraft());
      notify(translate("ddc.field.saved_visit"), { type: "success" });
      navigate(`/companies/${companyId}/show`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "ไม่สามารถบันทึกการเข้าพบได้",
        { type: "error" },
      );
    } finally {
      setSaving(false);
    }
  };

  // Completion indicator
  const completedSteps = [
    Boolean(
      selectedCompany ||
      (draft.creatingNewCustomer && draft.newCustomerName.trim()),
    ),
    draft.partLines.length > 0,
    Boolean(draft.lat != null || draft.locationText.trim()),
    draft.selectedContactIds.length + draft.pendingContacts.length > 0,
    draft.photos.length > 0,
    draft.capExpanded && (totalVehicles > 0 || Boolean(draft.capTotalTons)),
  ].filter(Boolean).length;

  const selectedGroupResolution = selectedCompany
    ? resolveForCompany(selectedCompany)
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 py-4 pb-24 md:pb-10">
      {/* Top Sticky Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-4 shadow-xs">
        <div>
          <h1 className="text-lg font-bold md:text-xl">
            {translate("ddc.field.quick_visit")}
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            <span>
              {locale === "th" ? "บันทึกเวลาอัตโนมัติ · " : "Auto-timestamp · "}
              {nowText}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold tabular-nums">
            {completedSteps}/6 {locale === "th" ? "ส่วน" : "sections"}
          </span>
          {(draft.companyId ||
            draft.newCustomerName ||
            draft.partLines.length > 0 ||
            draft.summary) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearDraft}
            >
              <RotateCcw className="size-3.5" />
              {translate("ddc.field.clear_draft")}
            </Button>
          )}
        </div>
      </div>

      {restoredDraft && (
        <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
          <span>{translate("ddc.field.draft_restored")}</span>
          <button
            type="button"
            className="underline"
            onClick={() => setRestoredDraft(false)}
          >
            {locale === "th" ? "รับทราบ" : "Dismiss"}
          </button>
        </div>
      )}

      {/* SECTION 1: CUSTOMER + 5 GROUPS (REQ 1 & 4) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                1
              </span>
              {locale === "th"
                ? "ลูกค้า & กลุ่มลูกค้า *"
                : "Customer & Group *"}
            </CardTitle>
            {(selectedCompany || draft.creatingNewCustomer) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    companyId: null,
                    creatingNewCustomer: false,
                  }))
                }
              >
                {locale === "th" ? "เปลี่ยนลูกค้า" : "Change"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedCompany ? (
            <div className="rounded-xl border bg-muted/30 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {locale === "th" ? "มีในระบบแล้ว" : "Existing"}
                    </span>
                    {selectedCompany.customer_code && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {selectedCompany.customer_code}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-base font-bold">
                    {selectedCompany.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      selectedCompany.city ? `อ.${selectedCompany.city}` : null,
                      selectedCompany.province
                        ? `จ.${selectedCompany.province}`
                        : null,
                      selectedCompany.phone_number,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                {selectedGroupResolution?.group && (
                  <CustomerGroupBadge
                    code={selectedGroupResolution.group.code}
                    inferred={selectedGroupResolution.inferred}
                  />
                )}
              </div>

              {/* 1-tap group confirmation if legacy customer has no group_id yet */}
              {selectedCompany.customer_group_id == null && (
                <div className="border-t pt-2.5">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    {locale === "th"
                      ? "ลูกค้ารายนี้ยังไม่ได้ระบุกลุ่ม — แตะเลือกกลุ่มลูกค้า (1–5):"
                      : "Assign customer group (1–5):"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((g) => (
                      <button
                        key={g.code}
                        type="button"
                        onClick={() => handleQuickAssignGroup(g.code)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-secondary"
                      >
                        <CustomerGroupIcon code={g.code} />
                        <span>
                          {g.order}. {locale === "en" ? g.labelEn : g.labelTh}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : draft.creatingNewCustomer ? (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3.5">
              <div className="text-sm font-semibold text-primary">
                +{" "}
                {locale === "th"
                  ? "เพิ่มลูกค้าใหม่เข้าสู่ระบบ"
                  : "Add New Customer"}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "th"
                    ? "ชื่อลูกค้า / โรงงาน / ร้าน / อู่ / ไร่ *"
                    : "Customer name *"}
                </label>
                <Input
                  value={draft.newCustomerName}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      newCustomerName: e.target.value,
                    }))
                  }
                  placeholder={
                    locale === "th"
                      ? "เช่น ไร่อ้อยลุงสมหมาย หรือ อู่ช่างต้อม"
                      : "Customer name"
                  }
                  className="mt-1 h-11"
                />
              </div>

              {/* Live Duplicate Warning */}
              {duplicateCandidates.length > 0 && (
                <div
                  role="alert"
                  className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/50"
                >
                  <p className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="size-4 shrink-0" />
                    {locale === "th"
                      ? "พบลูกค้าชื่อ/เบอร์คล้ายกันในระบบแล้ว:"
                      : "Similar existing customers found:"}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {duplicateCandidates.map((m) => (
                      <div
                        key={String(m.record.id)}
                        className="flex items-center justify-between gap-2 rounded-lg bg-background/80 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold">
                            {m.record.name}
                          </div>
                          <div className="text-muted-foreground">
                            {Math.round(m.score * 100)}%{" "}
                            {m.record.province
                              ? `· จ.${m.record.province}`
                              : ""}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => selectExistingCompany(m.record)}
                        >
                          {locale === "th" ? "เลือกรายนี้" : "Use this"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5 Customer Groups (Large Tappable Buttons) */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "th"
                    ? "กลุ่มลูกค้า (เลือก 1 แตะ) *"
                    : "Customer group *"}
                </label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                  {CUSTOMER_GROUPS.map((g) => {
                    const active = draft.newCustomerGroupCode === g.code;
                    return (
                      <button
                        key={g.code}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            newCustomerGroupCode: g.code,
                          }))
                        }
                        className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-xs"
                            : "bg-background hover:bg-secondary"
                        }`}
                      >
                        <CustomerGroupIcon
                          code={g.code}
                          className="size-4 shrink-0"
                        />
                        <span>
                          {g.order}. {locale === "en" ? g.labelEn : g.labelTh}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3">
                <CustomerLocationFields
                  province={draft.newCustomerProvince}
                  district={draft.newCustomerCity}
                  locale={locale}
                  onChange={(province, district) =>
                    setDraft((prev) => ({
                      ...prev,
                      newCustomerProvince: province,
                      newCustomerCity: district,
                    }))
                  }
                />
                <div>
                  <label className="text-xs text-muted-foreground">
                    {locale === "th" ? "เบอร์โทรร้าน/สำนักงาน" : "Main phone"}
                  </label>
                  <Input
                    inputMode="tel"
                    value={draft.newCustomerPhone}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        newCustomerPhone: e.target.value,
                      }))
                    }
                    placeholder="08x-xxx-xxxx"
                    className="mt-1 h-11"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
                <Input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={
                    locale === "th"
                      ? "ค้นหาชื่อลูกค้า, โรงงาน, อู่, ไร่, จังหวัด หรือรหัสลูกค้า..."
                      : "Search customer name, code, province or phone..."
                  }
                  className="h-11 pl-9"
                />
              </div>

              <p role="status" className="text-xs text-muted-foreground">
                {customersPending
                  ? locale === "th"
                    ? "กำลังโหลดรายชื่อลูกค้า…"
                    : "Loading customers…"
                  : customersError
                    ? locale === "th"
                      ? "โหลดรายชื่อลูกค้าไม่สำเร็จ"
                      : "Could not load customers"
                    : locale === "th"
                      ? `แสดง ${filteredCompanies.length} จาก ${customerTotal ?? companies.length} รายในฐานลูกค้า`
                      : `Showing ${filteredCompanies.length} of ${customerTotal ?? companies.length} customer records`}
              </p>

              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
                {filteredCompanies.map((c) => {
                  const res = resolveForCompany(c);
                  return (
                    <button
                      key={String(c.id)}
                      type="button"
                      onClick={() => selectExistingCompany(c)}
                      className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2 text-left transition hover:bg-secondary/60"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {c.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[
                            c.customer_code,
                            c.city ? `อ.${c.city}` : null,
                            c.province ? `จ.${c.province}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      {res.group && (
                        <CustomerGroupBadge
                          code={res.group.code}
                          inferred={res.inferred}
                        />
                      )}
                    </button>
                  );
                })}
                {!customersPending &&
                  !customersError &&
                  filteredCompanies.length === 0 && (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      {locale === "th"
                        ? "ไม่พบลูกค้ารายนี้ในระบบ — กดปุ่มด้านล่างเพื่อเพิ่มใหม่"
                        : "No matching customer found — add a new one below"}
                    </p>
                  )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-11 w-full border-dashed border-primary text-primary hover:bg-primary/5"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    creatingNewCustomer: true,
                    newCustomerName: customerSearch.trim(),
                  }))
                }
              >
                <Plus className="size-4" />
                {locale === "th"
                  ? `ยังไม่มีในระบบ? เพิ่มลูกค้าใหม่${customerSearch.trim() ? ` "${customerSearch.trim()}"` : ""}`
                  : `Add new customer${customerSearch.trim() ? ` "${customerSearch.trim()}"` : ""}`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 2: LOCATION / GPS (REQ 3) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                2
              </span>
              {locale === "th" ? "Location / พิกัดลูกค้า" : "Customer Location"}
            </span>
            {draft.lat != null && draft.lng != null && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <MapPin className="size-3.5" />
                {draft.lat.toFixed(4)}, {draft.lng.toFixed(4)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 border-primary/50 text-primary"
              disabled={gpsBusy}
              onClick={handleCaptureGps}
            >
              <LocateFixed className="size-4" />
              {gpsBusy
                ? locale === "th"
                  ? "กำลังจับพิกัด GPS..."
                  : "Capturing GPS..."
                : locale === "th"
                  ? "ปักหมุดพิกัดปัจจุบัน (GPS)"
                  : "Capture Current GPS"}
            </Button>
            {(draft.lat != null || draft.locationText.trim()) && (
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                render={
                  <a
                    href={
                      buildGoogleMapsUrl(
                        draft.lat,
                        draft.lng,
                        draft.locationText,
                      ) ?? "#"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ExternalLink className="size-4" />
                Google Maps
              </Button>
            )}
          </div>
          <Input
            value={draft.locationText}
            onChange={(e) => handleLocationInputChange(e.target.value)}
            placeholder={
              locale === "th"
                ? "ชื่อสถานที่ / อำเภอ-จังหวัด / หรือวางลิงก์ Google Maps หรือพิกัด"
                : "Location note, district/province, or paste Google Maps URL"
            }
            className="h-11"
          />
          {selectedCompany && draft.lat != null && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.updateCustomerLocation}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    updateCustomerLocation: e.target.checked,
                  }))
                }
                className="size-4 accent-primary"
              />
              {locale === "th"
                ? "อัปเดตพิกัดนี้เป็นพิกัดหลักของลูกค้าด้วย"
                : "Also save as customer's primary GPS pin"}
            </label>
          )}
        </CardContent>
      </Card>

      {/* SECTION 3: MULTI-CONTACTS + LINE ID (REQ 5) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                3
              </span>
              {locale === "th"
                ? "ผู้ติดต่อ (เพิ่มได้มากกว่า 1 ชื่อ)"
                : "Contacts (Multiple allowed)"}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setContactFormOpen((v) => !v)}
            >
              <UserPlus className="size-4" />
              {locale === "th" ? "เพิ่มผู้ติดต่อ" : "Add contact"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {/* Existing contacts of selected customer */}
          {selectedCompany && companyContacts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {locale === "th"
                  ? "ติ๊กเลือกผู้ติดต่อที่พบในรอบนี้:"
                  : "Select contacts met on this visit:"}
              </p>
              {companyContacts.map((ct) => {
                const cid = String(ct.id);
                const checked = draft.selectedContactIds.includes(cid);
                const phone = ct.phone_jsonb?.[0]?.number ?? "";
                const fullName = [ct.first_name, ct.last_name]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={cid}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                      checked ? "border-primary bg-primary/5" : "bg-background"
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDraft((prev) => ({
                            ...prev,
                            selectedContactIds: checked
                              ? prev.selectedContactIds.filter((x) => x !== cid)
                              : [...prev.selectedContactIds, cid],
                          }))
                        }
                        className="size-4 accent-primary"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {fullName}
                          {ct.title ? (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              · {ct.title}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {phone ? <span>📞 {phone}</span> : null}
                          {ct.line_id ? (
                            <span>💬 LINE: {ct.line_id}</span>
                          ) : null}
                        </div>
                      </div>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      {phone && toTelHref(phone) && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-9"
                          render={<a href={toTelHref(phone)!} />}
                          aria-label="Call"
                        >
                          <Phone className="size-4" />
                        </Button>
                      )}
                      {ct.line_id && toLineUrl(ct.line_id) && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-9 text-emerald-600"
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

          {/* Newly staged contacts */}
          {draft.pendingContacts.length > 0 && (
            <div className="space-y-1.5">
              {draft.pendingContacts.map((ct) => (
                <div
                  key={ct.tempId}
                  className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50/50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {ct.name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {ct.role ? `· ${ct.role}` : ""} (
                        {locale === "th" ? "เพิ่มใหม่" : "New"})
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ct.phone || "—"}{" "}
                      {ct.lineId ? `· LINE: ${ct.lineId}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        pendingContacts: prev.pendingContacts.filter(
                          (x) => x.tempId !== ct.tempId,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Inline Add Contact Form */}
          {(contactFormOpen ||
            (draft.creatingNewCustomer &&
              draft.pendingContacts.length === 0)) && (
            <div className="space-y-2.5 rounded-xl border bg-muted/20 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={contactInput.name}
                  onChange={(e) =>
                    setContactInput((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder={
                    locale === "th"
                      ? "ชื่อ / ชื่อเล่น * (เช่น คุณเป้, ช่างเอ็ม)"
                      : "Name / nickname *"
                  }
                  className="h-11"
                />
                <Input
                  value={contactInput.role}
                  onChange={(e) =>
                    setContactInput((p) => ({ ...p, role: e.target.value }))
                  }
                  placeholder={
                    locale === "th" ? "ตำแหน่ง / บทบาท" : "Role / title"
                  }
                  className="h-11"
                />
                <Input
                  inputMode="tel"
                  value={contactInput.phone}
                  onChange={(e) =>
                    setContactInput((p) => ({ ...p, phone: e.target.value }))
                  }
                  placeholder={
                    locale === "th" ? "เบอร์โทร (08x-xxx-xxxx)" : "Phone"
                  }
                  className="h-11"
                />
                <Input
                  value={contactInput.lineId}
                  onChange={(e) =>
                    setContactInput((p) => ({ ...p, lineId: e.target.value }))
                  }
                  placeholder="LINE ID"
                  className="h-11"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_CHIPS.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setContactInput((p) => ({ ...p, role }))}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      contactInput.role === role
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-secondary"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                {contactFormOpen && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setContactFormOpen(false)}
                  >
                    {locale === "th" ? "ปิด" : "Cancel"}
                  </Button>
                )}
                <Button type="button" size="sm" onClick={addPendingContact}>
                  <Check className="size-4" />
                  {locale === "th" ? "เพิ่มเข้าลิสต์ผู้ติดต่อ" : "Add to list"}
                </Button>
              </div>
            </div>
          )}

          {!selectedCompany &&
            !draft.creatingNewCustomer &&
            draft.pendingContacts.length === 0 &&
            !contactFormOpen && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-4" />
                {locale === "th"
                  ? "เลือกลูกค้าด้านบนเพื่อดูรายชื่อผู้ติดต่อเดิม หรือกด 'เพิ่มผู้ติดต่อ'"
                  : "Select a customer above or click 'Add contact'"}
              </p>
            )}
        </CardContent>
      </Card>

      {/* SECTION 4: DDC PARTS NEEDED & QUANTITY (REQ 2) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                4
              </span>
              {locale === "th"
                ? "Part สินค้า DDC ที่ต้องการ & จำนวน"
                : "DDC Parts Needed & Quantity"}
            </CardTitle>
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">
              {draft.partLines.length} {locale === "th" ? "รายการ" : "items"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Selected Cart */}
          {draft.partLines.length > 0 && (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-semibold text-primary">
                {locale === "th"
                  ? "รายการพาร์ทที่เลือกไว้:"
                  : "Selected parts:"}
              </div>
              {draft.partLines.map((line) => (
                <div
                  key={line.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono font-semibold text-muted-foreground">
                      {line.partNumber}
                    </div>
                    <div className="text-sm font-semibold">{line.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-9"
                      onClick={() =>
                        updatePartLine(line.key, {
                          quantity: Math.max(0, line.quantity - 10),
                        })
                      }
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={line.quantity}
                      onChange={(e) =>
                        updatePartLine(line.key, {
                          quantity: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="h-9 w-20 text-center font-bold tabular-nums"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-9"
                      onClick={() =>
                        updatePartLine(line.key, {
                          quantity: line.quantity + 10,
                        })
                      }
                    >
                      <Plus className="size-4" />
                    </Button>
                    <select
                      value={line.uom}
                      onChange={(e) =>
                        updatePartLine(line.key, { uom: e.target.value })
                      }
                      className="h-9 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="pcs">ชิ้น</option>
                      <option value="set">ชุด</option>
                      <option value="box">กล่อง</option>
                    </select>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9 text-destructive"
                      onClick={() => updatePartLine(line.key, { quantity: 0 })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <label className="flex items-center gap-2 pt-1 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={draft.createRfq}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      createRfq: e.target.checked,
                    }))
                  }
                  className="size-4 accent-primary"
                />
                {locale === "th"
                  ? "สร้างคำขอเสนอราคา (RFQ) พร้อมรายการพาร์ทเหล่านี้ต่ออัตโนมัติ"
                  : "Also create an RFQ with these part lines automatically"}
              </label>
            </div>
          )}

          {/* Category filter chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
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
            {families.map((fam) => (
              <button
                key={String(fam.id)}
                type="button"
                onClick={() => setFamilyFilter(String(fam.id))}
                className={`min-h-9 shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                  familyFilter === String(fam.id)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                {locale === "en" && fam.name_en ? fam.name_en : fam.name}
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

          <div className="relative">
            <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={partSearch}
              onChange={(e) => setPartSearch(e.target.value)}
              placeholder={
                locale === "th"
                  ? "ค้นหารหัสพาร์ท DDC, สเปค (5mm, 17T) หรือรุ่นรถ (JD, CASE, A8000)..."
                  : "Search part number, spec, or machine model..."
              }
              className="h-11 pl-9"
            />
          </div>

          <div className="grid max-h-72 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2">
            {filteredProducts.map((prod) => {
              const line = draft.partLines.find(
                (l) => !l.isCustom && String(l.productId) === String(prod.id),
              );
              const thumb = partImages(prod.custom_fields?.photo_images)[0]
                ?.src;
              return (
                <div
                  key={String(prod.id)}
                  className={`flex flex-col justify-between gap-2 rounded-xl border p-2.5 ${
                    line ? "border-primary bg-primary/5" : "bg-background"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={String(prod.part_number)}
                        className="size-11 shrink-0 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Package className="size-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">
                          {prod.part_number}
                        </span>
                        {line && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">
                            {line.quantity}
                          </span>
                        )}
                      </div>
                      <div className="line-clamp-2 text-xs font-semibold">
                        {prod.name}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[1, 10, 50, 100].map((step) => (
                      <Button
                        key={step}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 px-1.5 text-xs"
                        onClick={() => adjustProductQty(prod, step)}
                      >
                        +{step}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom / Unlisted Part */}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Input
              value={customPartName}
              onChange={(e) => setCustomPartName(e.target.value)}
              placeholder={
                locale === "th"
                  ? "+ พาร์ทใหม่ / นอกแค็ตตาล็อก (ระบุชื่อหรือสเปค)"
                  : "+ Custom / unlisted part name"
              }
              className="h-10 min-w-44 flex-1"
            />
            <Input
              type="number"
              inputMode="decimal"
              min={1}
              value={customPartQty}
              onChange={(e) => setCustomPartQty(e.target.value)}
              className="h-10 w-20 text-center"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-10"
              onClick={addCustomPartLine}
            >
              <Plus className="size-4" />
              {locale === "th" ? "เพิ่มพาร์ท" : "Add"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 5: USAGE CAPACITY & PART REPLACEMENT FREQUENCY (REQ 8) */}
      <Card>
        <CardHeader className="pb-3">
          <button
            type="button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                capExpanded: !prev.capExpanded,
              }))
            }
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                5
              </span>
              <span>
                {locale === "th"
                  ? "Cap. การใช้งานลูกค้า (รถ · ตัน · ความถี่เปลี่ยนพาร์ท)"
                  : "Usage Capacity (Fleet · Tonnage · Replacement Frequency)"}
              </span>
            </CardTitle>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              {draft.capExpanded ? (
                <>
                  {locale === "th" ? "ย่อ" : "Hide"}
                  <ChevronUp className="size-4" />
                </>
              ) : (
                <>
                  {locale === "th" ? "เปิดกรอก" : "Expand"}
                  <ChevronDown className="size-4" />
                </>
              )}
            </span>
          </button>
          {!draft.capExpanded && (
            <p className="mt-1 text-xs text-muted-foreground">
              {totalVehicles > 0 || draft.capTotalTons
                ? `🚜 ${totalVehicles} คัน · ${draft.capTotalTons ? Number(draft.capTotalTons).toLocaleString("th-TH") : "—"} ตัน/ฤดู`
                : excelFleets.length > 0
                  ? `ข้อมูล Excel เดิม: ${excelFleets[0].brands_raw ?? ""} (${excelFleets[0].quantities_raw ?? ""})`
                  : locale === "th"
                    ? "แตะเพื่อบันทึกจำนวนรถ ปริมาณการตัดอ้อย (ตัน/คัน หรือ ตัน/ฤดู) และความถี่การเปลี่ยนอะไหล่"
                    : "Tap to record vehicle fleet, harvest tonnage, and part replacement frequency"}
            </p>
          )}
        </CardHeader>

        {draft.capExpanded && (
          <CardContent className="space-y-4 border-t pt-4">
            {excelFleets.length > 0 && (
              <div className="rounded-xl border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  อ้างอิงข้อมูลสำรวจ Excel เดิม:{" "}
                </span>
                {excelFleets
                  .map((f) =>
                    [
                      f.brands_raw?.replace(/\n/g, ", "),
                      f.quantities_raw
                        ? `จำนวน: ${f.quantities_raw.replace(/\n/g, "/")}`
                        : null,
                      f.capacity_kton_raw
                        ? `กำลังตัด: ${f.capacity_kton_raw} พันตัน`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  )
                  .join(" | ")}
              </div>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "th" ? "ฤดูเก็บเกี่ยว" : "Harvest season"}
                </label>
                <Input
                  value={draft.capSeason}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, capSeason: e.target.value }))
                  }
                  className="mt-1 h-10"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "th" ? "ลักษณะการใช้งานรถ" : "Fleet role"}
                </label>
                <select
                  value={draft.capRole}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      capRole: e.target.value as FieldVisitDraft["capRole"],
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="owner">เจ้าของรถ / ใช้งานตัดอ้อยเอง</option>
                  <option value="service_shop">
                    อู่ซ่อม / ดูแลรถให้ลูกค้า
                  </option>
                  <option value="dealer_network">
                    ดีลเลอร์ / ร้านอะไหล่ (รถในเครือข่าย)
                  </option>
                </select>
              </div>
            </div>

            {/* Fleet Breakdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Tractor className="size-4" />
                  {locale === "th"
                    ? `จำนวนรถของลูกค้า (รวม ${totalVehicles} คัน)`
                    : `Vehicles (Total: ${totalVehicles})`}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      capFleets: [
                        ...p.capFleets,
                        { brand: "", model: "", count: 1 },
                      ],
                    }))
                  }
                >
                  <Plus className="size-3.5" />
                  {locale === "th" ? "เพิ่มยี่ห้อรถ" : "Add brand"}
                </Button>
              </div>
              {draft.capFleets.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1fr_76px_36px] items-center gap-2"
                >
                  <Input
                    value={row.brand}
                    onChange={(e) =>
                      handleFleetRowChange(idx, { brand: e.target.value })
                    }
                    placeholder="ยี่ห้อ (John Deere, Case...)"
                    className="h-10"
                  />
                  <Input
                    value={row.model}
                    onChange={(e) =>
                      handleFleetRowChange(idx, { model: e.target.value })
                    }
                    placeholder="รุ่น (CH570, A8000...)"
                    className="h-10"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={row.count}
                    onChange={(e) =>
                      handleFleetRowChange(idx, {
                        count: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="h-10 text-center font-semibold"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        capFleets: p.capFleets.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <X className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Bidirectional Tonnage Calculator */}
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "th"
                    ? "ตัดได้กี่ตัน / 1 คัน / ฤดู"
                    : "Tons / vehicle / season"}
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={draft.capTonsPerVehicle}
                  onChange={(e) =>
                    handleCapTonnageChange("tonsPerVehicle", e.target.value)
                  }
                  placeholder="เช่น 15000"
                  className="mt-1 h-11 font-semibold tabular-nums"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "th"
                    ? "ตัดรวมทั้งหมดกี่ตัน / 1 ฤดูเก็บเกี่ยว"
                    : "Total tons / harvest season"}
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={draft.capTotalTons}
                  onChange={(e) =>
                    handleCapTonnageChange("totalTons", e.target.value)
                  }
                  placeholder="คำนวณอัตโนมัติ"
                  className="mt-1 h-11 font-semibold tabular-nums"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {locale === "th"
                  ? `กรอกช่องใดช่องหนึ่ง ระบบจะคำนวณสลับคู่กับจำนวนรถ (${totalVehicles} คัน) ให้อัตโนมัติ`
                  : `Enter either field to auto-calculate with ${totalVehicles} vehicle(s).`}
              </p>
            </div>

            {/* Part Replacement Frequency */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {locale === "th"
                    ? "ความถี่ในการเปลี่ยนอะไหล่แต่ละพาร์ท"
                    : "Part replacement frequency"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      capPartUsage: [
                        ...p.capPartUsage,
                        {
                          tempId: `usage-${Date.now()}`,
                          partLabel: "",
                          qtyPerChange: "8",
                          intervalValue: "500",
                          intervalUnit: "tons",
                          currentBrand: "",
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="size-3.5" />
                  {locale === "th" ? "เพิ่มพาร์ท" : "Add part"}
                </Button>
              </div>
              {draft.capPartUsage.map((u, idx) => {
                const estSeason = computeEstimatedSeasonQty({
                  qtyPerChange: u.qtyPerChange ? Number(u.qtyPerChange) : null,
                  intervalValue: u.intervalValue
                    ? Number(u.intervalValue)
                    : null,
                  intervalUnit: u.intervalUnit,
                  totalTonsPerSeason: totalTonsNum,
                  totalVehicles,
                });
                return (
                  <div
                    key={u.tempId}
                    className="space-y-2 rounded-xl border bg-background p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-[1fr_150px_36px]">
                      <Input
                        value={u.partLabel}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            capPartUsage: p.capPartUsage.map((row, i) =>
                              i === idx
                                ? { ...row, partLabel: e.target.value }
                                : row,
                            ),
                          }))
                        }
                        placeholder="ชื่อพาร์ท เช่น ใบมีดตัดโคน, ใบมีดสับ, สเตอร์"
                        className="h-10"
                      />
                      <Input
                        value={u.currentBrand}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            capPartUsage: p.capPartUsage.map((row, i) =>
                              i === idx
                                ? { ...row, currentBrand: e.target.value }
                                : row,
                            ),
                          }))
                        }
                        placeholder="ยี่ห้อเดิม (BUSSOLA...)"
                        className="h-10"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            capPartUsage: p.capPartUsage.filter(
                              (_, i) => i !== idx,
                            ),
                          }))
                        }
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span>
                        {locale === "th" ? "ใช้ครั้งละ" : "Qty/change"}
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={u.qtyPerChange}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            capPartUsage: p.capPartUsage.map((row, i) =>
                              i === idx
                                ? { ...row, qtyPerChange: e.target.value }
                                : row,
                            ),
                          }))
                        }
                        className="h-9 w-20 text-center font-semibold"
                      />
                      <span>
                        {locale === "th" ? "ชิ้น · เปลี่ยนทุกๆ" : "pcs every"}
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={u.intervalValue}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            capPartUsage: p.capPartUsage.map((row, i) =>
                              i === idx
                                ? { ...row, intervalValue: e.target.value }
                                : row,
                            ),
                          }))
                        }
                        className="h-9 w-24 text-center font-semibold"
                      />
                      <select
                        value={u.intervalUnit}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            capPartUsage: p.capPartUsage.map((row, i) =>
                              i === idx
                                ? {
                                    ...row,
                                    intervalUnit: e.target
                                      .value as ReplacementIntervalUnit,
                                  }
                                : row,
                            ),
                          }))
                        }
                        className="h-9 rounded-md border bg-background px-2 text-xs"
                      >
                        {REPLACEMENT_INTERVAL_UNITS.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {locale === "en" ? unit.labelEn : unit.labelTh}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between border-t pt-2 text-xs">
                      <span className="text-muted-foreground">
                        {locale === "th"
                          ? "ประมาณการความต้องการใช้ / ฤดู:"
                          : "Estimated seasonal demand:"}
                      </span>
                      <span className="font-bold text-primary tabular-nums">
                        {estSeason != null
                          ? `${estSeason.toLocaleString("th-TH")} ${locale === "th" ? "ชิ้น/ฤดู" : "pcs/season"}`
                          : locale === "th"
                            ? "ระบุตันรวมเพื่อคำนวณ"
                            : "Enter total tons"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* SECTION 6: FIELD PHOTOS (CAMERA / GALLERY + AUTO-COMPRESS) (REQ 7) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                6
              </span>
              {locale === "th"
                ? "รูปภาพหน้างาน / ตัวอย่างชิ้นส่วน"
                : "Site & Part Photos"}
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {draft.photos.length}{" "}
              {locale === "th" ? "รูป · บีบอัดอัตโนมัติ" : "photos"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Select category tag before taking photo */}
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_TAGS.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setActivePhotoTag(tag.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  activePhotoTag === tag.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                {locale === "en" ? tag.labelEn : tag.labelTh}
              </button>
            ))}
          </div>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePhotosPicked}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={handlePhotosPicked}
          />

          <div className="grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="outline"
              className="h-12 border-primary/50 text-primary"
              disabled={photoBusy}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="size-4" />
              {photoBusy
                ? locale === "th"
                  ? "กำลังย่อรูป..."
                  : "Processing..."
                : locale === "th"
                  ? "ถ่ายรูป"
                  : "Take photo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12"
              disabled={photoBusy}
              onClick={() => galleryRef.current?.click()}
            >
              <ImagePlus className="size-4" />
              {locale === "th" ? "แนบรูปจากเครื่อง" : "Attach images"}
            </Button>
          </div>

          {draft.photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {draft.photos.map((ph) => {
                const tagMeta = PHOTO_TAGS.find((t) => t.id === ph.tag);
                return (
                  <div
                    key={ph.id}
                    className="overflow-hidden rounded-xl border bg-background"
                  >
                    <div className="relative">
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => setLightboxPhoto(ph)}
                      >
                        <img
                          src={ph.src}
                          alt={ph.caption || ph.fileName}
                          className="h-32 w-full object-cover"
                        />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            photos: p.photos.filter((x) => x.id !== ph.id),
                          }))
                        }
                        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/75 text-white"
                      >
                        <X className="size-3.5" />
                      </button>
                      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
                        {locale === "en" ? tagMeta?.labelEn : tagMeta?.labelTh}
                        {ph.approxKb ? ` · ${ph.approxKb} KB` : ""}
                      </span>
                    </div>
                    <div className="p-2">
                      <Input
                        value={ph.caption}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            photos: p.photos.map((x) =>
                              x.id === ph.id
                                ? { ...x, caption: e.target.value }
                                : x,
                            ),
                          }))
                        }
                        placeholder={
                          locale === "th" ? "คำอธิบายรูป (ถ้ามี)" : "Caption"
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 7: SUMMARY, ACTIVITY TYPE & SAVE TO TIMELINE (REQ 6) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              7
            </span>
            {locale === "th"
              ? "สรุปการเข้าพบ & บันทึกลง Timeline Log"
              : "Visit Summary & Save to Timeline"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIVITY_TYPES.map((tp) => (
              <button
                key={tp.code}
                type="button"
                onClick={() =>
                  setDraft((p) => ({ ...p, activityTypeCode: tp.code }))
                }
                className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium ${
                  draft.activityTypeCode === tp.code
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                {locale === "en" ? tp.en : tp.th}
              </button>
            ))}
          </div>

          <Textarea
            rows={3}
            value={draft.summary}
            onChange={(e) =>
              setDraft((p) => ({ ...p, summary: e.target.value }))
            }
            placeholder={
              locale === "th"
                ? "สรุปผลการเข้าพบ ความต้องการ ราคาเป้าหมาย คู่แข่ง หรือปัญหาที่ลูกค้าพบ..."
                : "Visit summary, requirements, competitor notes..."
            }
          />

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">
                {locale === "th"
                  ? "ผลลัพธ์ / สิ่งที่ต้องทำต่อ"
                  : "Outcome / next step"}
              </label>
              <Input
                value={draft.outcome}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, outcome: e.target.value }))
                }
                placeholder={
                  locale === "th"
                    ? "เช่น ส่งตัวอย่าง 2 ใบ, ทำใบเสนอราคา"
                    : "e.g. Send sample, prepare quote"
                }
                className="mt-1 h-11"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {locale === "th"
                  ? "วันนัดติดตามครั้งถัดไป"
                  : "Next follow-up date"}
              </label>
              <Input
                type="date"
                value={draft.followUpDate}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, followUpDate: e.target.value }))
                }
                className="mt-1 h-11"
              />
            </div>
          </div>

          <Button
            type="button"
            size="lg"
            className="h-12 w-full text-base font-bold"
            disabled={saving}
            onClick={handleSaveVisit}
          >
            <Save className="size-5" />
            {saving
              ? locale === "th"
                ? "กำลังบันทึกข้อมูล..."
                : "Saving visit..."
              : locale === "th"
                ? "บันทึกการเข้าพบลง Timeline Log"
                : "Save Visit to Timeline Log"}
          </Button>
        </CardContent>
      </Card>

      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <Dialog open onOpenChange={(open) => !open && setLightboxPhoto(null)}>
          <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
            <DialogTitle>
              {lightboxPhoto.caption || lightboxPhoto.fileName}
            </DialogTitle>
            <img
              src={lightboxPhoto.src}
              alt={lightboxPhoto.caption || lightboxPhoto.fileName}
              className="mt-2 max-h-[72vh] w-full rounded object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

FieldVisitPage.path = "/field-visit";
