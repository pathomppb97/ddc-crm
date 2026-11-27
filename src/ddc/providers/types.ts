import type { Identifier } from "ra-core";
import type { KpiDataset } from "../domain/kpis";
import type { Permission } from "../domain/permissions";
import type { QuotationStatus } from "../domain/quotationWorkflow";

export interface DdcAccess {
  salesId: Identifier | null;
  administrator: boolean;
  roleKey: string | null;
  permissions: Permission[];
}

export interface LeadConversionResult {
  lead_id: Identifier;
  company_id: Identifier;
  contact_id: Identifier | null;
  deal_id: Identifier | null;
}

export type ErpAction =
  | { action: "health" }
  | { action: "register_legal_entities" }
  | {
      action: "sync";
      entity: string;
      dataAreaId: string;
      mode: "incremental" | "full" | "retry";
    }
  | { action: "reconcile"; entity: string; dataAreaId: string };

export interface DdcSearchResult {
  resource: string;
  record_id: Identifier;
  title: string;
  subtitle: string | null;
}

/** Business operations added to the data provider by DDC CRM. */
export interface DdcDataMethods {
  getMyAccess(): Promise<DdcAccess>;
  convertLead(
    leadId: Identifier,
    options: {
      createOpportunity: boolean;
      existingCompanyId?: Identifier | null;
    },
  ): Promise<LeadConversionResult>;
  submitQuotation(quotationId: Identifier): Promise<unknown>;
  decideQuotationApproval(
    approvalId: Identifier,
    decision: "approved" | "rejected",
    comment?: string,
  ): Promise<unknown>;
  setQuotationStatus(
    quotationId: Identifier,
    status: QuotationStatus,
  ): Promise<unknown>;
  createQuotationRevision(quotationId: Identifier): Promise<{ id: Identifier }>;
  runErpAction(request: ErpAction): Promise<Record<string, unknown>>;
  ddcSearch(query: string, maxResults?: number): Promise<DdcSearchResult[]>;
  getDashboardData(): Promise<KpiDataset & { truncated: boolean }>;
}

/** Upper bound of rows loaded for dashboard computations. */
export const DASHBOARD_ROW_LIMIT = 10_000;
