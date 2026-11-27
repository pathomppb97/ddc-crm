import { describe, expect, it } from "vitest";
import {
  canAccessResource,
  RESOURCE_PERMISSION_MAP,
  type PermissionSubject,
} from "./permissions";
import { defaultPermissionsFor } from "./defaultPermissions";
import { findDuplicateCandidates, normalizeCompanyName } from "./duplicates";
import { validateImportRows } from "./importValidation";
import {
  allowedManualTransitions,
  assertCanDecide,
  lineTotal,
  quotationTotal,
  requiredApprovals,
  statusAfterDecision,
} from "./quotationWorkflow";
import { computeKpis, type KpiDataset } from "./kpis";

const subject = (roleKey: string, salesId = 7): PermissionSubject => ({
  salesId,
  administrator: false,
  permissions: defaultPermissionsFor(roleKey),
});

describe("permissions", () => {
  it("lets a sales representative edit only the customers they own", () => {
    const rep = subject("sales_rep");

    expect(
      canAccessResource(rep, { resource: "companies", action: "list" }),
    ).toBe(true);
    expect(
      canAccessResource(rep, {
        resource: "companies",
        action: "edit",
        record: { sales_id: 7 },
      }),
    ).toBe(true);
    expect(
      canAccessResource(rep, {
        resource: "companies",
        action: "edit",
        record: { sales_id: 8 },
      }),
    ).toBe(false);
    expect(
      canAccessResource(rep, {
        resource: "companies",
        action: "delete",
        record: { sales_id: 7 },
      }),
    ).toBe(false);
  });

  it("hides administration from everyone but administrators", () => {
    const manager = subject("sales_manager");

    expect(
      canAccessResource(manager, { resource: "sales", action: "list" }),
    ).toBe(false);
    expect(
      canAccessResource(manager, {
        resource: "role_permissions",
        action: "edit",
      }),
    ).toBe(false);
    expect(
      canAccessResource(
        { ...manager, administrator: true },
        { resource: "sales", action: "list" },
      ),
    ).toBe(true);
  });

  it("gives the read-only role no write action at all", () => {
    const reader = subject("read_only");
    const writes = ["create", "edit", "delete"].flatMap((action) =>
      ["companies", "leads", "deals", "quotations", "products"].map(
        (resource) => canAccessResource(reader, { resource, action }),
      ),
    );

    expect(writes.every((allowed) => !allowed)).toBe(true);
    expect(
      canAccessResource(reader, { resource: "quotations", action: "show" }),
    ).toBe(true);
  });

  it("shows ERP integration only to roles holding the permission", () => {
    expect(
      canAccessResource(subject("sales_rep"), {
        resource: "erp_integration",
        action: "list",
      }),
    ).toBe(false);
    expect(
      canAccessResource(subject("finance"), {
        resource: "erp_integration",
        action: "list",
      }),
    ).toBe(true);
    expect(
      canAccessResource(subject("finance"), {
        resource: "erp_integration",
        action: "edit",
      }),
    ).toBe(false);
  });

  it("denies everything to a user without a role", () => {
    expect(
      canAccessResource(subject("unknown"), {
        resource: "companies",
        action: "list",
      }),
    ).toBe(false);
  });

  it("maps agricultural machine resources to machine_applications and excludes Automotive resources", () => {
    expect(RESOURCE_PERMISSION_MAP.machine_models).toBe("machine_applications");
    expect(RESOURCE_PERMISSION_MAP.product_machine_applications).toBe(
      "machine_applications",
    );
    expect(RESOURCE_PERMISSION_MAP.vehicle_models).toBeUndefined();
    expect(RESOURCE_PERMISSION_MAP.product_vehicle_fitments).toBeUndefined();
    expect(RESOURCE_PERMISSION_MAP.divisions).toBeUndefined();
  });
});

