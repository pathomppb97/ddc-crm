import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportReferenceData } from "../../scripts/ddc-export-reference-data";

describe("evaluation mode reference data", () => {
  it("matches what the migrations seed (run npm run ddc:export-reference-data when it fails)", async () => {
    const committed = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "src/ddc/demo/referenceData.json"),
        "utf8",
      ),
    );

    expect(JSON.parse(JSON.stringify(await exportReferenceData()))).toEqual(
      committed,
    );
  });
});
