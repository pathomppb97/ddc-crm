import {
  ErpThrottledError,
  ErpTransientError,
  type ErpConnector,
  type ErpLegalEntity,
  type ErpPage,
  type ErpQuery,
  type ErpRecord,
} from "./types.ts";

/**
 * Mock Dynamics 365 Finance and Operations connector.
 *
 * It behaves like the OData endpoint of the ERP (legal entity scoping, server
 * driven paging, incremental filter, throttling) on a purely SYNTHETIC data set.
 * Every name, number and amount below is made up for integration testing and
 * must never be read as DDC business data.
 */

export const MOCK_MODIFIED_FIELD = "ModifiedDateTime";

export const MOCK_LEGAL_ENTITIES: ErpLegalEntity[] = [
  { dataAreaId: "syn1", name: "Synthetic Legal Entity 1 (mock)" },
  { dataAreaId: "syn2", name: "Synthetic Legal Entity 2 (mock)" },
];

type Dataset = Record<string, ErpRecord[]>;

const BASE_TIME = Date.UTC(2026, 0, 1);
const stamp = (dayOffset: number) =>
  new Date(BASE_TIME + dayOffset * 86_400_000).toISOString();
const pad = (value: number, size = 4) => String(value).padStart(size, "0");

const buildLegalEntityData = (
  dataAreaId: string,
  entityIndex: number,
): Dataset => {
  const customerCount = 12;
  const itemCount = 15;
  const orderCount = 18;

  // Account and item numbers intentionally repeat across legal entities with
  // different content: ERP keys are only unique inside one legal entity.
  const customers = Array.from({ length: customerCount }, (_, i) => ({
    dataAreaId,
    CustomerAccount: `MOCK-C${pad(i + 1)}`,
    OrganizationName: `Synthetic Customer ${entityIndex + 1}-${pad(i + 1, 2)} (mock)`,
    TaxExemptNumber: `MOCKTAX${entityIndex + 1}${pad(i + 1, 6)}`,
    PrimaryContactPhone: `+00 000 ${pad(entityIndex + 1, 2)}${pad(i + 1, 2)}`,
    PrimaryContactEmail: `Contact${i + 1}@Mock-${dataAreaId}.example.test`,
    AddressStreet: `${i + 1} Synthetic Road`,
    AddressCity: "Mock City",
    AddressZipCode: pad(10000 + i, 5),
    AddressCountryRegionId: "tha",
    [MOCK_MODIFIED_FIELD]: stamp(i),
  }));

  const items = Array.from({ length: itemCount }, (_, i) => ({
    dataAreaId,
    ItemNumber: `MOCK-ITEM-${pad(i + 1)}`,
    ProductNumber: `MOCK-ITEM-${pad(i + 1)}`,
    SearchName: `Synthetic item ${entityIndex + 1}-${pad(i + 1, 2)} (mock)`,
    ProductName: `Synthetic item ${entityIndex + 1}-${pad(i + 1, 2)} (mock)`,
    SalesUnitSymbol: "pcs",
    [MOCK_MODIFIED_FIELD]: stamp(i),
  }));

  const orders = Array.from({ length: orderCount }, (_, i) => {
    const lines = [0, 1].map((lineIndex) => {
      const quantity = 10 * (lineIndex + 1) + i;
      const price = 100 + 5 * ((i + lineIndex) % 7);
      return {
        dataAreaId,
        InventoryLotId: `MOCK-LOT-${dataAreaId}-${pad(i + 1)}-${lineIndex + 1}`,
        SalesOrderNumber: `MOCK-SO-${pad(i + 1)}`,
        LineNumber: lineIndex + 1,
        ItemNumber: items[(i + lineIndex) % itemCount].ItemNumber,
        OrderedSalesQuantity: quantity,
        SalesUnitSymbol: "pcs",
        SalesPrice: price,
        LineAmount: quantity * price,
        [MOCK_MODIFIED_FIELD]: stamp(30 + i),
      };
    });
    return {
      header: {
        dataAreaId,
        SalesOrderNumber: `MOCK-SO-${pad(i + 1)}`,
        OrderingCustomerAccountNumber:
          customers[i % customerCount].CustomerAccount,
        OrderCreationDateTime: stamp(30 + i),
        RequestedShippingDate: stamp(45 + i),
        SalesOrderStatus: i % 3 === 0 ? "Invoiced" : "Backorder",
        CurrencyCode: "thb",
        OrderTotalAmount: lines.reduce((sum, line) => sum + line.LineAmount, 0),
        [MOCK_MODIFIED_FIELD]: stamp(30 + i),
      },
      lines,
    };
  });

  const invoiced = orders.filter(
    (order) => order.header.SalesOrderStatus === "Invoiced",
  );

  return {
    CustomersV3: customers,
    ProductsV2: items,
    ReleasedProductsV2: items,
    WarehousesOnHandV2: items.map((item, i) => ({
      dataAreaId,
      ItemNumber: item.ItemNumber,
      InventorySiteId: "MOCKSITE",
      InventoryWarehouseId: `MOCKWH${(i % 2) + 1}`,
      AvailableOnHandQuantity: 50 + i * 3,
      OnHandQuantity: 60 + i * 3,
      [MOCK_MODIFIED_FIELD]: stamp(60),
    })),
    SalesPriceAgreements: items.map((item, i) => ({
      dataAreaId,
      RecordId: `MOCK-PRICE-${dataAreaId}-${pad(i + 1)}`,
      ItemNumber: item.ItemNumber,
      PriceCustomerGroupCode: "MOCKGRP",
      PriceCurrencyCode: "thb",
      Price: 100 + i * 5,
      FromQuantity: 1,
      PriceApplicableFromDate: stamp(0),
      PriceApplicableToDate: stamp(365),
      [MOCK_MODIFIED_FIELD]: stamp(1),
    })),
    SalesOrderHeadersV2: orders.map((order) => order.header),
    SalesOrderLines: orders.flatMap((order) => order.lines),
    SalesPackingSlipHeadersV2: invoiced.map((order, i) => ({
      dataAreaId,
      PackingSlipNumber: `MOCK-PS-${pad(i + 1)}`,
      SalesOrderNumber: order.header.SalesOrderNumber,
      DeliveryDate: order.header.RequestedShippingDate,
      [MOCK_MODIFIED_FIELD]: order.header.RequestedShippingDate,
    })),
    SalesInvoiceHeadersV2: invoiced.map((order, i) => ({
      dataAreaId,
      InvoiceNumber: `MOCK-INV-${pad(i + 1)}`,
      SalesOrderNumber: order.header.SalesOrderNumber,
      InvoiceCustomerAccountNumber: order.header.OrderingCustomerAccountNumber,
      InvoiceDate: order.header.RequestedShippingDate,
      PaymentDueDate: stamp(75 + i),
      CurrencyCode: "thb",
      TotalInvoiceAmount: order.header.OrderTotalAmount,
      [MOCK_MODIFIED_FIELD]: order.header.RequestedShippingDate,
    })),
    ContactsV2: [],
    SalesQuotationHeadersV2: [],
  };
};

