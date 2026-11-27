import {
  useCanAccess,
  useCreatePath,
  useGetList,
  useTranslate,
  type Identifier,
} from "ra-core";
import { Link } from "react-router";
import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getResourceDef } from "../resources/registry";
import { FieldValue } from "./FieldValue";
import { SectionCard } from "./GenericResource";
import { useLabel } from "./labels";
import { RecordContextProvider } from "ra-core";

/**
 * Document references (drawings, specifications, 8D / NCR / CAPA...) attached
 * to a record. The CRM keeps the reference and link; the controlled document
 * stays in the owning system (PLM, QMS, document control).
 */
export const DocumentsSection = ({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: Identifier;
}) => {
  const translate = useTranslate();
  const label = useLabel();
  const createPath = useCreatePath();
  const def = getResourceDef("document_references")!;
  const { canAccess } = useCanAccess({
    resource: "document_references",
    action: "create",
  });
  const { data = [], isPending } = useGetList("document_references", {
    filter: { entity_type: entityType, entity_id: entityId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 100 },
  });
  const typeField = def.fields.find((f) => f.source === "document_type_id")!;
  const to = `${createPath({ resource: "document_references", type: "create" })}?source=${encodeURIComponent(
    JSON.stringify({ entity_type: entityType, entity_id: entityId }),
  )}`;

  return (
    <SectionCard
      title={label(def.label.many)}
      action={
        canAccess ? (
          <Button variant="outline" size="sm" render={<Link to={to} />}>
            <Plus className="size-4" />
            {translate("ra.action.add")}
          </Button>
        ) : null
      }
    >
      {isPending ? null : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("ddc.common.no_documents")}
        </p>
      ) : (
        <ul className="divide-y">
          {data.map((doc) => (
            <RecordContextProvider key={doc.id} value={doc}>
              <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                <Link
                  to={`/document_references/${doc.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {doc.title}
                </Link>
                <span className="text-muted-foreground">
                  <FieldValue field={typeField} />
                </span>
                {doc.reference_no ? <span>{doc.reference_no}</span> : null}
                {doc.revision ? <span>Rev. {doc.revision}</span> : null}
                {doc.external_url ? (
                  <a
                    href={doc.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    <ExternalLink className="size-3" />
                    {translate("ddc.common.open_document")}
                  </a>
                ) : null}
              </li>
            </RecordContextProvider>
          ))}
        </ul>
      )}
    </SectionCard>
  );
};
