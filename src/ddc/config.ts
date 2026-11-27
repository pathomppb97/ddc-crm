import type { CRMProps } from "@/components/atomic-crm/root/CRM";

// Neutral, replaceable mark. No official DDC logo is available in this workspace:
// replace these data URIs with the approved brand assets when they are provided.
const mark = (fill: string, text: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32" viewBox="0 0 96 32"><rect width="96" height="32" rx="6" fill="${fill}"/><text x="48" y="21" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="${text}" text-anchor="middle">DDC CRM</text></svg>`,
  )}`;

/** DDC CRM defaults. Labels of the Atomic CRM settings stay editable in Settings. */
export const ddcConfiguration: Partial<CRMProps> = {
  title: "DDC CRM",
  // Atomic CRM otherwise sends the deployment host name to marmelab's telemetry server
  disableTelemetry: true,
  currency: "THB",
  lightModeLogo: mark("#0f172a", "#ffffff"),
  darkModeLogo: mark("#f8fafc", "#0f172a"),
  // Fallback stages for opportunities without a pipeline. Pipelines are configured in Administration.
  dealStages: [
    { value: "opportunity", label: "โอกาสใหม่ / New opportunity" },
    { value: "requirement", label: "รวบรวมความต้องการ / Requirement" },
    { value: "proposal-sent", label: "เสนอราคาแล้ว / Quotation sent" },
    { value: "in-negociation", label: "เจรจาต่อรอง / Negotiation" },
    { value: "won", label: "ได้งาน / Won" },
    { value: "lost", label: "ไม่ได้งาน / Lost" },
  ],
  dealPipelineStatuses: ["won"],
  dealCategories: [{ value: "other", label: "อื่น ๆ / Other" }],
  companySectors: [
    { value: "agriculture", label: "เกษตรกรรม / Agriculture" },
    { value: "manufacturing", label: "การผลิต / Manufacturing" },
  ],
};
