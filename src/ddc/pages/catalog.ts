export interface WorkspacePage {
  title: string;
  description: string;
  sections: { heading: string; body: string }[];
}

const files = import.meta.glob<WorkspacePage>("./content/*.json", {
  eager: true,
  import: "default",
});

export const workspacePages = Object.entries(files).map(([file, page]) => ({
  slug: file.slice("./content/".length, -".json".length),
  ...page,
}));
