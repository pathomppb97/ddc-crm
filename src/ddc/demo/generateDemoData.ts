import type { Db } from "@/components/atomic-crm/providers/fakerest/dataGenerator/types";
import referenceData from "./referenceData.json";

/**
 * SYNTHETIC evaluation data for the in-browser mode (npm run dev:demo).
 *
 * Every company, person, product and amount below is invented for testing the
 * workflows. None of it describes DDC customers, products, prices or
 * specifications. Product records deliberately carry no technical
 * specification and every machine application is "unverified".
 * Reference data (roles, permissions, code lists, pipelines, ERP contracts)
 * comes from the real migrations through referenceData.json.
 */

type Row = Record<string, unknown> & { id: number | string };
export type DdcDemoDb = Db & Record<string, Row[]>;

const DAY = 86_400_000;

/** Small deterministic PRNG so the evaluation data is the same on every load. */
const prng = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return seed / 4_294_967_296;
};

export const DEMO_ACCOUNTS = [
  {
    id: 0,
    role_key: "system_admin",
    first_name: "ผู้ดูแลระบบ",
    last_name: "(ทดลอง)",
    email: "admin@demo.ddc.test",
    administrator: true,
  },
  {
    id: 1,
    role_key: "management",
    first_name: "ผู้บริหาร",
    last_name: "(ทดลอง)",
    email: "management@demo.ddc.test",
    administrator: false,
  },
  {
    id: 2,
    role_key: "sales_manager",
    first_name: "ผู้จัดการขาย",
    last_name: "(ทดลอง)",
    email: "sales.manager@demo.ddc.test",
    administrator: false,
  },
  {
    id: 3,
    role_key: "sales_rep",
    first_name: "พนักงานขาย ก",
    last_name: "(ทดลอง)",
    email: "sales.a@demo.ddc.test",
    administrator: false,
  },
  {
    id: 4,
    role_key: "sales_rep",
    first_name: "พนักงานขาย ข",
    last_name: "(ทดลอง)",
    email: "sales.b@demo.ddc.test",
    administrator: false,
  },
  {
    id: 5,
    role_key: "marketing",
    first_name: "การตลาด",
    last_name: "(ทดลอง)",
    email: "marketing@demo.ddc.test",
    administrator: false,
  },
  {
    id: 6,
    role_key: "engineering",
    first_name: "วิศวกร",
    last_name: "(ทดลอง)",
    email: "engineering@demo.ddc.test",
    administrator: false,
  },
  {
    id: 7,
    role_key: "quality",
    first_name: "ประกันคุณภาพ",
    last_name: "(ทดลอง)",
    email: "quality@demo.ddc.test",
    administrator: false,
  },
  {
    id: 8,
    role_key: "finance",
    first_name: "การเงิน",
    last_name: "(ทดลอง)",
    email: "finance@demo.ddc.test",
    administrator: false,
  },
  {
    id: 9,
    role_key: "read_only",
    first_name: "ผู้อ่านอย่างเดียว",
    last_name: "(ทดลอง)",
    email: "readonly@demo.ddc.test",
    administrator: false,
  },
];

const REFERENCE = referenceData as unknown as Record<string, Row[]>;

const optionId = (category: string, code: string) =>
  REFERENCE.master_options.find(
    (o) => o.category === category && o.code === code,
  )!.id as number;
const idByCode = (table: string, code: string) =>
  REFERENCE[table].find((r) => r.code === code)!.id as number;

