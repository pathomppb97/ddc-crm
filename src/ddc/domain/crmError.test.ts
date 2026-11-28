import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyCrmError,
  clearRecentErrorLogs,
  formatUserErrorMessage,
  getRecentErrorLogs,
  logCrmError,
  shouldRetryCrmError,
} from "../errors/crmError";

describe("CRM error classification, retry policy, and structured logging", () => {
  beforeEach(() => {
    clearRecentErrorLogs();
  });

  it("classifies Undefined collection / schema errors as permanent non-retryable schema errors", () => {
    const err = new Error('Undefined collection "customer_source_rows"');
    err.name = "UndefinedResourceError";
    const info = classifyCrmError(err, { resource: "customer_source_rows" });

    expect(info.category).toBe("schema");
    expect(info.retryable).toBe(false);
    expect(info.requestId).toMatch(/^req_/);
    expect(shouldRetryCrmError(err, 0)).toBe(false);
    expect(shouldRetryCrmError(err, 1)).toBe(false);
    expect(formatUserErrorMessage(info, "th")).toContain("โครงสร้างข้อมูล");
    expect(formatUserErrorMessage(info, "th")).toContain(info.requestId);
  });

  it("classifies Postgres/PostgREST schema codes (PGRST205, 42P01) as permanent", () => {
    const err = Object.assign(new Error("Could not find the table"), {
      code: "PGRST205",
      status: 404,
    });
    const info = classifyCrmError(err);
    expect(info.category).toBe("schema");
    expect(info.retryable).toBe(false);
    expect(shouldRetryCrmError(err, 0)).toBe(false);
  });

  it("classifies 401/403 and RLS errors as non-retryable permission errors", () => {
    const err = Object.assign(
      new Error("permission denied for table companies"),
      {
        code: "42501",
        status: 403,
      },
    );
    const info = classifyCrmError(err);
    expect(info.category).toBe("permission");
    expect(info.retryable).toBe(false);
    expect(shouldRetryCrmError(err, 0)).toBe(false);
    expect(formatUserErrorMessage(info, "th")).toContain("ไม่มีสิทธิ์");
  });

  it("classifies 400/422/constraint errors as non-retryable validation errors", () => {
    const err = Object.assign(new Error("violates check constraint"), {
      code: "23514",
      status: 400,
    });
    const info = classifyCrmError(err);
    expect(info.category).toBe("validation");
    expect(info.retryable).toBe(false);
    expect(shouldRetryCrmError(err, 0)).toBe(false);
  });

  it("allows bounded retries (max 2) only for transient network errors", () => {
    const err = new TypeError("Failed to fetch");
    const info = classifyCrmError(err);
    expect(info.category).toBe("network");
    expect(info.retryable).toBe(true);
    expect(shouldRetryCrmError(err, 0)).toBe(true);
    expect(shouldRetryCrmError(err, 1)).toBe(true);
    expect(shouldRetryCrmError(err, 2)).toBe(false);
  });

  it("logs structured technical errors with correlation ID and deduplicates rapid repeats", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err1 = new Error('Undefined collection "customer_source_rows"');
      const err2 = new Error('Undefined collection "customer_source_rows"');
      const first = logCrmError(err1, {
        resource: "customer_source_rows",
        operation: "list",
      });
      const second = logCrmError(err2, {
        resource: "customer_source_rows",
        operation: "list",
      });

      const logs = getRecentErrorLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].requestId).toBe(first.requestId);
      expect(logs[0].count).toBe(2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(second.category).toBe("schema");
    } finally {
      spy.mockRestore();
    }
  });
});
