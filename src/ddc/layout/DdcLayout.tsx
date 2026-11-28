import { createElement, Suspense, useState, type ReactNode } from "react";
import { useCanAccess, useTranslate, type CoreLayoutProps } from "ra-core";
import { ErrorBoundary } from "react-error-boundary";
import { Link, useMatch } from "react-router";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardPlus,
  Clock,
  Contact,
  Factory,
  Home,
  Kanban,
  LayoutDashboard,
  Package,
  PlugZap,
  Plus,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Error } from "@/components/admin/error";
import { Loading } from "@/components/admin/loading";
import { LocalesMenuButton } from "@/components/admin/locales-menu-button";
import { Notification } from "@/components/admin/notification";
import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useUserMenu } from "ra-core";
import { lanAccountsEnabled } from "@/ddc/providers/lanAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { DataImportProvider } from "@/components/atomic-crm/dataImport/DataImportProvider";
import { useConfigurationLoader } from "@/components/atomic-crm/root/useConfigurationLoader";
import { GlobalSearchButton } from "@/components/atomic-crm/search/GlobalSearchButton";
import { NotificationsBell } from "../features/NotificationsBell";
import { GROUP_LABELS, RESOURCE_DEFS } from "../resources/registry";
import type { Label, ResourceGroup } from "../resources/schema";
import { useLabel } from "../ui/labels";
import { DdcSearch } from "./DdcSearch";
import ddcLogo from "./ddc-logo.png";
import { ERP_ENABLED } from "../featureFlags";
import { workspacePages } from "../pages/catalog";
import { PageIntroduction } from "../pages/PageIntroduction";

interface NavItem {
  to: string;
  label: Label;
  icon: LucideIcon;
  /** Resource used for the access check */
  resource: string;
  action?: string;
}

const extraItems: Partial<Record<ResourceGroup | "home", NavItem[]>> = {
  home: [
    {
      to: "/",
      label: { th: "แดชบอร์ด", en: "Dashboard" },
      icon: LayoutDashboard,
      resource: "dashboard",
    },
    {
      to: "/field-visit",
      label: { th: "บันทึกเข้าพบลูกค้า", en: "Log customer visit" },
      icon: ClipboardPlus,
      resource: "activities",
    },
    {
      to: "/timeline",
      label: { th: "ไทม์ไลน์เข้าพบ (Log)", en: "Visit timeline (Log)" },
      icon: Clock,
      resource: "activities",
    },
    {
      to: "/companies",
      label: { th: "ลูกค้า (5 กลุ่ม)", en: "Customers (5 groups)" },
      icon: Building2,
      resource: "companies",
    },
    {
      to: "/catalog",
      label: { th: "แค็ตตาล็อกพาร์ท DDC", en: "DDC part catalog" },
      icon: Package,
      resource: "products",
    },
    {
      to: "/calendar",
      label: { th: "ปฏิทินกิจกรรม", en: "Activity calendar" },
      icon: CalendarDays,
      resource: "activities",
    },
  ],
  sales: [
    {
      to: "/deals",
      label: { th: "โอกาสการขาย (Kanban)", en: "Opportunities (Kanban)" },
      icon: Kanban,
      resource: "deals",
    },
  ],
  customers: [
    {
      to: "/contacts",
      label: { th: "ผู้ติดต่อ", en: "Contacts" },
      icon: Contact,
      resource: "contacts",
    },
  ],
  erp: [
    {
      to: "/erp-integration",
      label: { th: "การเชื่อมต่อ ERP", en: "ERP integration" },
      icon: PlugZap,
      resource: "erp_integration",
    },
  ],
  admin: [
    {
      to: "/sales",
      label: { th: "ผู้ใช้งาน", en: "Users" },
      icon: Users,
      resource: "sales",
    },
    {
      to: "/permissions",
      label: { th: "สิทธิ์ตามบทบาท", en: "Role permissions" },
      icon: ShieldCheck,
      resource: "role_permissions",
      action: "edit",
    },
    {
      to: "/settings",
      label: { th: "ตั้งค่า CRM", en: "CRM settings" },
      icon: Settings,
      resource: "configuration",
      action: "edit",
    },
    {
      to: "/import",
      label: { th: "นำเข้าข้อมูล JSON", en: "JSON data import" },
      icon: Upload,
      resource: "configuration",
      action: "edit",
    },
  ],
};

