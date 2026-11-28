import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  CanAccess,
  useCanAccess,
  useCreatePath,
  useRecordContext,
  useResourceContext,
  useTranslate,
  type RaRecord,
} from "ra-core";
import { Link } from "react-router";
import { Plus } from "lucide-react";
import { Create } from "@/components/admin/create";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { DeleteButton } from "@/components/admin/delete-button";
import { Edit } from "@/components/admin/edit";
import { EditButton } from "@/components/admin/edit-button";
import { ExportButton } from "@/components/admin/export-button";
import { FilterButton } from "@/components/admin/filter-form";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { Show } from "@/components/admin/show";
import { SimpleForm, FormToolbar } from "@/components/admin/simple-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TopToolbar } from "@/components/atomic-crm/layout/TopToolbar";
import type { ResourceDef } from "../resources/schema";
import { getResourceDef } from "../resources/registry";
import { ChildSections } from "./ChildSection";
import { FieldInput } from "./FieldInput";
import { FieldValue } from "./FieldValue";
import { useLabel } from "./labels";
import {
  designRows,
  canvasTarget,
  DesignHeading,
  columnSize,
  blockSize,
  groupsFor,
  usePageDesign,
  type Panel,
} from "../pages/pageDesign";

function useDesignedFields(def: ResourceDef, panel: Panel) {
  const design = usePageDesign(def.name);
  const fields = new Map(def.fields.map((f) => [f.source, f]));
  const defaults = groupsFor(def.name).find((g) => g.key === panel)?.rows;
  if (!defaults || !design[panel])
    return {
      design,
      fields: def.fields.filter((f) =>
        panel === "form" ? !f.readOnly : f.list,
      ),
    };
  return {
    design,
    fields: designRows(defaults, design[panel])
      .filter((row) => row.visible)
      .map((row) => {
        const f = fields.get(row.id)!;
        const label =
          row.label === f.label.th ? f.label : { th: row.label, en: row.label };
        return { ...f, label, wide: row.wide };
      }),
  };
}

export interface ResourceExtensions {
  /** Extra buttons in the list toolbar (import, Excel export...) */
  listActions?: ComponentType;
  /** Panel rendered at the top of the show page (workflow actions, warnings) */
  showPanel?: ComponentType;
  /** Extra content below the creation form fields (duplicate warning...) */
  formExtras?: ComponentType;
  /** Rows that may not be edited any more (e.g. locked quotations) */
  isLocked?: (record: RaRecord) => boolean;
  /** Replaces the list content (e.g. calendar) when it returns a node */
  listAside?: ReactNode;
}

const FormFields = ({
  def,
  mode,
}: {
  def: ResourceDef;
  mode: "create" | "edit";
}) => {
  const { design, fields } = useDesignedFields(def, "form");
  const translate = useTranslate();
  const grid =
    design.columns === 1
      ? ""
      : design.columns === 3
        ? "md:grid-cols-3"
        : "md:grid-cols-2";
  return (
    <div className={`grid w-full min-w-0 gap-x-6 gap-y-4 ${grid}`}>
      <p className="col-span-full text-xs leading-relaxed text-muted-foreground">
        {translate("ddc.input.form_hint")}
      </p>
      {fields
        .filter((f) => !f.readOnly && !(mode === "create" && f.hideOnCreate))
        .map((f) => {
          const size = design.form?.find((row) => row.id === f.source);
          return (
            <div
              key={f.source}
              {...canvasTarget(def.name, "form", f.source)}
              style={blockSize(size)}
              className={[
                "min-w-0",
                (f.wide ?? (f.type === "textarea" || f.type === "json"))
                  ? "md:col-span-full"
                  : "",
                size?.height ? "ddc-sized-field" : "",
              ].join(" ")}
            >
              <FieldInput field={f} />
            </div>
          );
        })}
    </div>
  );
};

