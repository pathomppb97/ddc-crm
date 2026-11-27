/**
 * Quotation state machine. Mirrors the database workflow functions
 * (submit_quotation, decide_quotation_approval, set_quotation_status,
 * create_quotation_revision) so that the evaluation mode behaves the same.
 * In production the database functions are authoritative.
 */

export type QuotationStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "superseded"
  | "cancelled";

export const QUOTATION_STATUSES: QuotationStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
  "cancelled",
];

export const EDITABLE_STATUSES: QuotationStatus[] = ["draft", "rejected"];
export const REVISABLE_STATUSES: QuotationStatus[] = [
  "approved",
  "sent",
  "rejected",
  "declined",
  "expired",
];

const MANUAL_TRANSITIONS: Partial<Record<QuotationStatus, QuotationStatus[]>> =
  {
    draft: ["cancelled"],
    rejected: ["cancelled"],
    approved: ["sent", "cancelled"],
    sent: ["accepted", "declined", "expired"],
  };

export const isEditable = (status: QuotationStatus) =>
  EDITABLE_STATUSES.includes(status);

export const allowedManualTransitions = (
  status: QuotationStatus,
): QuotationStatus[] => MANUAL_TRANSITIONS[status] ?? [];

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export const assertManualTransition = (
  from: QuotationStatus,
  to: QuotationStatus,
) => {
  if (!allowedManualTransitions(from).includes(to)) {
    throw new WorkflowError(`Transition from ${from} to ${to} is not allowed`);
  }
};

export interface QuotationLine {
  quantity: number;
  unit_price: number;
  discount_percent?: number | null;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Same formula as the generated column quotation_items.line_total. */
export const lineTotal = ({
  quantity,
  unit_price,
  discount_percent,
}: QuotationLine) =>
  round4(quantity * unit_price * (1 - (discount_percent ?? 0) / 100));

export const quotationTotal = (lines: QuotationLine[]) =>
  round4(lines.reduce((sum, line) => sum + lineTotal(line), 0));

export interface ApprovalRule {
  id: number | string;
  currency?: string | null;
  min_amount: number;
  max_amount?: number | null;
  approver_role_key: string;
  is_active: boolean;
  sort_order?: number;
}

export interface QuotationForRouting {
  currency: string;
  total_amount: number;
}

/**
 * Approval steps required for a quotation. When no rule matches, one generic
 * step (requiredRoleKey null) still needs a user holding quotations/approve.
 */
export const requiredApprovals = (
  quotation: QuotationForRouting,
  rules: ApprovalRule[],
) => {
  const matching = rules
    .filter(
      (rule) =>
        rule.is_active &&
        (rule.currency == null || rule.currency === quotation.currency) &&
        quotation.total_amount >= rule.min_amount &&
        (rule.max_amount == null || quotation.total_amount <= rule.max_amount),
    )
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    );
  if (matching.length === 0) return [{ ruleId: null, requiredRoleKey: null }];
  return matching.map((rule) => ({
    ruleId: rule.id,
    requiredRoleKey: rule.approver_role_key,
  }));
};

export interface Approver {
  salesId: number | string;
  administrator: boolean;
  roleKey: string | null;
  canApprove: boolean;
}

export const assertCanDecide = (
  approver: Approver,
  approval: { required_role_key: string | null; status: string },
  quotation: { status: QuotationStatus; submitted_by: number | string | null },
  options: { allowSelfApproval: boolean },
) => {
  if (
    approval.status !== "pending" ||
    quotation.status !== "pending_approval"
  ) {
    throw new WorkflowError("This approval is no longer pending");
  }
  if (!approver.canApprove && !approver.administrator) {
    throw new WorkflowError("Not allowed to approve quotations");
  }
  if (
    approval.required_role_key &&
    !approver.administrator &&
    approver.roleKey !== approval.required_role_key
  ) {
    throw new WorkflowError(
      `This approval requires the role ${approval.required_role_key}`,
    );
  }
  if (
    !options.allowSelfApproval &&
    String(quotation.submitted_by) === String(approver.salesId)
  ) {
    throw new WorkflowError("The submitter cannot approve their own quotation");
  }
};

/** Status of the quotation once every remaining approval has been examined. */
export const statusAfterDecision = (
  decision: "approved" | "rejected",
  remainingPending: number,
): QuotationStatus => {
  if (decision === "rejected") return "rejected";
  return remainingPending === 0 ? "approved" : "pending_approval";
};
