import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("SEC-04: Supabase MCP Edge Function zero raw-SQL enforcement", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "supabase/functions/mcp/index.ts"),
    "utf8",
  );

  it("never registers raw-SQL or schema-dumping tools (query, mutate, get_schema, execute_sql)", () => {
    expect(source).not.toMatch(/registerTool\(\s*["']query["']/);
    expect(source).not.toMatch(/registerTool\(\s*["']mutate["']/);
    expect(source).not.toMatch(/registerTool\(\s*["']get_schema["']/);
    expect(source).not.toMatch(/registerTool\(\s*["']execute_sql["']/);
    expect(source).not.toMatch(/registerTool\(\s*["']execute_shell["']/);
    expect(source).not.toContain("validateSql.ts");
  });

  it("enforces live policy checks, disabled-user blocking, and MCP execution logging", () => {
    expect(source).toContain("loadLiveCallerPolicy");
    expect(source).toContain("ACCOUNT_SUSPENDED");
    expect(source).toContain("MCP_ACCESS_DISABLED");
    expect(source).toContain("mcp_execution_logs");
  });
});