/** Menu order inside each group (resources not listed come last). */
const NAV_ORDER = [
  "leads",
  "activities",
  "action_items",
  "rfqs",
  "quotations",
  "companies",
  "dealer_networks",
  "product_hierarchy_nodes",
  "products",
  "machine_models",
  "product_machine_applications",
  "manufacturers",
  "brands",
  "erp_sales_orders",
  "erp_deliveries",
  "erp_invoices",
  "erp_inventory_availability",
  "erp_price_list_entries",
  "business_models",
  "territories",
  "pipelines",
  "master_options",
  "custom_field_definitions",
  "approval_rules",
  "audit_log",
];
const rank = (name: string) =>
  NAV_ORDER.indexOf(name) + 1 || NAV_ORDER.length + 1;

const GROUP_ORDER: ResourceGroup[] = [
  "sales",
  "customers",
  "products",
  "engineering",
  "service",
  "erp",
  "admin",
];

const itemsOf = (group: ResourceGroup): NavItem[] => [
  ...(extraItems[group] ?? []),
  ...RESOURCE_DEFS.filter((def) => def.group === group && !def.childOnly)
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((def) => ({
      to: `/${def.name}`,
      label: def.label.many,
      icon: def.icon ?? Factory,
      resource: def.name,
    })),
];

