import { useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { workspacePages, type WorkspacePage } from "./catalog";

export function WorkspacePageView() {
  const { slug } = useParams();
  const page = workspacePages.find((entry) => entry.slug === slug);
  if (!page) return <p className="py-8">ไม่พบหน้านี้ / Page not found</p>;
  return <PageContent page={page} />;
}

export function PageContent({ page }: { page: WorkspacePage }) {
  return (
    <article className="space-y-5 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{page.title}</h1>
        {page.description && (
          <p className="mt-2 whitespace-pre-line text-muted-foreground">
            {page.description}
          </p>
        )}
      </header>
      {page.sections.map((section, index) => (
        <Card key={index}>
          <CardHeader>
            <CardTitle>{section.heading}</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap">
            {section.body}
          </CardContent>
        </Card>
      ))}
    </article>
  );
}
