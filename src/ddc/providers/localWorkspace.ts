import type { CrmDataProvider } from "@/components/atomic-crm/providers/types";
import {
  createDataProvider,
  type CreateFakeRestDataProviderOptions,
} from "@/components/atomic-crm/providers/fakerest/dataProvider";
import type { Db } from "@/components/atomic-crm/providers/fakerest/dataGenerator/types";

type WorkspaceDb = Db & Record<string, Array<{ id: string | number }>>;
interface Snapshot {
  revision: number;
  sourceVersion: string;
  db: WorkspaceDb;
  seedAdditionVersion?: string;
  customerDirectoryVersion?: string;
}

export interface CustomerDirectoryUpdate {
  version: string;
  apply(
    companies: Array<Record<string, unknown> & { id: string | number }>,
    options: Array<Record<string, unknown> & { id: string | number }>,
  ): Array<Record<string, unknown> & { id: string | number }>;
}

export interface SeedAddition {
  version: string;
  tables: Record<
    string,
    Array<Record<string, unknown> & { id: string | number }>
  >;
}

const WRITE_METHODS = new Set([
  "create",
  "update",
  "delete",
  "updateMany",
  "deleteMany",
  "unarchiveDeal",
  "salesCreate",
  "salesUpdate",
  "signUp",
  "updatePassword",
  "mergeContacts",
  "updateConfiguration",
  "convertLead",
  "submitQuotation",
  "decideQuotationApproval",
  "setQuotationStatus",
  "createQuotationRevision",
  "runErpAction",
]);

function connect(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close other CRM tabs to open local storage."));
  });
}

function read(database: IDBDatabase): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("workspace")
      .objectStore("workspace")
      .get("current");
    request.onsuccess = () => resolve(request.result as Snapshot | undefined);
    request.onerror = () => reject(request.error);
  });
}

function commit(
  database: IDBDatabase,
  snapshot: Snapshot,
  expected: number,
  backup?: Snapshot,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("workspace", "readwrite");
    const store = transaction.objectStore("workspace");
    const request = store.get("current");
    let conflict = false;
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== expected) {
        conflict = true;
        transaction.abort();
        return;
      }
      if (backup) store.put(backup, `backup:before-seed-addition:${expected}`);
      store.put(snapshot, "current");
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        new Error(
          conflict
            ? "Another CRM tab saved a change. Reload this tab before retrying."
            : "Local storage could not save the change. Keep this tab open and export a backup.",
        ),
      );
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local storage write failed."));
  });
}