const NavLink = ({ item }: { item: NavItem }) => {
  const label = useLabel();
  const { setOpenMobile } = useSidebar();
  const { canAccess, isPending } = useCanAccess({
    resource: item.resource,
    action: item.action ?? "list",
  });
  const match = useMatch({ path: item.to, end: item.to === "/" });
  if (isPending || !canAccess) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to={item.to} onClick={() => setOpenMobile(false)} />}
        isActive={Boolean(match)}
        tooltip={label(item.label)}
      >
        {createElement(item.icon)}
        <span>{label(item.label)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

const NavGroup = ({ title, items }: { title?: string; items: NavItem[] }) => (
  <SidebarGroup>
    {title ? <SidebarGroupLabel>{title}</SidebarGroupLabel> : null}
    <SidebarGroupContent>
      <SidebarMenu>
        {items.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
);

const DdcSidebar = () => {
  const label = useLabel();
  const translate = useTranslate();
  const { setOpenMobile } = useSidebar();
  const [showBackoffice, setShowBackoffice] = useState(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/" aria-label="DDC CRM" />}
              className="font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
            >
              <img
                src={ddcLogo}
                alt=""
                width={288}
                height={84}
                className="h-auto w-16 shrink-0 group-data-[collapsible=icon]:w-7"
              />
              <span className="group-data-[collapsible=icon]:hidden">
                DDC CRM
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 pt-1 group-data-[collapsible=icon]:hidden">
          <Link
            to="/field-visit"
            onClick={() => setOpenMobile(false)}
            className={buttonVariants({
              size: "sm",
              className: "h-9 w-full justify-center font-semibold",
            })}
          >
            <Plus className="size-4" />
            {translate("ddc.field.quick_visit")}
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup
          title={translate("ddc.field.nav_section")}
          items={extraItems.home ?? []}
        />
        {workspacePages.length > 0 && (
          <NavGroup
            title={label({ th: "หน้าเพิ่มเติม", en: "Workspace pages" })}
            items={workspacePages.map((page) => ({
              to: `/pages/${page.slug}`,
              label: { th: page.title, en: page.title },
              icon: LayoutDashboard,
              resource: "dashboard",
            }))}
          />
        )}
        <div className="px-2 pt-2 group-data-[collapsible=icon]:hidden">
          <button
            type="button"
            onClick={() => setShowBackoffice((v) => !v)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <span>{translate("ddc.field.backoffice_section")}</span>
            {showBackoffice ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        </div>
        {showBackoffice &&
          GROUP_ORDER.filter((group) => ERP_ENABLED || group !== "erp").map(
            (group) => (
              <NavGroup
                key={group}
                title={label(GROUP_LABELS[group])}
                items={itemsOf(group)}
              />
            ),
          )}
      </SidebarContent>
    </Sidebar>
  );
};

const MobileBottomBar = () => {
  const translate = useTranslate();
  const isHome = Boolean(useMatch({ path: "/", end: true }));
  const isCompanies = Boolean(useMatch({ path: "/companies/*" }));
  const isCatalog = Boolean(useMatch({ path: "/catalog/*" }));
  const isTimeline = Boolean(useMatch({ path: "/timeline/*" }));

  const tabClass = (active: boolean) =>
    `flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition ${
      active ? "text-primary font-semibold" : "text-muted-foreground"
    }`;

  return (
    <nav
      aria-label="Field mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-16 items-center justify-around border-t bg-background/95 px-1 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Link to="/" className={tabClass(isHome)}>
        <Home className="size-5" />
        <span>{translate("ddc.field.mobile_home")}</span>
      </Link>
      <Link to="/companies" className={tabClass(isCompanies)}>
        <Building2 className="size-5" />
        <span>{translate("ddc.field.mobile_customers")}</span>
      </Link>
      <div className="flex flex-1 justify-center">
        <Link
          to="/field-visit"
          aria-label={translate("ddc.field.quick_visit")}
          className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition active:scale-95"
        >
          <Plus className="size-7" />
        </Link>
      </div>
      <Link to="/catalog" className={tabClass(isCatalog)}>
        <Package className="size-5" />
        <span>{translate("ddc.field.mobile_parts")}</span>
      </Link>
      <Link to="/timeline" className={tabClass(isTimeline)}>
        <Clock className="size-5" />
        <span>{translate("ddc.field.mobile_timeline")}</span>
      </Link>
    </nav>
  );
};

const UserMenuLink = ({
  to,
  icon,
  label,
}: {
  to: string;
  icon: LucideIcon;
  label: Label;
}) => {
  const text = useLabel();
  const menu = useUserMenu();
  return (
    <DropdownMenuItem
      onClick={menu?.onClose}
      render={<Link to={to} className="flex items-center gap-2" />}
    >
      {createElement(icon)}
      {text(label)}
    </DropdownMenuItem>
  );
};

const Header = () => {
  const translate = useTranslate();
  const { canAccess } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  return (
    <header
      className="sticky top-0 z-20 shrink-0 border-b bg-background/95 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 min-w-0 items-center gap-1 px-2 md:gap-2 md:px-4">
        <SidebarTrigger
          className="size-11 md:size-8 shrink-0"
          aria-label={translate("ra.action.open_menu")}
        />
        <Link
          to="/"
          className="mr-auto flex items-center gap-1.5 min-w-0 font-semibold md:hidden"
        >
          <img
            src={ddcLogo}
            alt=""
            width={288}
            height={84}
            className="h-5 w-auto shrink-0"
          />
          <span className="truncate text-sm">DDC CRM</span>
        </Link>
        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          <DdcSearch />
          <GlobalSearchButton />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <NotificationsBell />
          {import.meta.env.DEV &&
            canAccess &&
            ["localhost", "127.0.0.1"].includes(window.location.hostname) && (
              <a
                className="hidden rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted md:inline-flex"
                href="http://127.0.0.1:5178/"
                target="_blank"
                rel="noreferrer"
              >
                Page Admin
              </a>
            )}
          <LocalesMenuButton />
          <div className="hidden sm:flex items-center gap-1">
            <ThemeModeToggle />
            <RefreshButton />
          </div>
          <UserMenu>
            <UserMenuLink
              to={lanAccountsEnabled ? "/lan-account" : "/profile"}
              icon={UserRound}
              label={
                lanAccountsEnabled
                  ? { th: "บัญชี LAN Demo", en: "LAN Demo account" }
                  : { th: "โปรไฟล์ของฉัน", en: "My profile" }
              }
            />
          </UserMenu>
        </div>
      </div>
      <div className="border-t px-3 py-2 md:hidden">
        <DdcSearch />
      </div>
    </header>
  );
};

export const DdcLayout = ({
  children,
}: CoreLayoutProps & { children: ReactNode }) => {
  useConfigurationLoader();
  const [errorInfo, setErrorInfo] = useState<React.ErrorInfo | undefined>();
  return (
    <DataImportProvider>
      <SidebarProvider>
        <DdcSidebar />
        <div className="flex min-h-svh w-full min-w-0 flex-col">
          <Header />
          <main
            id="main-content"
            className="w-full min-w-0 max-w-screen-2xl flex-1 overflow-x-clip px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:px-4 md:pb-6"
          >
            <ErrorBoundary
              onError={(_, info) => setErrorInfo(info)}
              fallbackRender={({ error, resetErrorBoundary }) => (
                <Error
                  error={error}
                  errorInfo={errorInfo}
                  resetErrorBoundary={resetErrorBoundary}
                />
              )}
            >
              <Suspense fallback={<Loading />}>
                <PageIntroduction />
                {children}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        <MobileBottomBar />
        <Notification
          mobileOffset={{
            bottom: "calc(6.5rem + env(safe-area-inset-bottom))",
            left: "12px",
            right: "12px",
          }}
        />
      </SidebarProvider>
    </DataImportProvider>
  );
};