const parentRedirect =
  (def: ResourceDef) =>
  (_resource?: string, id?: unknown, data?: Record<string, unknown>) => {
    // Documents return to the record they are attached to
    if (data?.entity_type && data?.entity_id != null) {
      return `${String(data.entity_type)}/${String(data.entity_id)}/show`;
    }
    if (def.parent && data?.[def.parent.target] != null) {
      return `${def.parent.resource}/${String(data[def.parent.target])}/show`;
    }
    return `${def.name}/${String(id)}/show`;
  };

const defaultValuesOf = (def: ResourceDef) =>
  Object.fromEntries(
    def.fields
      .filter((f) => f.defaultValue !== undefined)
      .map((f) => [f.source, f.defaultValue]),
  );

export const makeGenericCreate = (
  def: ResourceDef,
  ext: ResourceExtensions = {},
) => {
  const GenericCreate = () => (
    <Create redirect={parentRedirect(def)}>
      <SimpleForm
        defaultValues={defaultValuesOf(def)}
        className="max-w-5xl"
        toolbar={<FormToolbar className="static md:sticky" />}
      >
        <FormFields def={def} mode="create" />
        {ext.formExtras ? <ext.formExtras /> : null}
      </SimpleForm>
    </Create>
  );
  return GenericCreate;
};

export const makeGenericEdit = (
  def: ResourceDef,
  ext: ResourceExtensions = {},
) => {
  const GenericEdit = () => (
    <Edit
      title={<FormRecordTitle def={def} />}
      redirect={parentRedirect(def)}
      mutationMode="pessimistic"
    >
      <SimpleForm
        className="max-w-5xl"
        toolbar={<FormToolbar className="static md:sticky" />}
      >
        <FormFields def={def} mode="edit" />
        {ext.formExtras ? <ext.formExtras /> : null}
      </SimpleForm>
    </Edit>
  );
  return GenericEdit;
};

/** Long source notes remain in the field; the heading uses only its first line. */
function FormRecordTitle({ def }: { def: ResourceDef }) {
  const record = useRecordContext();
  const label = useLabel();
  const text = String(record?.[def.recordRepresentation] ?? "").split(
    /\r?\n/,
  )[0];
  return (
    <span className="line-clamp-2" title={text}>
      {label(def.label.one)} {text}
    </span>
  );
}

const ShowActions = ({
  def,
  ext,
}: {
  def: ResourceDef;
  ext: ResourceExtensions;
}) => {
  const record = useRecordContext();
  const locked = record && ext.isLocked ? ext.isLocked(record) : false;
  const { canAccess: canEdit } = useCanAccess({
    resource: def.name,
    action: "edit",
    record,
  });
  const { canAccess: canDelete } = useCanAccess({
    resource: def.name,
    action: "delete",
    record,
  });
  if (def.readOnly) return null;
  return (
    <TopToolbar>
      {canEdit && !locked ? (
        <EditButton className="min-h-11 sm:min-h-9" />
      ) : null}
      {canDelete && !locked ? (
        <DeleteButton
          className="min-h-11 sm:min-h-9 cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40"
          redirect={
            def.parent && record?.[def.parent.target] != null
              ? `/${def.parent.resource}/${String(record[def.parent.target])}/show`
              : "list"
          }
        />
      ) : null}
    </TopToolbar>
  );
};

/** True when the record shown may not be changed any more (children included). */
export const ParentLockedContext = createContext(false);

const COMPANY_SHOW_GROUPS: Array<{
  id: string;
  title: { th: string; en: string };
  fields: string[];
}> = [
  {
    id: "core",
    title: { th: "ข้อมูลหลักลูกค้า", en: "Core customer information" },
    fields: [
      "customer_code",
      "name",
      "legal_name",
      "tax_identifier",
      "org_type",
      "parent_company_id",
      "branch_code",
    ],
  },
  {
    id: "classification",
    title: {
      th: "การจัดกลุ่มและผู้รับผิดชอบ",
      en: "Classification & ownership",
    },
    fields: [
      "lifecycle_status_id",
      "category_id",
      "customer_group_id",
      "territory_id",
      "sales_id",
    ],
  },
  {
    id: "contact_location",
    title: { th: "ข้อมูลติดต่อและที่ตั้ง", en: "Contact & location" },
    fields: [
      "phone_number",
      "email",
      "website",
      "address",
      "city",
      "province",
      "zipcode",
      "country",
      "latitude",
      "longitude",
      "google_maps_url",
      "location_note",
    ],
  },
  {
    id: "summary",
    title: { th: "รายละเอียดและสรุปกิจกรรม", en: "Notes & activity summary" },
    fields: ["description", "nb_deals", "last_activity_at", "created_at"],
  },
];