/** Save a complete mutation atomically, including its audit and child updates. */
export async function openLocalWorkspace(
  seed: WorkspaceDb,
  sourceVersion: string,
  databaseName = "ddc-agriculture-crm-local-v1",
  addition?: SeedAddition,
  identity?: Pick<
    CreateFakeRestDataProviderOptions,
    "authProvider" | "getCurrentUser"
  >,
  customerDirectory?: CustomerDirectoryUpdate,
): Promise<CrmDataProvider> {
  const database = await connect(databaseName);
  const stored = await read(database);
  if (stored && stored.sourceVersion !== sourceVersion) {
    database.close();
    throw new Error(
      "The Agriculture source package changed. Export and reconcile the existing local workspace before updating its baseline; saved data has been preserved.",
    );
  }
  let saved = structuredClone(stored?.db ?? seed);
  let revision = stored?.revision ?? 0;
  let seedAdditionVersion =
    stored?.seedAdditionVersion ?? (stored ? undefined : addition?.version);
  let customerDirectoryVersion = stored?.customerDirectoryVersion;
  let needsCommit = false;
  // Ensure newly added tables and reference options exist in legacy browser snapshots
  // without touching any previously saved user records.
  if (stored) {
    for (const [resource, rows] of Object.entries(seed)) {
      if (!Array.isArray(saved[resource])) {
        saved[resource] = structuredClone(rows);
        needsCommit = true;
      }
    }
    if (Array.isArray(saved.activities)) {
      for (const activity of saved.activities as Array<
        Record<string, unknown>
      >) {
        if (activity.logged_at == null) {
          activity.logged_at =
            activity.start_at ??
            activity.created_at ??
            new Date().toISOString();
          needsCommit = true;
        }
      }
    }
    for (const refTable of ["option_categories", "master_options"] as const) {
      const existing = saved[refTable] ?? [];
      const seedRows = seed[refTable] ?? [];
      const keyOf = (row: Record<string, unknown>) =>
        refTable === "option_categories"
          ? String(row.key ?? row.id)
          : `${String(row.category ?? "")}:${String(row.code ?? row.id)}`;
      const seen = new Set(
        existing.map((row) => keyOf(row as Record<string, unknown>)),
      );
      const missing = seedRows.filter(
        (row) => !seen.has(keyOf(row as Record<string, unknown>)),
      );
      if (missing.length > 0) {
        saved[refTable] = [...existing, ...structuredClone(missing)];
        needsCommit = true;
      }
    }
  }
  if (stored && addition && addition.version !== stored.seedAdditionVersion) {
    // Add missing source IDs only. Existing records, edits and deletions remain
    // untouched after this version has been applied. Keep the prior snapshot.
    for (const [resource, rows] of Object.entries(addition.tables)) {
      const existing = saved[resource] ?? [];
      const ids = new Set(existing.map((row) => String(row.id)));
      saved[resource] = [
        ...existing,
        ...structuredClone(rows.filter((row) => !ids.has(String(row.id)))),
      ];
    }
    seedAdditionVersion = addition.version;
    needsCommit = true;
  }
  if (
    customerDirectory &&
    customerDirectory.version !== customerDirectoryVersion
  ) {
    saved.companies = customerDirectory.apply(
      saved.companies ?? [],
      saved.master_options ?? [],
    ) as WorkspaceDb["companies"];
    customerDirectoryVersion = customerDirectory.version;
    needsCommit = true;
  }
  if (needsCommit) {
    await commit(
      database,
      {
        revision: revision + 1,
        sourceVersion,
        db: saved,
        seedAdditionVersion,
        customerDirectoryVersion,
      },
      revision,
      stored,
    );
    revision += 1;
  }
  const build = (db: WorkspaceDb) =>
    createDataProvider({
      db: structuredClone(db),
      latency: 0,
      silent: true,
      ...identity,
    });
  let current = build(saved);
  let queue = Promise.resolve();
  const resources = [...new Set([...Object.keys(seed), ...Object.keys(saved)])];
  return new Proxy(current, {
    get(_target, property) {
      const key = property as keyof CrmDataProvider;
      if (!WRITE_METHODS.has(String(property))) {
        const value = current[key];
        return typeof value === "function" ? value.bind(current) : value;
      }
      return (...args: unknown[]) => {
        const change = queue.then(async () => {
          const draft = build(saved);
          const method = draft[key];
          if (typeof method !== "function")
            throw new Error("Unknown CRM mutation.");
          const result = await Reflect.apply(method, draft, args);
          const entries = await Promise.all(
            resources.map(async (resource) => {
              const { data } = await draft.getList(resource, {
                pagination: { page: 1, perPage: Number.MAX_SAFE_INTEGER },
                sort: { field: "id", order: "ASC" },
                filter: {},
              });
              return [resource, data];
            }),
          );
          const next = Object.fromEntries(entries) as WorkspaceDb;
          await commit(
            database,
            {
              revision: revision + 1,
              sourceVersion,
              db: next,
              seedAdditionVersion,
              customerDirectoryVersion,
            },
            revision,
          );
          revision += 1;
          saved = next;
          current = draft;
          return result;
        });
        queue = change.then(
          () => undefined,
          () => undefined,
        );
        return change;
      };
    },
  });
}
