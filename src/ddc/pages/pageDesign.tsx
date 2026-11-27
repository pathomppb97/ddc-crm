import {
  Children,
  cloneElement,
  createContext,
  useContext,
  isValidElement,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { installDesignCanvas } from "./designCanvas";
import { CardTitle } from "@/components/ui/card";
import { getResourceDef } from "../resources/registry";

export type Panel = "table" | "form" | "sections";
type Row = {
  id: string;
  label: string;
  visible: boolean;
  locked?: boolean;
  wide?: boolean;
  width?: number;
  height?: number;
};
export type Design = Partial<Record<Panel, Row[]>> & {
  columns?: number;
  headerHeight?: number;
};
type Group = {
  key: Panel;
  name: string;
  path: string;
  rows: Row[];
  record?: boolean;
};

// The identifiers correspond to the children of each native layout group.
const native: Record<string, Partial<Record<Panel, string[]>>> = {
  dashboard: { sections: ["Sales KPIs", "ERP overview", "Charts"] },
  calendar: { sections: ["Overdue follow-ups", "Customer coverage"] },
  settings: {
    sections: ["Branding", "Companies", "Deals", "Notes", "Tasks", "Tags"],
  },
  profile: {
    sections: ["Personal profile", "Inbound email", "MCP connection"],
  },
  import: { sections: ["Import instructions", "Upload form"] },
  contacts: {
    form: ["Identity", "Position"],
    sections: ["Contact filters", "Contact list"],
  },
  deals: {
    form: ["Name", "Description"],
    sections: ["Pipeline board", "Archived opportunities"],
  },
  sales: {
    table: ["first_name", "last_name", "email", "role_key", "Account flags"],
    form: [
      "first_name",
      "last_name",
      "email",
      "role_key",
      "administrator",
      "disabled",
    ],
  },
  permissions: {
    table: [
      "read",
      "create",
      "update",
      "delete",
      "approve",
      "export",
      "import",
    ],
  },
  "erp-integration": {
    sections: [
      "Connector",
      "Legal entities",
      "Contracts",
      "Last result",
      "Recent errors",
    ],
  },
};
const protectedItems = new Set([
  "Identity",
  "Name",
  "first_name",
  "last_name",
  "email",
  "Personal profile",
  "Upload form",
]);
const published = import.meta.glob<Design>("./designs/*.json", {
  eager: true,
  import: "default",
});
const empty: Design = {};
const adminOrigin = "http://127.0.0.1:5178";
const params = new URLSearchParams(
  typeof window === "undefined" ? "" : window.location.search,
);
const frameKey =
  import.meta.env.DEV && params.has("ddc-design") && window.parent !== window
    ? params.get("ddc-design")
    : null;
export const isDesignPreview = Boolean(frameKey);
let draft: Design | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePageDesign(key: string): Design {
  const get = () =>
    (key === frameKey && draft) || published[`./designs/${key}.json`] || empty;
  return useSyncExternalStore(subscribe, get);
}

export function groupsFor(key: string): Group[] {
  const route = key === "dashboard" ? "/" : "/" + key;
  const def = getResourceDef(key);
  if (def) {
    const groups: Group[] = [
      {
        key: "table",
        name: "Table columns",
        path: route,
        rows: def.fields.map((f) => ({
          id: f.source,
          label: f.label.th,
          visible: !!f.list,
        })),
      },
    ];
    if (!def.readOnly)
      groups.push({
        key: "form",
        name: "Form fields",
        path: route + "/create",
        rows: def.fields
          .filter((f) => !f.readOnly)
          .map((f) => ({
            id: f.source,
            label: f.label.th,
            visible: true,
            locked: !!f.required,
            wide: !!f.wide || ["textarea", "json"].includes(f.type),
          })),
      });
    const sections = [
      "Record details",
      ...(def.children ?? []).map((c) => c.resource),
      ...(def.documentEntity ? ["Documents"] : []),
      "Audit history",
    ];
    groups.push({
      key: "sections",
      name: "Detail layout",
      path: route,
      record: true,
      rows: sections.map((id) => ({ id, label: id, visible: true })),
    });
    return groups;
  }
  return Object.entries(native[key] ?? {}).map(([panel, ids]) => ({
    key: panel as Panel,
    name: {
      table: "Table columns",
      form: "Form layout",
      sections: "Page layout",
    }[panel]!,
    path: panel === "form" ? route + "/create" : route,
    rows: ids.map((id) => ({
      id,
      label: id.replaceAll("_", " "),
      visible: true,
      locked: panel !== "table" && protectedItems.has(id),
    })),
  }));
}

export function designRows(defaults: Row[], overrides?: Row[]) {
  const known = new Map(defaults.map((row) => [row.id, row]));
  const result: Row[] = [];
  for (const override of overrides ?? []) {
    const base = known.get(override.id);
    if (!base) continue;
    result.push({
      ...base,
      visible: base.locked || override.visible,
      wide: override.wide ?? base.wide,
      width: override.width,
      height: override.height,
      label: override.label.trim() || base.label,
    });
    known.delete(base.id);
  }
  return [...result, ...known.values()];
}

export function arrange(
  children: ReactNode[],
  key: string,
  panel: Panel,
  design: Design,
) {
  const ids = native[key]?.[panel] ?? [];
  const defaults = ids.map((id) => ({
    id,
    label: id.replaceAll("_", " "),
    visible: true,
    locked: protectedItems.has(id),
  }));
  return designRows(defaults, design[panel])
    .filter((row) => row.visible)
    .map((row) => (
      <DesignBlock
        key={row.id}
        page={key}
        panel={panel}
        row={row}
        original={row.id.replaceAll("_", " ")}
      >
        {children[ids.indexOf(row.id)]}
      </DesignBlock>
    ));
}

export function canvasTarget(page: string, panel: Panel, id: string) {
  return page === frameKey
    ? { "data-design-panel": panel, "data-design-id": id }
    : {};
}

export function columnSize(width?: number) {
  return width
    ? {
        width,
        minWidth: width,
        maxWidth: width,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }
    : undefined;
}

export function blockSize(row?: {
  width?: number;
  height?: number;
}): React.CSSProperties | undefined {
  if (!row?.width && !row?.height) return undefined;
  return {
    ...(row.width && { width: row.width, maxWidth: "100%" }),
    ...(row.height && { height: row.height, minHeight: 0, overflow: "auto" }),
  };
}

const BlockHeading = createContext<string | undefined>(undefined);
export function DesignHeading({ children }: { children: ReactNode }) {
  return <>{useContext(BlockHeading) ?? children}</>;
}

// Preserve the native heading's placement, styling and accessibility semantics.
function renameHeading(children: ReactNode, name: string) {
  let found = false;
  function visit(node: ReactNode): ReactNode {
    if (found || !isValidElement<{ children?: ReactNode }>(node)) return node;
    if (
      node.type === CardTitle ||
      (typeof node.type === "string" && /^h[1-6]$/.test(node.type))
    ) {
      found = true;
      return cloneElement(node, {}, name);
    }
    if (!node.props.children) return node;
    const descendants = Children.map(node.props.children, visit);
    return found ? cloneElement(node, {}, descendants) : node;
  }
  const content = visit(children);
  return { content, found };
}

export function DesignBlock({
  page,
  panel,
  row,
  original,
  children,
}: {
  page: string;
  panel: Panel;
  row: Row;
  original: string;
  children: ReactNode;
}) {
  if (!children) return null;
  const name = row.label !== original ? row.label : undefined;
  const direct = panel === "form" && ["sales", "deals"].includes(page);
  let content: ReactNode = children;
  let addHeading = !!name && !direct;
  if (
    direct &&
    name &&
    isValidElement<{ label?: string; children?: ReactNode }>(children)
  ) {
    const input = children.props.children;
    content = isValidElement<{ label?: string }>(input)
      ? cloneElement(children, {}, cloneElement(input, { label: name }))
      : cloneElement(children, { label: name });
  }
  if (name && !direct) {
    const inherited =
      (getResourceDef(page) && row.id !== "Record details") ||
      (page === "settings" && row.id === "Tags") ||
      (page === "contacts" && panel === "form");
    if (inherited) {
      content = (
        <BlockHeading.Provider value={name}>{children}</BlockHeading.Provider>
      );
      addHeading = false;
    } else if (!(page === "dashboard" && row.id === "Charts")) {
      const replacement = renameHeading(children, name);
      content = replacement.content;
      addHeading = !replacement.found;
    }
  }
  if (page !== frameKey && !name && !row.width && !row.height)
    return <>{children}</>;
  return (
    <div
      {...canvasTarget(page, panel, row.id)}
      className={
        panel === "form" && row.height
          ? "min-w-0 empty:hidden ddc-sized-field"
          : "min-w-0 empty:hidden"
      }
      style={blockSize(row)}
    >
      {addHeading ? (
        <h3 className="mb-2 text-lg font-semibold">{name}</h3>
      ) : null}
      {content}
    </div>
  );
}

export function DesignSlots({
  page,
  panel = "sections",
  children,
}: {
  page: string;
  panel?: Panel;
  children: ReactNode;
}) {
  const design = usePageDesign(page);
  // Keep empty conditional children as slots so other blocks retain their IDs.
  const slots: ReactNode[] = [];
  Children.forEach(children, (child) => slots.push(child));
  return <>{arrange(slots, page, panel, design)}</>;
}

if (frameKey) {
  // Only the separate canvas accepts input. The CRM retains its normal read-only preview.
  document.getElementById("root")!.inert = true;
  const canvas = installDesignCanvas((type, payload) =>
    window.parent.postMessage({ type, key: frameKey, ...payload }, adminOrigin),
  );
  const schema = groupsFor(frameKey);
  const receiveDraft = (event: MessageEvent) => {
    if (
      event.origin !== adminOrigin ||
      event.source !== window.parent ||
      event.data?.type !== "ddc-preview" ||
      event.data.key !== frameKey
    )
      return;
    draft = event.data.design;
    canvas.update(event.data.panel, event.data.selected);
    for (const notify of listeners) notify();
    window.parent.postMessage(
      { type: "ddc-applied", key: frameKey },
      adminOrigin,
    );
  };
  window.addEventListener("message", receiveDraft);
  window.parent.postMessage(
    {
      type: "ddc-ready",
      key: frameKey,
      groups: schema,
      resource: !!getResourceDef(frameKey),
    },
    adminOrigin,
  );
  import.meta.hot?.dispose(() => {
    window.removeEventListener("message", receiveDraft);
    canvas.destroy();
  });
}

export function reportPreviewRecord(resource: string, id: unknown) {
  if (frameKey === resource)
    window.parent.postMessage(
      { type: id == null ? "ddc-empty" : "ddc-record", key: frameKey, id },
      adminOrigin,
    );
}