const isFullWidthShowField = (source: string, wide?: boolean, type?: string) =>
  Boolean(wide) ||
  type === "textarea" ||
  type === "json" ||
  type === "email" ||
  type === "url" ||
  source === "name" ||
  source === "legal_name" ||
  source === "location_note";

const FieldDefinitionGrid = ({ fields }: { fields: ResourceDef["fields"] }) => {
  const label = useLabel();
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 min-[360px]:grid-cols-2 sm:gap-x-6 sm:gap-y-3 xl:grid-cols-3">
      {fields.map((f) => (
        <div
          key={f.source}
          className={[
            "min-w-0",
            isFullWidthShowField(f.source, f.wide, f.type)
              ? "col-span-full"
              : "",
          ].join(" ")}
        >
          <dt className="text-xs font-medium text-muted-foreground">
            {label(f.label)}
          </dt>
          <dd className="mt-0.5 min-w-0 break-words text-sm">
            <FieldValue field={f} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

const CompanyDetailsSections = ({
  fields,
}: {
  fields: ResourceDef["fields"];
}) => {
  const label = useLabel();
  const bySource = new Map(fields.map((f) => [f.source, f]));
  const assigned = new Set<string>();
  const sections = COMPANY_SHOW_GROUPS.map((group) => {
    const groupFields = group.fields
      .map((src) => bySource.get(src))
      .filter((f): f is NonNullable<typeof f> => Boolean(f));
    for (const f of groupFields) assigned.add(f.source);
    return { ...group, fields: groupFields };
  });
  const remaining = fields.filter((f) => !assigned.has(f.source));
  if (remaining.length > 0 && sections.length > 0) {
    sections[sections.length - 1].fields.push(...remaining);
  }
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardContent className="space-y-4 px-3.5 pt-4 pb-4 sm:space-y-5 sm:px-6 sm:pt-5 sm:pb-6">
        {sections
          .filter((s) => s.fields.length > 0)
          .map((section, idx) => (
            <section
              key={section.id}
              aria-labelledby={`company-section-${section.id}`}
              className={idx > 0 ? "border-t pt-3.5 sm:pt-4" : ""}
            >
              <h3
                id={`company-section-${section.id}`}
                className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {label(section.title)}
              </h3>
              <FieldDefinitionGrid fields={section.fields} />
            </section>
          ))}
      </CardContent>
    </Card>
  );
};

const ShowBody = ({
  def,
  ext,
}: {
  def: ResourceDef;
  ext: ResourceExtensions;
}) => {
  const record = useRecordContext();
  const locked = Boolean(record && ext.isLocked?.(record));
  const detailsNode =
    def.name === "companies" ? (
      <CompanyDetailsSections fields={def.fields} />
    ) : (
      <Card className="min-w-0 overflow-hidden">
        <CardContent className="px-3.5 pt-4 pb-4 sm:px-6 sm:pt-6 sm:pb-6">
          <FieldDefinitionGrid fields={def.fields} />
        </CardContent>
      </Card>
    );
  return (
    <ParentLockedContext.Provider value={locked}>
      <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
        {ext.showPanel ? <ext.showPanel /> : null}
        <ChildSections def={def} details={detailsNode} />
      </div>
    </ParentLockedContext.Provider>
  );
};

export const makeGenericShow = (
  def: ResourceDef,
  ext: ResourceExtensions = {},
) => {
  const GenericShow = () => (
    <Show actions={<ShowActions def={def} ext={ext} />}>
      <ShowBody def={def} ext={ext} />
    </Show>
  );
  return GenericShow;
};

const ListActions = ({
  def,
  ext,
}: {
  def: ResourceDef;
  ext: ResourceExtensions;
}) => (
  <TopToolbar>
    {def.fields.some((f) => f.filter) ? <FilterButton /> : null}
    {ext.listActions ? <ext.listActions /> : null}
    <CanAccess resource={def.name} action="export">
      <ExportButton />
    </CanAccess>
    {!def.readOnly ? (
      <CanAccess resource={def.name} action="create">
        <CreateButton />
      </CanAccess>
    ) : null}
  </TopToolbar>
);

export const makeGenericList = (
  def: ResourceDef,
  ext: ResourceExtensions = {},
) => {
  const GenericList = () => {
    const label = useLabel();
    const { fields, design } = useDesignedFields(def, "table");
    const filters = [
      ...(def.searchFields?.length
        ? [<SearchInput key="q" source="q" alwaysOn />]
        : []),
      ...def.fields
        .filter((f) => f.filter)
        .map((f) => <FieldInput key={f.source} field={f} asFilter />),
    ];
    return (
      <List
        sort={def.sort}
        filters={filters}
        actions={<ListActions def={def} ext={ext} />}
        perPage={25}
      >
        {ext.listAside}
        <div
          className={def.name === "companies" ? "hidden md:block" : undefined}
        >
          <DataTable rowClick="show" bulkActionButtons={false}>
            {fields.map((f) => (
              <DataTable.Col
                key={f.source}
                source={f.source}
                designTarget={canvasTarget(def.name, "table", f.source)}
                headerHeight={design.headerHeight}
                columnStyle={columnSize(
                  design.table?.find((row) => row.id === f.source)?.width,
                )}
                label={label(f.label)}
                disableSort={f.type === "json"}
                render={() => <FieldValue field={f} />}
              />
            ))}
          </DataTable>
        </div>
      </List>
    );
  };
  return GenericList;
};

/** Button opening the creation form of a child record, prefilled with its parent. */
export const AddChildButton = ({
  resource,
  target,
  label,
}: {
  resource: string;
  target: string;
  label?: string;
}) => {
  const record = useRecordContext();
  const createPath = useCreatePath();
  const parentResource = useResourceContext();
  const { canAccess } = useCanAccess({ resource, action: "create" });
  const { canAccess: canEditParent } = useCanAccess({
    resource: parentResource ?? resource,
    action: "edit",
    record,
  });
  const parentLocked = useContext(ParentLockedContext);
  if (!record || !canAccess || !canEditParent || parentLocked) return null;
  const prefill: Record<string, unknown> = { [target]: record.id };
  const childDef = getResourceDef(resource);
  if (childDef) {
    for (const shared of ["company_id", "contact_id", "deal_id", "rfq_id"]) {
      if (
        shared !== target &&
        record[shared] != null &&
        childDef.fields.some((f) => f.source === shared)
      ) {
        prefill[shared] = record[shared];
      }
    }
  }
  const to = `${createPath({ resource, type: "create" })}?source=${encodeURIComponent(
    JSON.stringify(prefill),
  )}`;
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-h-11 shrink-0 sm:min-h-9"
      render={<Link to={to} />}
    >
      <Plus className="size-4" />
      {label}
    </Button>
  );
};

export const SectionCard = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <Card className="min-w-0 overflow-hidden">
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-3.5 py-3 sm:px-6 sm:py-4">
      <CardTitle className="min-w-0 break-words text-base">
        <DesignHeading>{title}</DesignHeading>
      </CardTitle>
      {action}
    </CardHeader>
    <CardContent className="min-w-0 px-3.5 pb-3.5 sm:px-6 sm:pb-6">
      {children}
    </CardContent>
  </Card>
);

export const makeGenericResource = (
  def: ResourceDef,
  ext: ResourceExtensions = {},
) => ({
  list: def.childOnly ? undefined : makeGenericList(def, ext),
  create: def.readOnly ? undefined : makeGenericCreate(def, ext),
  edit: def.readOnly ? undefined : makeGenericEdit(def, ext),
  show: makeGenericShow(def, ext),
  icon: def.icon,
  recordRepresentation: def.recordRepresentation,
});
