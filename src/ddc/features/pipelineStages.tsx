import { createContext, useContext, type ReactNode } from "react";
import { useGetList, useTranslate } from "ra-core";
import { useSearchParams } from "react-router";
import type { DealStage } from "@/components/atomic-crm/types";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext";
import { useDdcLocale } from "../ui/labels";

const PipelineStagesContext = createContext<DealStage[] | null>(null);

/** Stages of one pipeline, in the current language. */
export const usePipelineStages = (pipelineId: unknown): DealStage[] | null => {
  const locale = useDdcLocale();
  const { data } = useGetList(
    "pipeline_stages",
    {
      filter: { pipeline_id: pipelineId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "sort_order", order: "ASC" },
    },
    { enabled: pipelineId != null && pipelineId !== "" },
  );
  if (!data) return null;
  return data.map((stage) => ({
    value: stage.code,
    label: locale === "en" && stage.name_en ? stage.name_en : stage.name,
  }));
};

/** Stages of the pipeline being displayed, falling back to the CRM settings. */
export const useDealStages = (): DealStage[] => {
  const fromPipeline = useContext(PipelineStagesContext);
  const { dealStages } = useConfigurationContext();
  return fromPipeline?.length ? fromPipeline : dealStages;
};

export const PipelineStagesProvider = ({
  pipelineId,
  children,
}: {
  pipelineId: unknown;
  children: ReactNode;
}) => {
  const stages = usePipelineStages(pipelineId);
  return (
    <PipelineStagesContext.Provider value={stages}>
      {children}
    </PipelineStagesContext.Provider>
  );
};

/** Pipeline chosen for the Kanban board, kept in the URL (?pipeline=). */
export const useSelectedPipeline = () => {
  const [params, setParams] = useSearchParams();
  const { data: pipelines = [] } = useGetList("pipelines", {
    filter: { is_active: true },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "sort_order", order: "ASC" },
  });
  const selected =
    params.get("pipeline") ??
    String(pipelines.find((p) => p.is_default)?.id ?? pipelines[0]?.id ?? "");
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("pipeline", id);
    setParams(next, { replace: true });
  };
  return { pipelines, selected, select };
};

export const PipelineSelector = () => {
  const translate = useTranslate();
  const locale = useDdcLocale();
  const { pipelines, selected, select } = useSelectedPipeline();
  if (pipelines.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        {translate("resources.pipelines.name", { smart_count: 1 })}
      </span>
      <select
        className="h-8 rounded-md border bg-background px-2"
        value={selected}
        onChange={(e) => select(e.target.value)}
      >
        {pipelines.map((p) => (
          <option key={p.id} value={String(p.id)}>
            {locale === "en" && p.name_en ? p.name_en : p.name}
          </option>
        ))}
      </select>
    </label>
  );
};
