# Calculation Methodology — DDC Agriculture 2027

1. **Net Revenue Recognition (Ex-VAT):** ERP column `Total` already equals `(Quantity × UnitPrice) − LineTotalDiscountAmount` and excludes 7% VAT. Credit Notes (`CN...`, `CB...`, negative qty/value) are preserved in net actuals (`6,285,889.60 THB` across 125 lines, matching ERP Row 127 to `0.00 THB`). Bottom summary rows (`R127` in invoices, `R32` in SO) are excluded.
2. **Agriculture Scope Filter:** All `540` non-Agriculture lines (motorcycle sprockets `01/02/03` series & automotive OEM stampings `1CA/1TS/1MU/1AB/1TH`) are excluded from `Update_SO.xlsx`. Shear Plates (`1DD176xx`, `1DD17001-02`) are classified prior to Base Cutter Blades.
3. **ABC–XYZ & RFM Classification:**
   - **ABC:** Pareto cumulative revenue (`A <= 80.5%`, `B <= 95.5%`, `C > 95.5%`).
   - **XYZ:** Monthly coefficient of variation `CV = std / mean` across M1–M10 (`X: CV<0.75 & >=5 active mos`, `Y: CV<1.5 & >=3 mos`, `Z: intermittent`).
   - **RFM & Concentration:** Quintile scores (1–5) on Recency (days since Oct 31, 2026), Frequency (distinct positive invoices), and Monetary (Net Rev). Herfindahl–Hirschman Index `HHI = SUM((Share_i * 100)^2) = 812`.
4. **Statistical Forecasting & Chronological Backtesting:**
   - Strict time-ordered splits (`Train M1–M7 → Test M8–M10` for 10M Actuals; `Train M1–M9 → Test M10–M12` for Full-2026 Actual+SO) — zero future leakage.
   - Models evaluated: Historical Average, MA-3, WMA-3, Simple Exponential Smoothing (grid-optimized α), Holt's Damped Trend, Linear Trend (damped), Exogenous Sugarcane Industry-Cycle Seasonal Index, and **Croston-SBA / TSB** for intermittent spare parts.
   - Accuracy metrics: `MAE = mean(|ŷ - y|)`, `RMSE = sqrt(mean((ŷ - y)^2))`, `WAPE = sum(|ŷ - y|)/sum(|y|)`, `Bias = sum(ŷ - y)/sum(|y|)`. MAPE is omitted whenever test actuals contain zeros.
5. **Packing-Constrained Integer Budget Optimizer:**
   - Base Cutter 4.0mm = multiples of `25 pcs/box`; 4.5mm & 5.0mm = multiples of `20 pcs/box`; Fan Blade = integer `Sets`; other SKUs = integer units.
   - Annual SKU boxes are allocated across 12 months via largest-remainder seasonal distribution (3 Waves: W1 Consumables, W2 Chopper ramp, W3 Overhaul starting Apr 2027), followed by discrete integer step tuning to minimize `|SUM(Qty × Price) − Target|` strictly preserving `MOD(Qty, PackSize) = 0` on every SKU × Month cell (`0` violations across all 3 scenarios; variances `+3.30`, `-30.95`, `+46.15 THB`).
6. **Financial & Decision Modeling:**
   - `Net Revenue = Gross Sales × (1 − 2% Warranty)`; `COGS = SUM(Qty × Audited C_std)`; `Contribution Margin = Gross Profit − 35% Selling/Logistics`; `Break-Even = Fixed Costs / CM Ratio`; `ROIC = NOPAT / (Hybrid CapEx + Peak WC)`.
   - Weighted Decision Matrix uses `SUMPRODUCT(Weight, Score)` on a 1–5 scale where `5 = best` across all 7 criteria including lower investment and lower risk, tested across 4 alternative weighting schemes + Fatal Veto check.