export const buildMockDataset = (): Record<string, Dataset> =>
  Object.fromEntries(
    MOCK_LEGAL_ENTITIES.map((legalEntity, index) => [
      legalEntity.dataAreaId,
      buildLegalEntityData(legalEntity.dataAreaId, index),
    ]),
  );

export interface MockConnectorOptions {
  dataset?: Record<string, Dataset>;
  /** Server side page size cap, like the ERP. */
  maxPageSize?: number;
  /** Throw a 429 once every N requests (0 disables throttling). */
  throttleEvery?: number;
  throttleRetryAfterMs?: number;
}

export const createMockD365Connector = ({
  dataset = buildMockDataset(),
  maxPageSize = 1000,
  throttleEvery = 0,
  throttleRetryAfterMs = 1000,
}: MockConnectorOptions = {}) => {
  let requestCount = 0;
  let transientFailures = 0;

  const rowsOf = (dataAreaId: string, entityName: string): ErpRecord[] => {
    const legalEntity = dataset[dataAreaId];
    if (!legalEntity) throw new Error(`Unknown legal entity ${dataAreaId}`);
    const rows = legalEntity[entityName];
    if (!rows)
      throw new Error(
        `Data entity ${entityName} is not enabled in the mock environment`,
      );
    return rows;
  };

  const connector: ErpConnector = {
    type: "mock",
    modifiedField: MOCK_MODIFIED_FIELD,

    async healthCheck() {
      return {
        ok: true,
        message: "Mock connector: synthetic data, no network access",
      };
    },

    async listLegalEntities() {
      return MOCK_LEGAL_ENTITIES.map((legalEntity) => ({ ...legalEntity }));
    },

    async fetchPage(query: ErpQuery): Promise<ErpPage> {
      requestCount += 1;
      if (transientFailures > 0) {
        transientFailures -= 1;
        throw new ErpTransientError("Mock transient failure (HTTP 503)");
      }
      if (throttleEvery > 0 && requestCount % throttleEvery === 0) {
        throw new ErpThrottledError(throttleRetryAfterMs);
      }

      const since = query.modifiedSince ?? null;
      const rows = rowsOf(query.dataAreaId, query.entityName)
        .filter((row) => !since || String(row[MOCK_MODIFIED_FIELD]) > since)
        .sort((a, b) =>
          String(a[MOCK_MODIFIED_FIELD]).localeCompare(
            String(b[MOCK_MODIFIED_FIELD]),
          ),
        );

      const offset = query.nextLink
        ? Number(query.nextLink.replace("mock-skip:", ""))
        : 0;
      const size = Math.max(1, Math.min(query.pageSize, maxPageSize));
      const records = rows
        .slice(offset, offset + size)
        .map((row) => ({ ...row }));
      const nextOffset = offset + size;

      return {
        records,
        nextLink: nextOffset < rows.length ? `mock-skip:${nextOffset}` : null,
      };
    },
  };

  return {
    connector,
    /** Test helpers simulating changes made in the ERP. */
    control: {
      requestCount: () => requestCount,
      failNextRequests(count: number) {
        transientFailures = count;
      },
      upsert(
        dataAreaId: string,
        entityName: string,
        keyField: string,
        record: ErpRecord,
      ) {
        const rows = rowsOf(dataAreaId, entityName);
        const index = rows.findIndex(
          (row) => row[keyField] === record[keyField],
        );
        const next = {
          dataAreaId,
          ...(index >= 0 ? rows[index] : {}),
          ...record,
        };
        if (index >= 0) rows[index] = next;
        else rows.push(next);
      },
      remove(
        dataAreaId: string,
        entityName: string,
        keyField: string,
        key: unknown,
      ) {
        const rows = rowsOf(dataAreaId, entityName);
        const index = rows.findIndex((row) => row[keyField] === key);
        if (index >= 0) rows.splice(index, 1);
      },
    },
  };
};
