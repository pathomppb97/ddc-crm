import { describe, expect, it } from "vitest";
import {
  buildGoogleMapsUrl,
  computeCapacityTotals,
  computeEstimatedSeasonQty,
  extractCoordsFromText,
  inferCustomerGroupCode,
  toLineUrl,
  toTelHref,
  totalFleetVehicles,
} from "./fieldSales";

describe("fieldSales domain helpers", () => {
  it("infers 5 Agriculture customer groups from Thai names", () => {
    expect(inferCustomerGroupCode("โรงงานน้ำตาลตัวอย่าง")).toBe("sugar_mill");
    expect(inferCustomerGroupCode("อู่ซ่อมตัวอย่าง")).toBe("repair_shop");
    expect(inferCustomerGroupCode("ไร่ตัวอย่าง")).toBe("farm_owner");
    expect(inferCustomerGroupCode("ร้านอะไหล่ตัวอย่าง")).toBe("parts_shop");
    expect(inferCustomerGroupCode("ดีลเลอร์ตัวอย่าง")).toBe("dealer");
  });

  it("extracts DMS coordinates pasted into legacy Excel customer names and decimal URLs", () => {
    const dms = extractCoordsFromText(
      `Example location 17°30'00"N 100°15'00"E`,
    );
    expect(dms).not.toBeNull();
    expect(dms!.lat).toBeCloseTo(17.5, 4);
    expect(dms!.lng).toBeCloseTo(100.25, 4);

    const maps = extractCoordsFromText(
      "https://www.google.com/maps?q=17.5222,99.7555",
    );
    expect(
      extractCoordsFromText("Example location (17.5222, 99.7555)"),
    ).toEqual({ lat: 17.5222, lng: 99.7555 });

    expect(maps).toEqual({ lat: 17.5222, lng: 99.7555 });

    expect(buildGoogleMapsUrl(17.5222, 99.7555)).toBe(
      "https://www.google.com/maps?q=17.5222,99.7555",
    );
  });

  it("computes bidirectional fleet tonnage and seasonal part replacement estimates", () => {
    const vehicles = totalFleetVehicles([
      { brand: "Demo OEM A", model: "DEMO-1", count: 18 },
      { brand: "Demo OEM B", model: "DEMO-2", count: 20 },
      { brand: "Demo OEM C", model: "DEMO-3", count: 4 },
    ]);
    expect(vehicles).toBe(42);

    expect(
      computeCapacityTotals({
        totalVehicles: 42,
        tonsPerVehicle: null,
        totalTons: 720000,
        editedField: "totalTons",
      }),
    ).toEqual({ tonsPerVehicle: 17143, totalTons: 720000 });

    expect(
      computeCapacityTotals({
        totalVehicles: 4,
        tonsPerVehicle: 17500,
        totalTons: null,
        editedField: "tonsPerVehicle",
      }),
    ).toEqual({ tonsPerVehicle: 17500, totalTons: 70000 });

    // 70,000 tons / 350 tons per change * 10 blades = 2,000 blades/season
    expect(
      computeEstimatedSeasonQty({
        qtyPerChange: 10,
        intervalValue: 350,
        intervalUnit: "tons",
        totalTonsPerSeason: 70000,
        totalVehicles: 4,
      }),
    ).toBe(2000);

    // 2 sprockets per vehicle per season across 6 vehicles = 12/season
    expect(
      computeEstimatedSeasonQty({
        qtyPerChange: 2,
        intervalValue: 1,
        intervalUnit: "season",
        totalTonsPerSeason: null,
        totalVehicles: 6,
      }),
    ).toBe(12);
  });

  it("builds tel and LINE links cleanly", () => {
    expect(toTelHref("202-555-0100")).toBe("tel:2025550100");
    expect(toLineUrl("@example.test")).toBe(
      "https://line.me/ti/p/~example.test",
    );
  });
});
