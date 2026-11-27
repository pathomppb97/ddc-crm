# DDC Agriculture 2027 — Master Strategy, Business Plan & Sales Budget Package

## Folder Structure
- `../DDC_Agriculture_Sales_Budget_2027.xlsx` — **27-Sheet Dynamic Excel Model** (`00_Executive_Dashboard` to `26_Validation_Check`), 100% formula-driven, editable blue inputs, Scenario selector (`C4`), Packing checks, Excel COM verified zero errors.
- `../DDC_Agriculture_Business_Strategy_2027.pptx` — **30-Slide Board Presentation** built directly on official DDC `Template.pptx` with 12 high-DPI Thai data charts.
- `../DDC_Agriculture_Executive_Decision_Summary_2027.md` & `.pdf` — **1–2 Page Executive Decision Brief**.
- `Analysis_Package/`
  - `scripts/` — Full reproducible Python pipeline (`01` through `08`).
  - `cleaned_data/` — Audited CSVs (2026 Actuals, Deduplicated Agri SOs, 129 Pipeline, ABC-XYZ, RFM, Scenarios 60/80/100M, P&L, Decision Matrix).
  - `forecast_results/` — Chronological Backtest comparison & Independent 2027 Statistical Forecast CSVs/JSON.
  - `charts/` — 12 high-resolution PNG charts (240 DPI).
  - `slide_qa_previews/` — Exported PDF & PNG previews of all 30 slides for visual QA.
  - `Data_Dictionary.md`, `Calculation_Methodology.md`, `Strategy_Frameworks_20_Synthesis.md`, `Assumption_Register.csv`, `Source_Register.csv`, `Data_Gap_Register.csv`, `Validation_Report.md`.

## How to Update Monthly (2027 Operations)
1. Replace source ERP exports and re-run scripts `01` → `08` in order (`python scripts/01_data_audit_and_clean.py`, etc.).
2. In Excel (`DDC_Agriculture_Sales_Budget_2027.xlsx`), edit **blue input cells only** (`00_Executive_Dashboard!C4` to toggle Scenarios; `10/11/12` blue Qty/Price cells; `15_Financial_Analysis` OpEx/CapEx/WC; `17_Decision_Matrix` weights/scores). Verify `26_Validation_Check!F22 = ALL PASS`.
