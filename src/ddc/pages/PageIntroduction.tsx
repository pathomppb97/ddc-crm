import { useLocation } from "react-router";
import type { WorkspacePage } from "./catalog";
import { PageContent } from "./WorkspacePageView";

const introductions = import.meta.glob<WorkspacePage>(
  "./introductions/*.json",
  {
    eager: true,
    import: "default",
  },
);

export function PageIntroduction() {
  const { pathname } = useLocation();
  const key = pathname.replace(/^\/|\/$/g, "") || "dashboard";
  const entry = introductions[`./introductions/${key}.json`];
  return entry ? <PageContent page={entry} /> : null;
}
