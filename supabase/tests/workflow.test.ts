import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectRejected, type TestDb } from "./helpers/testDb";

type User = Awaited<ReturnType<TestDb["createUser"]>>;

let t: TestDb;
let admin: User;
let manager: User;
let rep: User;
let otherRep: User;
let finance: User;

const createDraft = async (owner: User, unitPrice: number) => {
  const { rows } = await t.asUser(owner.userId, (tx) =>
    tx.query<{ id: number }>(
      "insert into public.quotations (company_id, subject) values (1, 'Synthetic quotation') returning id",
    ),
  );
  const id = Number(rows[0].id);
  await t.asUser(owner.userId, (tx) =>
    tx.query(
      `insert into public.quotation_items (quotation_id, line_no, description, quantity, unit_price, discount_percent)
       values ($1, 1, 'Synthetic line A', 10, $2, 0), ($1, 2, 'Synthetic line B', 4, 25, 50)`,
      [id, unitPrice],
    ),
  );
  return id;
};

const quotation = async (id: number) => {
  const { rows } = await t.db.query<Record<string, any>>(
    "select * from public.quotations where id = $1",
    [id],
  );
  return rows[0];
};

const pendingApprovals = async (id: number) => {
  const { rows } = await t.db.query<{
    id: number;
    required_role_key: string | null;
  }>(
    "select id, required_role_key from public.quotation_approvals where quotation_id = $1 and status = 'pending' order by id",
    [id],
  );
  return rows;
};

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.createUser("system_admin", "Admin");
  manager = await t.createUser("sales_manager", "Manager");
  rep = await t.createUser("sales_rep", "Rep");
  otherRep = await t.createUser("sales_rep", "OtherRep");
  finance = await t.createUser("finance", "Finance");
  await t.db.query(
    "insert into public.companies (id, name, sales_id) values (1, 'Synthetic Customer', $1)",
    [rep.salesId],
  );
  await t.db.exec(
    "alter table public.companies alter column id restart with 1000",
  );
  // Synthetic rule set for the tests: finance must approve quotations from 10,000 upwards
  await t.db.exec(
    "insert into public.approval_rules (name, min_amount, approver_role_key) values ('Synthetic high value', 10000, 'finance')",
  );
});