describe("quotation workflow", () => {
  it("computes line and quotation totals like the database", () => {
    expect(
      lineTotal({ quantity: 4, unit_price: 25, discount_percent: 50 }),
    ).toBe(50);
    expect(
      quotationTotal([
        { quantity: 10, unit_price: 100 },
        { quantity: 3, unit_price: 0.3333 },
      ]),
    ).toBe(1000.9999);
  });

  it("routes to matching rules in order and falls back to one generic approval", () => {
    const rules = [
      {
        id: 2,
        min_amount: 0,
        max_amount: 9999,
        approver_role_key: "sales_manager",
        is_active: true,
        sort_order: 2,
      },
      {
        id: 1,
        min_amount: 5000,
        approver_role_key: "finance",
        is_active: true,
        sort_order: 1,
      },
      {
        id: 3,
        min_amount: 0,
        approver_role_key: "management",
        is_active: false,
      },
      {
        id: 4,
        min_amount: 0,
        currency: "USD",
        approver_role_key: "management",
        is_active: true,
      },
    ];

    expect(
      requiredApprovals({ currency: "THB", total_amount: 6000 }, rules).map(
        (s) => s.requiredRoleKey,
      ),
    ).toEqual(["finance", "sales_manager"]);
    expect(
      requiredApprovals(
        { currency: "THB", total_amount: 20000 },
        rules.slice(0, 1),
      ),
    ).toEqual([{ ruleId: null, requiredRoleKey: null }]);
  });

  it("enforces role, permission and segregation of duties", () => {
    const approval = { required_role_key: "finance", status: "pending" };
    const quotation = { status: "pending_approval" as const, submitted_by: 1 };
    const finance = {
      salesId: 2,
      administrator: false,
      roleKey: "finance",
      canApprove: true,
    };

    expect(() =>
      assertCanDecide(finance, approval, quotation, {
        allowSelfApproval: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertCanDecide(
        { ...finance, roleKey: "sales_manager" },
        approval,
        quotation,
        { allowSelfApproval: false },
      ),
    ).toThrow("requires the role finance");
    expect(() =>
      assertCanDecide({ ...finance, salesId: 1 }, approval, quotation, {
        allowSelfApproval: false,
      }),
    ).toThrow("cannot approve their own");
    expect(() =>
      assertCanDecide({ ...finance, canApprove: false }, approval, quotation, {
        allowSelfApproval: false,
      }),
    ).toThrow("Not allowed");
  });

  it("only offers transitions the database accepts", () => {
    expect(allowedManualTransitions("approved")).toEqual(["sent", "cancelled"]);
    expect(allowedManualTransitions("pending_approval")).toEqual([]);
    expect(statusAfterDecision("approved", 1)).toBe("pending_approval");
    expect(statusAfterDecision("rejected", 3)).toBe("rejected");
  });
});

describe("duplicate detection", () => {
  const existing = [
    {
      id: 1,
      name: "Synthetic Parts Co., Ltd.",
      tax_identifier: "0105500000001",
      website: "https://www.synparts.example",
    },
    { id: 2, name: "บริษัท ซินเธติก จำกัด", phone_number: "+66 2 123 4567" },
    { id: 3, name: "Completely Different Trading" },
  ];

  it("ignores legal forms when normalizing names", () => {
    expect(normalizeCompanyName("Synthetic Parts Co., Ltd.")).toBe(
      "synthetic parts",
    );
    expect(normalizeCompanyName("บริษัท ซินเธติก จำกัด")).toBe(
      "ซินเธติก".normalize("NFKC"),
    );
  });

  it("flags the same tax id, similar names, shared domains and phone numbers", () => {
    expect(
      findDuplicateCandidates(
        { tax_identifier: "0-1055-00000-00-1" },
        existing,
      )[0],
    ).toMatchObject({
      record: { id: 1 },
      score: 1,
    });
    expect(
      findDuplicateCandidates({ name: "SYNTHETIC PARTS LIMITED" }, existing)[0]
        .record.id,
    ).toBe(1);
    expect(
      findDuplicateCandidates({ email: "buyer@synparts.example" }, existing)[0]
        .reasons,
    ).toContain("domain");
    expect(
      findDuplicateCandidates({ phone_number: "021234567" }, existing)[0].record
        .id,
    ).toBe(2);
  });

  it("does not flag unrelated companies, free mail domains or the record itself", () => {
    expect(
      findDuplicateCandidates(
        { name: "Another Business", email: "x@gmail.com" },
        existing,
      ),
    ).toEqual([]);
    expect(
      findDuplicateCandidates(
        { id: 1, name: "Synthetic Parts Co., Ltd." },
        existing,
      ),
    ).toEqual([]);
  });
});

describe("import validation", () => {
  it("keeps valid rows and reports each invalid cell with its spreadsheet row", () => {
    const result = validateImportRows("leads", [
      {
        "Company Name": "Synthetic A",
        email: "a@example.test",
        estimated_value: "1,500",
      },
      { company_name: "", email: "not-an-email" },
      {
        company_name: "Synthetic C",
        follow_up_date: "2026-13-45",
        currency: "BAHT",
      },
      { company_name: "Synthetic D", colour: "red" },
    ]);

    expect(result.valid.map((r) => r.row)).toEqual([2, 5]);
    expect(result.valid[0].data.estimated_value).toBe(1500);
    expect(result.issues).toEqual(
      [
        { row: 3, column: "company_name", message: "required" },
        { row: 3, column: "email", message: "invalid_email" },
        { row: 4, column: "currency", message: "invalid_currency" },
        { row: 4, column: "follow_up_date", message: "invalid_date" },
      ].sort((a, b) => a.row - b.row || 0),
    );
    expect(result.unknownColumns).toEqual(["colour"]);
  });

  it("rejects values already present in the database or earlier in the file", () => {
    const result = validateImportRows(
      "products",
      [
        { part_number: "SYN-1", name: "A" },
        { part_number: "syn-1", name: "B" },
        { part_number: "SYN-2", name: "C" },
      ],
      { uniqueColumn: "part_number", existingValues: ["SYN-2"] },
    );

    expect(result.valid.map((r) => r.row)).toEqual([2]);
    expect(result.issues.map((i) => [i.row, i.message])).toEqual([
      [3, "duplicate_value"],
      [4, "duplicate_value"],
    ]);
  });
});

describe("dashboard KPIs", () => {
  const base: KpiDataset = {
    companies: [
      {
        id: 1,
        sales_id: 1,
        lifecycle_status_id: 10,
        country: "TH",
        created_at: "2026-03-01",
      },
      {
        id: 2,
        sales_id: 2,
        lifecycle_status_id: 11,
        country: "VN",
        created_at: "2025-01-01",
      },
    ],
    companyBusinessModels: [{ company_id: 1, business_model_id: 100 }],
    leads: [
      {
        id: 1,
        created_at: "2026-03-05",
        status: "new",
        follow_up_date: "2026-03-01",
      },
      { id: 2, created_at: "2025-12-01", status: "converted" },
    ],
    deals: [
      {
        id: 1,
        company_id: 1,
        created_at: "2026-03-01",
        stage: "requirement",
        pipeline_id: 1,
        amount: 1000,
        currency: "THB",
      },
      {
        id: 2,
        company_id: 2,
        created_at: "2026-03-01",
        stage: "requirement",
        pipeline_id: 1,
        amount: 500,
        currency: "USD",
      },
      {
        id: 3,
        company_id: 1,
        created_at: "2026-03-01",
        stage: "requirement",
        pipeline_id: 1,
        amount: null,
      },
      {
        id: 4,
        company_id: 1,
        created_at: "2026-02-01",
        stage: "won",
        pipeline_id: 1,
        amount: 9,
        closed_at: "2026-03-10",
      },
      {
        id: 5,
        company_id: 2,
        created_at: "2026-02-01",
        stage: "lost",
        pipeline_id: 1,
        closed_at: "2026-03-11",
      },
    ],
    pipelineStages: [
      {
        pipeline_id: 1,
        code: "requirement",
        stage_type: "open",
        probability: 30,
      },
      { pipeline_id: 1, code: "won", stage_type: "won", probability: 100 },
      { pipeline_id: 1, code: "lost", stage_type: "lost", probability: 0 },
    ],
    quotations: [
      {
        id: 1,
        company_id: 1,
        status: "accepted",
        currency: "THB",
        total_amount: 800,
        created_at: "2026-03-02",
        sent_at: "2026-03-03",
      },
      {
        id: 2,
        company_id: 1,
        status: "declined",
        currency: "THB",
        total_amount: 200,
        created_at: "2026-03-02",
        sent_at: "2026-03-03",
      },
      {
        id: 3,
        company_id: 1,
        status: "superseded",
        currency: "THB",
        total_amount: 999,
        created_at: "2026-03-01",
      },
      {
        id: 4,
        company_id: 1,
        status: "draft",
        currency: "THB",
        total_amount: 50,
        created_at: "2026-03-01",
      },
    ],
    activities: [
      {
        id: 1,
        company_id: 1,
        start_at: "2026-03-04T09:00:00Z",
        status: "completed",
        activity_type_code: "onsite_visit",
      },
      {
        id: 2,
        company_id: 1,
        start_at: "2026-03-04T09:00:00Z",
        status: "completed",
        activity_type_code: "phone_call",
      },
      {
        id: 3,
        company_id: 1,
        start_at: "2026-03-04T09:00:00Z",
        status: "planned",
        activity_type_code: "onsite_visit",
      },
    ],
    actionItems: [
      { id: 1, company_id: 1, due_date: "2026-03-01", status: "open" },
    ],
    productInterests: [{ company_id: 1, product_family_id: 50 }],
    dealProducts: [{ deal_id: 1, product_family_id: 50 }],
    salesOrders: null,
    invoices: null,
    lifecycleCodes: { "10": "active", "11": "prospect" },
  };
  const march = { from: "2026-03-01", to: "2026-03-31" };

  it("keeps estimated, quoted and ERP values apart and grouped by currency", () => {
    const kpis = computeKpis(base, march, "2026-03-20");

    expect(kpis.estimatedPipeline).toEqual({ THB: 1000, USD: 500 });
    expect(kpis.weightedPipeline).toEqual({ THB: 300, USD: 150 });
    expect(kpis.opportunitiesWithoutAmount).toBe(1);
    expect(kpis.quotedValue).toEqual({ THB: 1000 });
    expect(kpis.confirmedOrders).toBeNull();
    expect(kpis.invoicedRevenue).toBeNull();
    expect(kpis.customerRetentionRate).toBeNull();
  });

  it("computes counts and rates for the period", () => {
    const kpis = computeKpis(base, march, "2026-03-20");

    expect(kpis).toMatchObject({
      customers: 2,
      activeCustomers: 1,
      newCustomers: 1,
      newLeads: 1,
      openOpportunities: 3,
      quotationsSent: 2,
      quotationConversionRate: 50,
      winRate: 50,
      customerVisits: 1,
      completedActivities: 2,
      overdueFollowUps: 2,
    });
    expect(kpis.productInterest).toEqual([{ productFamilyId: "50", count: 2 }]);
    expect(kpis.trend).toEqual([
      { month: "2026-03", leads: 1, opportunities: 3, won: 1 },
    ]);
  });

  it("applies customer level filters to every metric", () => {
    const kpis = computeKpis(
      base,
      { ...march, businessModelId: 100 },
      "2026-03-20",
    );

    expect(kpis.customers).toBe(1);
    expect(kpis.estimatedPipeline).toEqual({ THB: 1000 });
    expect(kpis.winRate).toBe(100);
  });

  it("uses ERP orders and invoices only when they exist", () => {
    const kpis = computeKpis(
      {
        ...base,
        salesOrders: [
          {
            company_id: 1,
            order_date: "2026-02-10",
            currency: "THB",
            total_amount: 100,
          },
          {
            company_id: 1,
            order_date: "2026-03-10",
            currency: "THB",
            total_amount: 300,
          },
          {
            company_id: 2,
            order_date: "2026-02-12",
            currency: "USD",
            total_amount: 50,
          },
        ],
        invoices: [
          {
            company_id: 1,
            invoice_date: "2026-03-15",
            currency: "THB",
            invoice_amount: 300,
            paid_amount: 100,
          },
        ],
      },
      march,
      "2026-03-20",
    );

    expect(kpis.confirmedOrders).toEqual({ THB: 300 });
    expect(kpis.invoicedRevenue).toEqual({ THB: 300 });
    expect(kpis.collectedRevenue).toEqual({ THB: 100 });
    expect(kpis.customerRetentionRate).toBe(50);
  });
});
