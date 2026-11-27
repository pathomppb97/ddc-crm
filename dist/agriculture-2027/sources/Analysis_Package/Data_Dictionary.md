# Data Dictionary — DDC Agriculture 2027 Analysis Package

| File | Granularity | Key Fields | Data Class |
|---|---|---|---|
| `cleaned_data/sales_actual_2026_jan_oct_clean.csv` | 125 ERP Invoice Lines | `InvoiceDate`, `InvoiceNumber`, `CustomerCode`, `ItemCode`, `ProductGroup`, `Unit`, `PackingSize`, `Quantity`, `UnitPrice_ExVAT`, `Discount`, `NetRevenue_ExVAT`, `IsCreditNote`, `True_Region`, `BusinessType` | Actual (Ex-VAT) |
| `cleaned_data/open_so_agri_unified_clean.csv` | 47 Deduplicated Agri SO Lines | `SalesOrder`, `CustomerCode`, `ItemCode`, `ProductGroup`, `ShipDate`, `OpenQty`, `Price_ExVAT`, `Value_ExVAT`, `PriceStatus`, `PeriodGroup` | Confirmed Order / Unpriced Est |
| `cleaned_data/customer_pipeline_129_clean.csv` | 129 Surveyed Accounts | `Company`, `CustomerType`, `True_Region`, `Province`, `Fleet_Count`, `BC_Annual_Demand_Pcs`, `PO_25_26_Pcs`, `PO_26_27_Pcs` | Field Survey Pipeline |
| `cleaned_data/product_sku_master_clean.csv` | 44 Agriculture SKUs | `ItemCode`, `ProductGroup`, `Unit`, `PackingSize`, `Weighted_ASP_2026_ExVAT`, `Audited_Unit_Cost_THB`, `Cost_Source` | Master + Audited Cost |
| `forecast_results/phase5_backtest_model_comparison.csv` | 46 Model×Group Runs | `Product_Group`, `Model`, `Train_Period`, `Test_Period`, `MAE`, `RMSE`, `WAPE_Pct`, `MAPE_Pct`, `Bias_Pct`, `Selected_Model` | Statistical Backtest |
| `cleaned_data/phase6_scenario_{60M,80M,100M}_monthly_sku.csv` | 21 SKUs × 12 Months | `Product_Code`, `Packing_Size`, `Unit_Price_ExVAT`, `Audited_Unit_Cost`, `Jan..Dec_Qty`, `Jan..Dec_Rev`, `Packing_Check`, `TAM_Share_Pct` | Target Budget (Packing Verified) |
| `cleaned_data/phase7_financial_proforma.csv` | 4 Financial Cases | `Gross_Sales_THB`, `Net_Revenue_THB`, `COGS_Audited_THB`, `Gross_Profit_THB`, `EBITDA_THB`, `Net_Profit_NOPAT_THB`, `Break_Even_Sales_THB`, `ROIC_Incl_WC_Pct` | Pro-Forma Financial Model |
| `cleaned_data/phase8_decision_matrix.csv` | 7 Weighted Criteria | `Criteria`, `Proposed_Weight_Pct`, `Score_60M/80M/100M`, `Weighted_60M/80M/100M` | Decision Matrix |