describe("quotation workflow", () => {
  it("numbers the quotation and computes the total from its lines", async () => {
    const id = await createDraft(rep, 100);

    const q = await quotation(id);

    expect(q.quotation_no).toMatch(/^QT-\d{4}-\d{5}$/);
    expect(q.revision).toBe(0);
    expect(Number(q.total_amount)).toBe(10 * 100 + 4 * 25 * 0.5);
  });

  it("does not let a user set the status directly", async () => {
    const id = await createDraft(rep, 100);

    const message = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query(
          "update public.quotations set status = 'approved' where id = $1",
          [id],
        ),
      ),
    );

    expect(message).toContain("approval workflow");
  });

  it("does not let a user create a quotation that is already approved", async () => {
    const message = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query(
          "insert into public.quotations (company_id, subject, status) values (1, 'Forged', 'approved')",
        ),
      ),
    );

    expect(message).toContain("must be created as a draft");
  });

  it("refuses to submit a quotation without lines", async () => {
    const { rows } = await t.asUser(rep.userId, (tx) =>
      tx.query<{ id: number }>(
        "insert into public.quotations (company_id, subject) values (1, 'Empty') returning id",
      ),
    );

    const message = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query("select public.submit_quotation($1)", [rows[0].id]),
      ),
    );

    expect(message).toContain("at least one line");
  });

  it("does not let another sales representative submit someone else's quotation", async () => {
    const id = await createDraft(rep, 100);

    const message = await expectRejected(
      t.asUser(otherRep.userId, (tx) =>
        tx.query("select public.submit_quotation($1)", [id]),
      ),
    );

    expect(message).toContain("Not allowed to submit");
  });

  it("asks for one generic approval when no rule matches, then locks the quotation", async () => {
    const id = await createDraft(rep, 100);

    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const approvals = await pendingApprovals(id);
    const edit = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query(
          "update public.quotations set subject = 'Changed' where id = $1",
          [id],
        ),
      ),
    );
    const editLine = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query(
          "update public.quotation_items set unit_price = 1 where quotation_id = $1",
          [id],
        ),
      ),
    );

    expect((await quotation(id)).status).toBe("pending_approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].required_role_key).toBeNull();
    expect(edit).toContain("locked");
    expect(editLine).toContain("locked");
  });

  it("does not let a sales representative approve", async () => {
    const id = await createDraft(rep, 100);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);

    const message = await expectRejected(
      t.asUser(otherRep.userId, (tx) =>
        tx.query("select public.decide_quotation_approval($1, 'approved')", [
          approval.id,
        ]),
      ),
    );

    expect(message).toContain("Not allowed to approve");
  });

  it("does not let the submitter approve their own quotation", async () => {
    const id = await createDraft(manager, 100);
    await t.asUser(manager.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);

    const message = await expectRejected(
      t.asUser(manager.userId, (tx) =>
        tx.query("select public.decide_quotation_approval($1, 'approved')", [
          approval.id,
        ]),
      ),
    );

    expect(message).toContain("cannot approve their own");
  });

  it("routes a high value quotation to the role named by the approval rule", async () => {
    const id = await createDraft(rep, 5000);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);

    const wrongRole = await expectRejected(
      t.asUser(manager.userId, (tx) =>
        tx.query("select public.decide_quotation_approval($1, 'approved')", [
          approval.id,
        ]),
      ),
    );
    await t.asUser(finance.userId, (tx) =>
      tx.query(
        "select public.decide_quotation_approval($1, 'approved', 'ok')",
        [approval.id],
      ),
    );
    const q = await quotation(id);

    expect(approval.required_role_key).toBe("finance");
    expect(wrongRole).toContain("requires the role finance");
    expect(q.status).toBe("approved");
    expect(q.approved_at).not.toBeNull();
  });

  it("notifies the approvers, then the owner once the decision is made", async () => {
    const id = await createDraft(rep, 5000);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);
    await t.asUser(finance.userId, (tx) =>
      tx.query("select public.decide_quotation_approval($1, 'approved')", [
        approval.id,
      ]),
    );

    const { rows } = await t.db.query<{
      recipient_sales_id: number;
      kind: string;
    }>(
      "select recipient_sales_id, kind from public.notifications where entity_type = 'quotations' and entity_id = $1 order by id",
      [id],
    );
    const ownInbox = await t.asUser(rep.userId, (tx) =>
      tx.query<{ kind: string }>(
        "select kind from public.notifications where entity_id = $1",
        [id],
      ),
    );

    expect(rows.map((r) => r.kind)).toEqual([
      "quotation.approval_requested",
      "quotation.approved",
    ]);
    expect(rows.map((r) => Number(r.recipient_sales_id))).toEqual([
      finance.salesId,
      rep.salesId,
    ]);
    expect(ownInbox.rows).toEqual([{ kind: "quotation.approved" }]);
  });

  it("requires a comment to reject and reopens the quotation for editing", async () => {
    const id = await createDraft(rep, 100);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);

    const noComment = await expectRejected(
      t.asUser(manager.userId, (tx) =>
        tx.query("select public.decide_quotation_approval($1, 'rejected')", [
          approval.id,
        ]),
      ),
    );
    await t.asUser(manager.userId, (tx) =>
      tx.query(
        "select public.decide_quotation_approval($1, 'rejected', 'Margin too low')",
        [approval.id],
      ),
    );
    const edited = await t.asUser(rep.userId, (tx) =>
      tx.query(
        "update public.quotations set subject = 'Reworked' where id = $1 returning id",
        [id],
      ),
    );

    expect(noComment).toContain("comment is required");
    expect((await quotation(id)).status).toBe("rejected");
    expect(edited.rows).toHaveLength(1);
  });

  it("follows approved > sent > accepted and refuses to skip a step", async () => {
    const id = await createDraft(rep, 100);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);

    const skip = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query("select public.set_quotation_status($1, 'sent')", [id]),
      ),
    );
    await t.asUser(manager.userId, (tx) =>
      tx.query("select public.decide_quotation_approval($1, 'approved')", [
        approval.id,
      ]),
    );
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.set_quotation_status($1, 'sent')", [id]),
    );
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.set_quotation_status($1, 'accepted')", [id]),
    );
    const q = await quotation(id);

    expect(skip).toContain("is not allowed");
    expect(q.status).toBe("accepted");
    expect(q.sent_at).not.toBeNull();
  });

  it("creates a new revision with copied lines and supersedes the previous one", async () => {
    const id = await createDraft(rep, 100);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);
    await t.asUser(manager.userId, (tx) =>
      tx.query("select public.decide_quotation_approval($1, 'approved')", [
        approval.id,
      ]),
    );

    const { rows } = await t.asUser(rep.userId, (tx) =>
      tx.query<{ id: number }>(
        "select (public.create_quotation_revision($1)).id",
        [id],
      ),
    );
    const previous = await quotation(id);
    const next = await quotation(Number(rows[0].id));
    const again = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query("select public.create_quotation_revision($1)", [id]),
      ),
    );

    expect(previous.status).toBe("superseded");
    expect(next.status).toBe("draft");
    expect(next.revision).toBe(1);
    expect(next.quotation_no).toBe(previous.quotation_no);
    expect(Number(next.previous_revision_id)).toBe(id);
    expect(Number(next.total_amount)).toBe(Number(previous.total_amount));
    expect(again).toContain("cannot be revised");
  });

  it("lets an administrator decide any approval", async () => {
    const id = await createDraft(rep, 5000);
    await t.asUser(rep.userId, (tx) =>
      tx.query("select public.submit_quotation($1)", [id]),
    );
    const [approval] = await pendingApprovals(id);

    await t.asUser(admin.userId, (tx) =>
      tx.query("select public.decide_quotation_approval($1, 'approved')", [
        approval.id,
      ]),
    );

    expect((await quotation(id)).status).toBe("approved");
  });
});