export const generateDdcDemoData = (now = new Date()): DdcDemoDb => {
  const random = prng(20261111);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const iso = (offsetDays: number) =>
    new Date(now.getTime() + offsetDays * DAY).toISOString();
  const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);
  const year = now.getFullYear();
  const reps = [2, 3, 4];

  const db: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(REFERENCE))
    db[table] = rows.map((row) => ({ ...row }));

  db.sales = DEMO_ACCOUNTS.map((account) => ({
    ...account,
    disabled: false,
    user_id: String(account.id),
    password: "demo",
  }));
  db.tags = [
    { id: 1, name: "ลูกค้าสำคัญ (ทดลอง)", color: "#eddcd2" },
    { id: 2, name: "ส่งออก (ทดลอง)", color: "#dbe7e4" },
  ];
  db.configuration = [{ id: 1, config: {} as never }];

  const models = ["OEM", "ODM", "OBM", "DEALER", "DISTRIBUTOR", "EXPORT"].map(
    (c) => idByCode("business_models", c),
  );
  const territories = [
    {
      id: 1,
      code: "DEMO-C",
      name: "ภาคกลาง (ทดลอง)",
      name_en: "Central (demo)",
      parent_id: null,
      country: "TH",
      is_active: true,
    },
    {
      id: 2,
      code: "DEMO-NE",
      name: "ภาคตะวันออกเฉียงเหนือ (ทดลอง)",
      name_en: "Northeast (demo)",
      parent_id: null,
      country: "TH",
      is_active: true,
    },
    {
      id: 3,
      code: "DEMO-EXP",
      name: "ต่างประเทศ (ทดลอง)",
      name_en: "Export (demo)",
      parent_id: null,
      country: null,
      is_active: true,
    },
  ];
  db.territories = territories;

  const lifecycles = ["prospect", "active", "active", "active", "on_hold"].map(
    (c) => optionId("customer_lifecycle_status", c),
  );
  const customerGroups = [
    "sugar_mill",
    "dealer",
    "repair_shop",
    "parts_shop",
    "farm_owner",
  ].map((c) => optionId("customer_group", c));
  const provinces = [
    "กรุงเทพมหานคร",
    "ชลบุรี",
    "ขอนแก่น",
    "นครราชสีมา",
    "สมุทรปราการ",
  ];
  db.companies = Array.from({ length: 24 }, (_, i) => {
    const n = i + 1;
    const exportCustomer = n % 6 === 0;
    const latitude = exportCustomer ? null : 13.75 + (i % 5) * 0.45;
    const longitude = exportCustomer ? null : 100.5 + (i % 4) * 0.6;
    return {
      id: n,
      customer_code: `CUS-${String(n).padStart(6, "0")}`,
      name: exportCustomer
        ? `Synthetic Export Customer ${n} (demo)`
        : `บริษัท ตัวอย่างลูกค้า ${n} จำกัด (ทดลอง)`,
      legal_name: null,
      org_type: n === 2 ? "headquarters" : n === 3 ? "branch" : "standalone",
      parent_company_id: n === 3 ? 2 : null,
      branch_code: n === 3 ? "0001" : null,
      sector: null,
      size: null,
      lifecycle_status_id: lifecycles[i % lifecycles.length],
      category_id:
        n % 4 === 0
          ? optionId("customer_category", "key_account")
          : optionId("customer_category", "standard"),
      customer_group_id: customerGroups[i % customerGroups.length],
      territory_id: exportCustomer ? 3 : (i % 2) + 1,
      sales_id: reps[i % reps.length],
      phone_number: `+66 2 000 ${String(1000 + n)}`,
      email: `contact${n}@customer${n}.example.test`,
      website: `https://customer${n}.example.test`,
      address: `${n} ถนนตัวอย่าง`,
      city: exportCustomer ? null : "เมือง",
      province: exportCustomer ? null : provinces[i % provinces.length],
      zipcode: null,
      country: exportCustomer ? "VN" : "TH",
      latitude,
      longitude,
      google_maps_url:
        latitude != null && longitude != null
          ? `https://maps.google.com/?q=${latitude.toFixed(4)},${longitude.toFixed(4)}`
          : null,
      location_note: exportCustomer
        ? null
        : `จุดสังเกตพื้นที่ตัวอย่าง ${provinces[i % provinces.length]}`,
      description: "ข้อมูลสังเคราะห์สำหรับทดสอบระบบ",
      tax_identifier: exportCustomer ? null : `0105599${String(100000 + n)}`,
      created_at: iso(-400 + i * 15),
      updated_at: iso(-30),
      custom_fields: {},
      logo: null,
      context_links: [],
      nb_contacts: 0,
      nb_deals: 0,
    };
  });

  db.company_business_models = db.companies.flatMap((company, i) => {
    const rows = [
      {
        id: i * 2 + 1,
        company_id: company.id,
        business_model_id: models[i % models.length],
        sales_channel_id: optionId(
          "sales_channel",
          i % 2 ? "direct" : "distribution",
        ),
        is_primary: true,
        notes: null,
      },
    ];
    if (i % 4 === 1) {
      rows.push({
        ...rows[0],
        id: i * 2 + 2,
        business_model_id: models[(i + 2) % models.length],
        is_primary: false,
      });
    }
    return rows;
  });

  db.contacts = db.companies.flatMap((company, i) =>
    [0, 1].map((k) => ({
      id: i * 2 + k + 1,
      first_name: k === 0 ? `ผู้ติดต่อ${i + 1}` : `ฝ่ายจัดซื้อ${i + 1}`,
      last_name: "(ทดลอง)",
      nickname: k === 0 ? `ต้น${i + 1}` : null,
      title: k === 0 ? "ผู้จัดการฝ่ายจัดซื้อ" : "เจ้าหน้าที่จัดซื้อ",
      department: "จัดซื้อ",
      is_primary: k === 0,
      company_id: company.id,
      company_name: company.name,
      sales_id: company.sales_id,
      line_id: k === 0 ? `demo_line_${i + 1}` : null,
      email_jsonb: [
        { email: `buyer${k}@customer${i + 1}.example.test`, type: "Work" },
      ],
      phone_jsonb: [{ number: `+66 2 000 ${2000 + i}`, type: "Work" }],
      first_seen: iso(-300 + i * 10),
      last_seen: iso(-5 - i),
      status: "warm",
      tags: [],
      background: "",
      gender: null,
      has_newsletter: false,
      custom_fields: {},
      nb_tasks: 0,
      avatar: null,
      linkedin_url: null,
    })),
  );
  db.contact_notes = [];
  db.tasks = [];

  db.manufacturers = [
    {
      id: 1,
      name: "Demo Harvester Works (synthetic)",
      country: null,
      is_active: true,
    },
  ];
  db.brands = [
    {
      id: 1,
      code: "DEMO-OBM",
      name: "แบรนด์ทดลอง (OBM)",
      owner_type: "ddc_owned",
      description: "แบรนด์สมมติสำหรับทดสอบ",
      is_active: true,
    },
  ];
  db.machine_models = [
    {
      id: 1,
      manufacturer_id: 1,
      equipment_type_id: optionId("equipment_type", "sugarcane_harvester"),
      model_name: "Demo Harvester H1",
      series: null,
      year_from: null,
      year_to: null,
      notes: "ข้อมูลสังเคราะห์",
      is_active: true,
    },
  ];

  const families = db.product_hierarchy_nodes.filter(
    (n) => n.level === "family",
  );
  db.products = Array.from({ length: 16 }, (_, i) => {
    const family = families[i % families.length];
    return {
      id: i + 1,
      part_number: `DEMO-PART-${String(i + 1).padStart(4, "0")}`,
      name: `ชิ้นส่วนทดลอง ${i + 1} (${family.name})`,
      name_en: `Demo part ${i + 1}`,
      node_id: family.id,
      brand_id: i % 5 === 0 ? 1 : null,
      lifecycle_status_id: optionId(
        "product_lifecycle_status",
        i % 7 === 0 ? "development" : "active",
      ),
      material: null,
      uom: "pcs",
      description: "สินค้าสมมติ ไม่มีข้อกำหนดทางเทคนิคจริง",
      current_revision: null,
      custom_fields: {},
      sales_id: 6,
      created_at: iso(-200),
      updated_at: iso(-20),
    };
  });
  db.product_machine_applications = db.products.slice(0, 4).map((p, i) => ({
    id: i + 1,
    product_id: p.id,
    machine_model_id: 1,
    component_application: "ตัวอย่างตำแหน่งใช้งาน",
    application_notes: "ยังไม่ได้ยืนยัน",
    verification_status: "unverified",
    verification_source: null,
    verified_by: null,
    verified_at: null,
  }));
  for (const table of [
    "product_specifications",
    "product_customer_references",
    "product_revisions",
    "product_relations",
  ]) {
    db[table] = [];
  }
  db.company_product_interests = db.companies.slice(0, 16).map((c, i) => ({
    id: i + 1,
    company_id: c.id,
    node_id: families[i % families.length].id,
    product_id: null,
    interest_level: pick(["low", "medium", "high"]),
    notes: null,
    created_at: iso(-100 + i),
  }));

  const standard = db.pipelines.find((p) => p.code === "STANDARD")!;
  const oem = db.pipelines.find((p) => p.code === "OEM_ODM")!;
  const stagesOf = (pipelineId: unknown) =>
    db.pipeline_stages.filter((s) => s.pipeline_id === pipelineId);
  db.deals = Array.from({ length: 22 }, (_, i) => {
    const company = db.companies[i % db.companies.length];
    const pipeline = i % 3 === 0 ? oem : standard;
    const stage = stagesOf(pipeline.id)[i % stagesOf(pipeline.id).length];
    const closed = stage.stage_type !== "open";
    return {
      id: i + 1,
      name: `โอกาสทดลอง ${i + 1}`,
      company_id: company.id,
      contact_ids: [db.contacts[(i * 2) % db.contacts.length].id],
      categories: [],
      stage: stage.code,
      pipeline_id: pipeline.id,
      description: "ข้อมูลสังเคราะห์",
      amount: i % 5 === 4 ? null : Math.round(50 + random() * 950) * 1000,
      currency: company.country === "TH" ? "THB" : "USD",
      probability: null,
      estimated_quantity: Math.round(1000 + random() * 20000),
      quantity_uom: "pcs",
      business_model_id: models[i % models.length],
      lead_id: null,
      loss_reason_id:
        stage.stage_type === "lost"
          ? optionId("loss_reason", pick(["price", "lead_time", "competitor"]))
          : null,
      loss_notes: null,
      follow_up_date: closed ? null : day(-3 + (i % 10)),
      created_at: iso(-180 + i * 7),
      updated_at: iso(-10 + (i % 9)),
      closed_at: closed ? iso(-40 + i) : null,
      archived_at: null,
      expected_closing_date: day(30 + i * 3),
      sales_id: company.sales_id,
      index: i,
      custom_fields: {},
    };
  });
  db.deal_notes = [];
  db.deal_competitors = [
    {
      id: 1,
      deal_id: 2,
      competitor_name: "Competitor X (synthetic)",
      offering: null,
      price_information: null,
      notes: null,
    },
  ];
  db.deal_products = db.deals.slice(0, 12).map((d, i) => ({
    id: i + 1,
    deal_id: d.id,
    product_id: db.products[i % db.products.length].id,
    node_id: null,
    description: null,
    quantity: d.estimated_quantity,
    uom: "pcs",
    target_price: null,
    notes: null,
  }));

  const leadStatuses = ["new", "contacted", "qualified", "new", "disqualified"];
  db.leads = Array.from({ length: 14 }, (_, i) => ({
    id: i + 1,
    lead_no: `LD-${year}-${String(i + 1).padStart(5, "0")}`,
    company_name: `ลีดทดลอง ${i + 1} จำกัด`,
    contact_name: `คุณทดลอง ${i + 1}`,
    contact_title: "ผู้จัดการ",
    email: `lead${i + 1}@prospect.example.test`,
    phone: `+66 2 111 ${String(1000 + i)}`,
    website: null,
    country: "TH",
    province: provinces[i % provinces.length],
    territory_id: (i % 2) + 1,
    source_id: optionId(
      "lead_source",
      pick(["exhibition", "referral", "website", "outbound"]),
    ),
    business_model_id: models[i % models.length],
    status: leadStatuses[i % leadStatuses.length],
    product_interest: families[i % families.length].name,
    estimated_value: i % 3 === 0 ? null : (i + 1) * 25000,
    currency: "THB",
    qualification_notes: null,
    disqualification_reason:
      leadStatuses[i % leadStatuses.length] === "disqualified"
        ? "ไม่ตรงกลุ่มเป้าหมาย (ทดลอง)"
        : null,
    follow_up_date: day(-4 + i),
    sales_id: [3, 4, 5][i % 3],
    converted_company_id: null,
    converted_contact_id: null,
    converted_deal_id: null,
    converted_at: null,
    custom_fields: {},
    created_at: iso(-90 + i * 6),
    updated_at: iso(-5),
  }));

  const activityTypes = [
    "onsite_visit",
    "dealer_visit",
    "meeting",
    "phone_call",
    "technical_discussion",
    "email",
  ];
  db.activities = Array.from({ length: 36 }, (_, i) => {
    const offset = -60 + i * 2.5;
    const company = db.companies[i % db.companies.length];
    const companyDeal = db.deals.find((d) => d.company_id === company.id);
    const startIso = iso(offset);
    return {
      id: i + 1,
      activity_type_id: optionId(
        "activity_type",
        activityTypes[i % activityTypes.length],
      ),
      subject: `กิจกรรมทดลอง ${i + 1}`,
      company_id: company.id,
      deal_id: i % 4 === 0 && companyDeal ? companyDeal.id : null,
      lead_id: null,
      start_at: startIso,
      end_at: iso(offset + 0.05),
      logged_at: startIso,
      location: i % 3 === 0 ? company.province : null,
      checkin_lat: company.latitude ?? null,
      checkin_lng: company.longitude ?? null,
      checkin_accuracy_m: company.latitude != null ? 15 : null,
      objective: "ข้อมูลสังเคราะห์",
      discussion: null,
      outcome: null,
      status:
        offset < 0 ? (i % 9 === 0 ? "cancelled" : "completed") : "planned",
      follow_up_date: null,
      sales_id: company.sales_id,
      created_at: iso(offset - 3),
      updated_at: startIso,
    };
  });
  db.activity_participants = [];
  db.activity_products = [];
  db.action_items = db.activities.slice(0, 12).map((a, i) => ({
    id: i + 1,
    activity_id: a.id,
    company_id: a.company_id,
    description: `ติดตามผลกิจกรรมทดลอง ${a.id}`,
    sales_id: a.sales_id,
    due_date: day(-6 + i),
    status: i % 4 === 0 ? "done" : "open",
    completed_at: i % 4 === 0 ? iso(-2) : null,
    created_at: a.created_at,
  }));

  db.rfqs = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    rfq_no: `RFQ-${year}-${String(i + 1).padStart(5, "0")}`,
    customer_rfq_ref: `CUST-REF-${i + 1}`,
    company_id: db.companies[i].id,
    contact_id: db.contacts[i * 2].id,
    deal_id: db.deals[i].id,
    subject: `คำขอเสนอราคาทดลอง ${i + 1}`,
    received_date: day(-50 + i * 5),
    quotation_due_date: day(-30 + i * 6),
    requested_delivery_date: null,
    customer_requirements: "ข้อมูลสังเคราะห์",
    status: ["registered", "engineering_review", "costing", "quoted"][i % 4],
    engineering_review_status: [
      "not_required",
      "pending",
      "feasible",
      "feasible_with_conditions",
    ][i % 4],
    engineering_notes: null,
    engineering_reviewer_id: i % 4 >= 2 ? 6 : null,
    engineering_reviewed_at: i % 4 >= 2 ? iso(-20) : null,
    cost_estimate_ref: null,
    follow_up_date: day(i),
    sales_id: db.companies[i].sales_id,
    created_at: iso(-50 + i * 5),
    updated_at: iso(-10),
  }));
  db.rfq_items = db.rfqs.flatMap((rfq, i) =>
    [1, 2].map((line) => ({
      id: i * 2 + line,
      rfq_id: rfq.id,
      line_no: line,
      product_id: db.products[(i + line) % db.products.length].id,
      customer_part_number: `CUST-PN-${i + 1}-${line}`,
      description: null,
      quantity: 1000 * line,
      uom: "pcs",
      target_price: null,
      currency: null,
      requested_specification: null,
      requested_delivery_date: null,
      drawing_no: null,
      drawing_revision: null,
    })),
  );

  const quotationStatuses = [
    "draft",
    "pending_approval",
    "approved",
    "sent",
    "accepted",
    "declined",
  ];
  db.quotations = db.rfqs.slice(0, 6).map((rfq, i) => ({
    id: i + 1,
    quotation_no: `QT-${year}-${String(i + 1).padStart(5, "0")}`,
    revision: 0,
    previous_revision_id: null,
    rfq_id: rfq.id,
    deal_id: rfq.deal_id,
    company_id: rfq.company_id,
    contact_id: rfq.contact_id,
    subject: `ใบเสนอราคาทดลอง ${i + 1}`,
    currency: "THB",
    status: quotationStatuses[i],
    valid_until: day(30),
    payment_terms: null,
    delivery_terms: null,
    notes: null,
    total_amount: 0,
    follow_up_date: day(i - 2),
    sales_id: rfq.sales_id,
    submitted_by: i >= 1 ? rfq.sales_id : null,
    submitted_at: i >= 1 ? iso(-25 + i) : null,
    approved_at: i >= 2 ? iso(-24 + i) : null,
    sent_at: i >= 3 ? iso(-23 + i) : null,
    decided_at: i >= 4 ? iso(-10) : null,
    created_at: iso(-26 + i),
    updated_at: iso(-10),
  }));
  db.quotation_items = db.quotations.flatMap((q, i) =>
    [1, 2].map((line) => {
      const quantity = 1000 * line;
      const unit_price = 10 + i * 2 + line;
      return {
        id: i * 2 + line,
        quotation_id: q.id,
        line_no: line,
        product_id: db.products[(i + line) % db.products.length].id,
        rfq_item_id: null,
        description: null,
        quantity,
        uom: "pcs",
        unit_price,
        discount_percent: 0,
        line_total: quantity * unit_price,
        lead_time_days: null,
        notes: null,
      };
    }),
  );
  for (const q of db.quotations) {
    q.total_amount = db.quotation_items
      .filter((it) => it.quotation_id === q.id)
      .reduce((s, it) => s + Number(it.line_total), 0);
  }
  db.quotation_approvals = db.quotations
    .filter((q) => q.status !== "draft")
    .map((q, i) => ({
      id: i + 1,
      quotation_id: q.id,
      rule_id: null,
      required_role_key: null,
      status: q.status === "pending_approval" ? "pending" : "approved",
      decided_by: q.status === "pending_approval" ? null : 2,
      decided_at: q.status === "pending_approval" ? null : q.approved_at,
      comment: null,
      created_at: q.submitted_at,
    }));
  db.approval_rules = [];

  db.dev_projects = [
    {
      id: 1,
      project_no: `DEV-${year}-00001`,
      name: "โครงการพัฒนาทดลอง (OEM)",
      company_id: 1,
      deal_id: 1,
      rfq_id: 1,
      business_model_id: models[0],
      product_id: null,
      status: "feasibility",
      inquiry_summary: "ข้อมูลสังเคราะห์",
      feasibility_status: "pending",
      feasibility_notes: null,
      process_considerations: null,
      material_requirements: null,
      tooling_requirements: null,
      customer_approval_status: "not_submitted",
      estimated_production_ready_date: null,
      responsible_department_id: optionId("department", "engineering"),
      sales_id: 3,
      created_at: iso(-45),
      updated_at: iso(-5),
    },
  ];
  db.dev_project_requirements = [];
  db.dev_project_milestones = [
    {
      id: 1,
      project_id: 1,
      name: "ประเมินความเป็นไปได้",
      department_id: optionId("department", "engineering"),
      sales_id: 6,
      planned_date: day(10),
      actual_date: null,
      status: "in_progress",
      notes: null,
      sort_order: 10,
    },
  ];
  db.dev_project_samples = [];
  db.dev_project_risks = [];

  db.dealer_networks = db.companies.slice(4, 9).map((c, i) => ({
    id: i + 1,
    brand_id: 1,
    company_id: c.id,
    supplied_by_company_id: i > 0 ? db.companies[4].id : null,
    network_role: i === 0 ? "distributor" : "dealer",
    territory_id: c.territory_id,
    status: i === 4 ? "prospect" : "active",
    start_date: day(-300),
    end_date: null,
    notes: null,
    sales_id: c.sales_id,
    created_at: iso(-300),
  }));
  db.dealer_product_coverage = [];

  db.service_cases = [
    {
      id: 1,
      case_no: `CASE-${year}-00001`,
      company_id: 2,
      contact_id: 3,
      customer_reference: "CUST-COMPLAINT-1",
      category_id: optionId("complaint_category", "delivery"),
      subject: "ข้อร้องเรียนทดลอง",
      description: "ข้อมูลสังเคราะห์",
      priority: "high",
      status: "investigating",
      received_date: day(-8),
      due_date: day(-1),
      assigned_department_id: optionId("department", "quality"),
      sales_id: 3,
      investigation_summary: null,
      corrective_action_summary: null,
      external_8d_ref: null,
      external_ncr_ref: null,
      external_capa_ref: null,
      closure_summary: null,
      closed_at: null,
      closed_by: null,
      created_at: iso(-8),
      updated_at: iso(-2),
    },
  ];
  db.service_case_products = [];
  db.service_case_communications = [];

  db.document_references = [];
  db.custom_field_definitions = [];
  db.notifications = [];
  db.audit_log = [];
  db.company_addresses = [];
  db.company_territories = [];

  const sourceCompanies = db.companies.slice(0, 6);
  db.customer_source_rows = sourceCompanies.map((company, i) => ({
    id: i + 1,
    company_id: company.id,
    source_file: "synthetic_customer_list_demo.xlsx",
    sheet_name: "Requirement",
    source_row: 5 + i,
    region: company.territory_id === 2 ? "ภาคอีสาน (ทดลอง)" : "ภาคกลาง (ทดลอง)",
    source_sequence: i + 1,
    raw_cells: {
      customer_code: company.customer_code,
      company_name: company.name,
      province: company.province,
      synthetic: true,
    },
    review_notes: null,
  }));
  db.customer_fleets = sourceCompanies.map((company, i) => ({
    id: i + 1,
    company_id: company.id,
    source_id: i + 1,
    brands_raw: i % 2 === 0 ? "Demo Harvester H1" : "Synthetic Harvester S2",
    quantities_raw: String(2 + (i % 4)),
    capacity_kton_raw: String(15 + i * 5),
  }));
  db.customer_requirements = sourceCompanies.map((company, i) => ({
    id: i + 1,
    company_id: company.id,
    source_id: i + 1,
    product_family: i % 2 === 0 ? "Basecutter Blade" : "Chopper Blade",
    old_brands_raw: "OEM / Aftermarket (ทดลอง)",
    specification_raw: "ข้อมูลสังเคราะห์สำหรับทดสอบหน้าจอ",
    target_cost_raw: String(120 + i * 10),
    seasonal_usage_raw: String(400 + i * 100),
    blades_per_machine_raw: i % 2 === 0 ? "12" : "8",
  }));
  db.customer_samples = sourceCompanies.slice(0, 3).map((company, i) => ({
    id: i + 1,
    company_id: company.id,
    source_id: i + 1,
    requirement_id: i + 1,
    product_family: db.customer_requirements[i].product_family,
    specification_raw: "ตัวอย่างทดสอบสังเคราะห์",
    quantity_raw: "10",
    sample_date_raw: day(-30 + i * 5),
    testing_date_raw: day(-20 + i * 5),
    customer_pic_raw: `ผู้ติดต่อ${i + 1}`,
  }));
  db.customer_purchase_history = sourceCompanies
    .slice(0, 4)
    .map((company, i) => ({
      id: i + 1,
      company_id: company.id,
      source_id: i + 1,
      requirement_id: i + 1,
      season: i % 2 === 0 ? "25-26" : "26-27",
      specification_raw: "ประวัติปริมาณสั่งซื้อสังเคราะห์",
      quantity_raw: String(300 + i * 50),
      sent_date_raw: day(-90 + i * 10),
      review_notes: "ข้อมูลสังเคราะห์สำหรับทดสอบระบบ",
    }));
  db.customer_capacity_profiles = sourceCompanies.map((company, i) => ({
    id: i + 1,
    company_id: company.id,
    season_label: "2569/70",
    capacity_role: (["owner", "service_shop", "dealer_network"] as const)[
      i % 3
    ],
    total_vehicles: 3 + i,
    tons_per_vehicle: 12000,
    total_tons_per_season: (3 + i) * 12000,
    fleet_breakdown: [{ brand: "Demo Harvester", model: "H1", count: 3 + i }],
    notes: "ข้อมูลสังเคราะห์สำหรับทดสอบ",
    sales_id: company.sales_id,
    created_at: iso(-60 + i * 5),
    updated_at: iso(-10 + i),
  }));
  db.customer_part_usage = sourceCompanies.map((company, i) => {
    const product = db.products[i % db.products.length];
    return {
      id: i + 1,
      company_id: company.id,
      product_id: product.id,
      part_label: String(product.name),
      qty_per_change: 12,
      change_interval_value: 2000,
      change_interval_unit: "tons",
      estimated_season_qty: (3 + i) * 72,
      current_brand: "Demo OEM",
      notes: "ข้อมูลสังเคราะห์สำหรับทดสอบ",
      recorded_activity_id:
        db.activities.find((a) => a.company_id === company.id)?.id ?? null,
      sales_id: company.sales_id,
      created_at: iso(-45 + i * 5),
      updated_at: iso(-8 + i),
    };
  });
  db.activity_photos = [];
  db.erp_legal_entities = [];
  db.erp_external_ids = [];
  db.erp_sync_cursors = [];
  db.erp_sync_runs = [];
  db.erp_sync_errors = [];
  for (const table of [
    "erp_sales_orders",
    "erp_sales_order_lines",
    "erp_deliveries",
    "erp_invoices",
    "erp_inventory_availability",
    "erp_price_list_entries",
  ]) {
    db[table] = [];
  }

  for (const company of db.companies) {
    company.nb_contacts = db.contacts.filter(
      (c) => c.company_id === company.id,
    ).length;
    company.nb_deals = db.deals.filter(
      (d) => d.company_id === company.id,
    ).length;
  }
  return db as DdcDemoDb;
};
