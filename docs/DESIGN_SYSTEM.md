# DDC Agriculture CRM — Shared UI & Design System

> **Shared Package**: `packages/shared-ui/`
> **Consumers**: CRM Web Application (`src/`) & Independent Admin Control Center (`apps/admin-control-center/`)

---

## 1. Visual Foundations

### Typography
- **Primary Thai + Latin Sans**: `"IBM Plex Sans Thai", "Inter Variable", system-ui, -apple-system, sans-serif`
- **Monospace (IDs, Part Numbers, SHAs, Request IDs)**: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- **Tabular Numerals**: Always apply `tabular-nums` to KPIs, currency amounts, quantities, percentages, and table metrics.

### Semantic Color Tokens (Light & Dark Mode)
| Token | Role | Default Light | Default Dark |
|---|---|---|---|
| `--ddc-brand-primary` | Primary action, active nav, brand accent | `#0f4c3a` (DDC Agriculture Emerald) | `#22c55e` |
| `--ddc-brand-secondary` | Secondary accent / industrial slate | `#1e293b` | `#94a3b8` |
| `--ddc-surface` | Main canvas background | `#f8fafc` | `#0b1120` |
| `--ddc-card` | Elevated card/table surface | `#ffffff` | `#0f172a` |
| `--ddc-border` | Structural hairline dividers | `#e2e8f0` | `#1e293b` |
| `--ddc-success` | Healthy, published, approved, won | `#15803d` | `#4ade80` |
| `--ddc-warning` | Pending approval, scheduled, retrying | `#b45309` | `#fbbf24` |
| `--ddc-danger` | Error, failed, kill-switch, destructive | `#b91c1c` | `#f87171` |
| `--ddc-info` | Draft, running, telemetry highlight | `#0369a1` | `#38bdf8` |

Theme colors are overridable via validated `ui_config_versions` (Phase 6) without code redeployment, while maintaining WCAG AA contrast (minimum `4.5:1` for body text, `3:1` for large text and UI boundaries).

---

## 2. Core Enterprise UI Patterns

The Field Visit new-customer form uses linked, searchable province and
district controls. Selecting a different province clears the district.
Search accepts Thai and English names, and the existing draft stores Thai
location names when a choice is made. Legacy draft text remains readable.
The bundled data is from [GeoThai v2026.10.23](https://github.com/GeoThai/data/releases/tag/v2026.10.23)
and is available on LAN without a third-party runtime request. See
[`NOTICE`](../public/reference/geoThai/NOTICE) and
[`LICENSE`](../public/reference/geoThai/LICENSE) for attribution and terms.

1. **Responsive Layout Shell**:
   - Collapsible left sidebar on desktop (`>= 1024px`), slide-over drawer on tablet/mobile.
   - Sticky top header (`h-14`) with global search, environment badge (`DEV` / `STAGING` / `PROD`), locale switcher (`TH` / `EN`), notifications, and user menu.
   - CRM preserves mobile bottom bar for Field Sales workflows (`FieldVisitPage`, `VisitTimelinePage`, `PartCatalogPage`).
2. **Enterprise Data Tables**:
   - Server-driven pagination, multi-column sort indicators, column visibility toggles, sticky headers, empty states, loading skeletons, and CSV/Excel export trigger.
3. **Advanced Filter & Query Composer Bar**:
   - Typed operator dropdowns bound strictly to allowlisted columns, active filter chips, and Save View action.
4. **Confirmation & Destructive Action Dialogs**:
   - Standard two-step confirmation modal (`ConfirmActionDialog`) displaying action scope, affected entity/environment, optional typed confirmation phrase (e.g. `PRODUCTION` or flag key), and mandatory audit reason input for high-impact operations.
5. **Status Badges & Lifecycle Pills**:
   - Uniform mapping across Quotations, UI Config Versions, Feature Flags, Releases, Deployments, and Background Jobs.
6. **Timezone & Locale Formatting (`packages/shared-ui/src/formatters.ts`)**:
   - All timestamps stored as UTC ISO-8601 and displayed in **`Asia/Bangkok` (ICT, UTC+7)** via `formatBangkokDateTime(iso, locale)`.
   - All monetary values formatted with explicit currency code (`THB`, `USD`, etc.) and never summed across currencies or across value categories (estimated vs. quoted vs. ERP confirmed).

---

## 3. Accessibility Checklist
- Semantic landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`), single `<h1>` per page.
- Visible keyboard focus rings (`focus-visible:ring-2`), `Esc` closes modals/drawers, full keyboard navigation in menus and dialogs.
- `aria-label` on icon-only buttons, `aria-live="polite"` for toast notifications, `role="alert"` for destructive warnings.
