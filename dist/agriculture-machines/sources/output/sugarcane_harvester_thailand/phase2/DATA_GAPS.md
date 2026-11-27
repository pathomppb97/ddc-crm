# Sugarcane Harvester Thailand Intelligence — Data Gaps Register
**Stage Gate Governance Document (Rule 10 Compliance)**  
**Document Reference:** `output/sugarcane_harvester_thailand/phase2/DATA_GAPS.md`  
**Standard:** Strict Boundary Separation & Zero-Hallucination Protocol  
**Audit Date:** September 2026  

---

## 1. Executive Summary of Intelligence Completeness

Phase 2 investigations have successfully established:
- **110 Empirical Customer Survey Leads** parsed and audited.
- **20 Verified Harvester Brands** cataloged with complete corporate ownership and local representation.
- **27 Verified Machine Models** operating in Thailand with detailed mechanical dimensions, kinematics, and field evidence.
- **135 Physical Fleet Records** accounting for 1,344 observed/reported machines across 28 sugar-producing provinces.
- **12 Comprehensive Subsystems** engineered with global vs. Thai field standards in `08_technical_specs.csv`.
- **42 Spare Parts Market Signals** capturing OEM part numbers, aftermarket sources, and Thai market pricing.

However, in accordance with **Rule 1 (Data Integrity)** and **Rule 10 (Stage Gate)** of `00_MASTER_RESEARCH_RULES.md`, all unverified parameters, ambiguous survey entries, and missing vendor CAD drawings must be formally registered as **Data Gaps** rather than estimated or assumed.

---

## 2. Active Data Gaps Register

| Gap ID | Category | Specific Parameter / Scope | Root Cause / Nature of Gap | Commercial & Engineering Impact | Remediation Plan & Next Action | Priority |
|:---|:---|:---|:---|:---|:---|:---:|
| **GAP-01** | Fleet Census | **55 Unspecified "CASE" Leads** in `Customer List.xlsx` | Survey respondents entered only "CASE" without specifying Austoft 8810, 8800, 8010, 4000, or 7000. | Unable to calculate exact model-specific market share for Case IH fleet at those 55 mills/contractors. | Dispatch field audit or phone survey to the 55 entities to photograph machine serial number plates. | **HIGH** |
| **GAP-02** | Part Numbers | **Chinese OEM Spare Part Numbers** (FM World 4GQ-180 & Zoomlion C600) | OEM parts catalogs are published in Chinese; Thai dealers have not released public English/Thai parts books. | Difficult to cross-reference Chinese OEM basecutter and chopper part numbers against Case/JD aftermarket parts. | Procure physical spare parts from FM World dealer in Khon Kaen and Zoomlion Bangna hub for reverse engineering. | **MEDIUM** |
| **GAP-03** | Metallurgy | **Chemical Composition & Microstructure of Pratco vs Sloop Blades** | Proprietary heat-treatment and alloy recipes (exact boron ppm, vanadium micro-alloying, quenching media). | Need exact chemical metallurgy to specify steel melt billets for DDC manufacturing (30MnB5 vs 27MnCrB5). | Perform Optical Emission Spectroscopy (OES) and micro-hardness profile testing on Pratco & Sloop sample blades. | **HIGH** |
| **GAP-04** | Serial Splits | **Austoft 8800 vs 8810 Hydraulic Component Transition Dates** | Chassis VIN splits between Gen 7 (8800) and Gen 8 (8810) involving Rexroth A10FM vs Danfoss motors. | Minor mounting bracket differences on basecutter gearbox and hydraulic cooler fittings. | Cross-reference CNH Industrial Electronic Parts Catalog (NGPC) with Thai dealer service bulletins. | **MEDIUM** |
| **GAP-05** | Pricing | **Wholesale Importer Landed Costs (CIF Bangkok)** | Tier-1 importers (AP Tyson, Paragon Machinery) keep confidential CIF pricing and dealer margin structures. | Aftermarket pricing strategy must benchmark against dealer wholesale gross margin (estimated 35-45%). | Interview independent spare parts importers and review Thai Customs import declarations under HS Code 8433.59. | **MEDIUM** |
| **GAP-06** | Fleet Census | **Single Unresolved Fleet Entry: "รถตัดอ้อยสันติ (กำแพงเพชร)"** | Customer List records 5 machines at Santi in Kamphaeng Phet without brand or model. | Low overall volume impact (5 units out of 1,344), but unresolved in canonical identity. | Physical inspection at Kamphaeng Phet contractor base during upcoming pre-season visit. | **LOW** |

---

## 3. Data Gap Impact on Downstream Business Planning Stages

- **Stage 03 (Part Identification & Metallurgy):** Impacted by GAP-03. Must perform laboratory spectrometry before finalizing steel procurement specs.
- **Stage 04 (Replacement Demand Modeling):** Minimally impacted; universal wear parts (5-hole discs, 3-hole 20° blades, CA550 chains) fit both 8810 and 8800 regardless of GAP-01 model split.
- **Stage 05 & 13 (Pricing & Competitor Benchmarking):** Impacted by GAP-05. Addressed via distributor retail price surveillance from CSC Machinery and Liang Mueang.

*Document certified under DDC Master Governance Standards.*
