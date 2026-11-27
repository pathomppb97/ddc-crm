import {
  useCanAccess,
  useRecordContext,
  useResourceContext,
  useTranslate,
} from "ra-core";
import { DataTable } from "@/components/admin/data-table";
import { ReferenceManyField } from "@/components/admin/reference-many-field";
import { TextField } from "@/components/admin/text-field";
import { getResourceDef } from "../resources/registry";
import type { ChildDef, ResourceDef } from "../resources/schema";
import { AuditSection } from "./AuditSection";
import { DocumentsSection } from "./DocumentsSection";
import { FieldValue } from "./FieldValue";
import { AddChildButton, SectionCard } from "./GenericResource";
import { useLabel } from "./labels";
import { Fragment, type ReactNode } from "react";
import { DesignBlock, designRows, usePageDesign } from "../pages/pageDesign";

const ChildTable = ({ child }: { child: ChildDef }) => {
  const label = useLabel();
  const translate = useTranslate();
  const childDef = getResourceDef(child.resource);
  const { canAccess, isPending } = useCanAccess({
    resource: child.resource,
    action: "list",
  });
  if (isPending || !canAccess) return null;

  const columns = childDef
    ? childDef.fields.filter(
        (f) =>
          (child.columns ? child.columns.includes(f.source) : f.list) &&
          f.source !== child.target,
      )
    : [];

  return (
    <SectionCard
      title={label(child.label)}
      action={
        childDef && !childDef.readOnly ? (
          <AddChildButton
            resource={child.resource}
            target={child.target}
            label={translate("ra.action.add")}
          />
        ) : null
      }
    >
      <ReferenceManyField
        reference={child.resource}
        target={child.target}
        sort={childDef?.sort}
        perPage={50}
        empty={
          <p className="text-sm text-muted-foreground">
            {translate("ddc.common.no_records")}
          </p>
        }
      >
        <DataTable
          rowClick={
            childDef?.childOnly ? (childDef.readOnly ? false : "edit") : "show"
          }
          bulkActionButtons={false}
        >
          {childDef
            ? columns.map((f) => (
                <DataTable.Col
                  key={f.source}
                  source={f.source}
                  label={label(f.label)}
                  render={() => <FieldValue field={f} />}
                />
              ))
            : (child.columns ?? ["id"]).map((source) => (
                <DataTable.Col key={source} source={source} field={TextField} />
              ))}
        </DataTable>
      </ReferenceManyField>
    </SectionCard>
  );
};

/** Related records, documents and change history of the record shown. */
export const ChildSections = ({
  def,
  details,
}: {
  def: ResourceDef;
  details?: ReactNode;
}) => {
  const record = useRecordContext();
  const resource = useResourceContext();
  const design = usePageDesign(def.name);
  if (!record) return null;
  const blocks = new Map<string, ReactNode>();
  if (details) blocks.set("Record details", details);
  for (const child of def.children ?? [])
    blocks.set(child.resource, <ChildTable child={child} />);
  if (def.documentEntity)
    blocks.set(
      "Documents",
      <DocumentsSection entityType={def.documentEntity} entityId={record.id} />,
    );
  blocks.set(
    "Audit history",
    <AuditSection table={resource ?? def.name} recordId={record.id} />,
  );
  return designRows(
    Array.from(blocks.keys(), (id) => ({ id, label: id, visible: true })),
    details ? design.sections : undefined,
  )
    .filter((row) => row.visible)
    .map((row) =>
      details ? (
        <DesignBlock
          key={row.id}
          page={def.name}
          panel="sections"
          row={row}
          original={row.id}
        >
          {blocks.get(row.id)}
        </DesignBlock>
      ) : (
        <Fragment key={row.id}>{blocks.get(row.id)}</Fragment>
      ),
    );
};
