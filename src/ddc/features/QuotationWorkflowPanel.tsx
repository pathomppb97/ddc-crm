import { useState } from "react";
import {
  useCanAccess,
  useGetIdentity,
  useGetList,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useTranslate,
  type RaRecord,
} from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CopyPlus, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  allowedManualTransitions,
  isEditable,
  REVISABLE_STATUSES,
  type QuotationStatus,
} from "../domain/quotationWorkflow";
import { hasPermission } from "../domain/permissions";
import { QUOTATION_STATUS_CHOICES } from "../resources/salesResources";
import { useLabel } from "../ui/labels";
import { errorMessage, useDdcDataProvider } from "./useDdcDataProvider";

export const isQuotationLocked = (record: RaRecord) =>
  !isEditable(record.status as QuotationStatus);

/** Submission, approval, customer status and revision of a quotation. */
export const QuotationWorkflowPanel = () => {
  const record = useRecordContext();
  const dataProvider = useDdcDataProvider();
  const translate = useTranslate();
  const label = useLabel();
  const notify = useNotify();
  const refresh = useRefresh();
  const redirect = useRedirect();
  const { identity } = useGetIdentity();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const { canAccess: canEdit } = useCanAccess({
    resource: "quotations",
    action: "edit",
    record,
  });
  const { data: access } = useQuery({
    queryKey: ["ddc", "access"],
    queryFn: () => dataProvider.getMyAccess(),
  });
  const { data: pending = [] } = useGetList(
    "quotation_approvals",
    {
      filter: { quotation_id: record?.id, status: "pending" },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: record?.status === "pending_approval" },
  );
  if (!record) return null;

  const status = record.status as QuotationStatus;
  const canApprove = access
    ? hasPermission(access, "quotations", "approve")
    : false;
  const isSubmitter = String(record.submitted_by) === String(identity?.id);
  const myApproval = pending.find(
    (a) =>
      access?.administrator ||
      a.required_role_key == null ||
      a.required_role_key === access?.roleKey,
  );

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      notify(success, { type: "success" });
      setComment("");
      refresh();
    } catch (error) {
      notify(errorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (value: string) =>
    label(QUOTATION_STATUS_CHOICES.find((c) => c.id === value)?.label);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="text-sm">
          <span className="text-muted-foreground">
            {translate("ddc.quotation.workflow")}:{" "}
          </span>
          <span className="font-medium">{statusLabel(status)}</span>
          {!isEditable(status) ? (
            <span className="text-muted-foreground">
              {" "}
              · {translate("ddc.quotation.locked_hint")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && isEditable(status) ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  () => dataProvider.submitQuotation(record.id),
                  "ddc.quotation.submitted",
                )
              }
            >
              <Send className="size-4" />
              {translate("ddc.quotation.submit")}
            </Button>
          ) : null}
          {canEdit
            ? allowedManualTransitions(status).map((next) => (
                <Button
                  key={next}
                  variant={
                    next === "cancelled" || next === "declined"
                      ? "outline"
                      : "secondary"
                  }
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => dataProvider.setQuotationStatus(record.id, next),
                      "ddc.quotation.status_changed",
                    )
                  }
                >
                  {translate("ddc.quotation.mark_as", {
                    status: statusLabel(next),
                  })}
                </Button>
              ))
            : null}
          {canEdit && REVISABLE_STATUSES.includes(status) ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const revision = await dataProvider.createQuotationRevision(
                    record.id,
                  );
                  notify("ddc.quotation.revised", { type: "success" });
                  redirect(`/quotations/${revision.id}/show`);
                } catch (error) {
                  notify(errorMessage(error), { type: "error" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <CopyPlus className="size-4" />
              {translate("ddc.quotation.revise")}
            </Button>
          ) : null}
        </div>
        {status === "pending_approval" && canApprove && myApproval ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              {translate("ddc.quotation.your_decision")}
            </p>
            {isSubmitter ? (
              <p className="text-sm text-muted-foreground">
                {translate("ddc.quotation.self_approval_hint")}
              </p>
            ) : null}
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={translate("ddc.quotation.comment_placeholder")}
              aria-label={translate("ddc.quotation.comment_placeholder")}
            />
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      dataProvider.decideQuotationApproval(
                        myApproval.id,
                        "approved",
                        comment || undefined,
                      ),
                    "ddc.quotation.approved",
                  )
                }
              >
                <CheckCircle2 className="size-4" />
                {translate("ddc.quotation.approve")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !comment.trim()}
                onClick={() =>
                  run(
                    () =>
                      dataProvider.decideQuotationApproval(
                        myApproval.id,
                        "rejected",
                        comment,
                      ),
                    "ddc.quotation.rejected",
                  )
                }
              >
                <XCircle className="size-4" />
                {translate("ddc.quotation.reject")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