describe("lead conversion", () => {
  it("creates the customer, contact and opportunity in one transaction", async () => {
    const { rows: lead } = await t.asUser(rep.userId, (tx) =>
      tx.query<{ id: number }>(
        `insert into public.leads (company_name, contact_name, email, phone, product_interest, estimated_value, currency, business_model_id)
         select 'Synthetic Prospect Ltd', 'Somchai Synthetic Example', 'somchai@example.test', '+66 2 000 0000', 'Synthetic interest', 150000, 'THB', bm.id
         from public.business_models bm where bm.code = 'OEM' returning id`,
      ),
    );

    const { rows } = await t.asUser(rep.userId, (tx) =>
      tx.query<{ result: Record<string, number> }>(
        "select public.convert_lead($1) as result",
        [lead[0].id],
      ),
    );
    const result = rows[0].result;
    const company = await t.db.query<Record<string, any>>(
      "select * from public.companies where id = $1",
      [result.company_id],
    );
    const contact = await t.db.query<Record<string, any>>(
      "select * from public.contacts where id = $1",
      [result.contact_id],
    );
    const deal = await t.db.query<Record<string, any>>(
      "select d.*, p.code as pipeline_code from public.deals d join public.pipelines p on p.id = d.pipeline_id where d.id = $1",
      [result.deal_id],
    );
    const models = await t.db.query(
      "select 1 from public.company_business_models where company_id = $1",
      [result.company_id],
    );
    const converted = await t.db.query<Record<string, any>>(
      "select * from public.leads where id = $1",
      [lead[0].id],
    );

    expect(company.rows[0].name).toBe("Synthetic Prospect Ltd");
    expect(Number(company.rows[0].sales_id)).toBe(rep.salesId);
    expect(contact.rows[0].first_name).toBe("Somchai");
    expect(contact.rows[0].last_name).toBe("Synthetic Example");
    expect(contact.rows[0].email_jsonb).toEqual([
      { email: "somchai@example.test", type: "Work" },
    ]);
    expect(deal.rows[0].stage).toBe("opportunity");
    expect(deal.rows[0].pipeline_code).toBe("STANDARD");
    expect(Number(deal.rows[0].amount)).toBe(150000);
    expect(Number(deal.rows[0].lead_id)).toBe(Number(lead[0].id));
    expect(models.rows).toHaveLength(1);
    expect(converted.rows[0].status).toBe("converted");
    expect(converted.rows[0].converted_at).not.toBeNull();
  });

  it("refuses to convert the same lead twice", async () => {
    const { rows } = await t.db.query<{ id: number }>(
      "select id from public.leads where status = 'converted' limit 1",
    );

    const message = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query("select public.convert_lead($1)", [rows[0].id]),
      ),
    );

    expect(message).toContain("already converted");
  });

  it("rolls everything back when the conversion fails", async () => {
    await t.db.exec(
      "update public.pipeline_stages set stage_type = 'won' where stage_type = 'open'",
    );
    const { rows: lead } = await t.asUser(rep.userId, (tx) =>
      tx.query<{ id: number }>(
        "insert into public.leads (company_name) values ('Synthetic Rollback Co') returning id",
      ),
    );

    const message = await expectRejected(
      t.asUser(rep.userId, (tx) =>
        tx.query("select public.convert_lead($1)", [lead[0].id]),
      ),
    );
    const leftovers = await t.db.query(
      "select 1 from public.companies where name = 'Synthetic Rollback Co'",
    );

    expect(message).toContain("No active pipeline");
    expect(leftovers.rows).toHaveLength(0);
  });

  it("does not let a sales representative convert a lead owned by someone else", async () => {
    const { rows: lead } = await t.asUser(rep.userId, (tx) =>
      tx.query<{ id: number }>(
        "insert into public.leads (company_name) values ('Synthetic Owned Lead') returning id",
      ),
    );

    const message = await expectRejected(
      t.asUser(otherRep.userId, (tx) =>
        tx.query("select public.convert_lead($1)", [lead[0].id]),
      ),
    );

    // The lead row is not lockable by a user who may not update it: it is reported as not found
    expect(message).toMatch(/not found|Not allowed to convert/);
  });
});
