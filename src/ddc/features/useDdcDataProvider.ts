import { useDataProvider } from "ra-core";
import type { DdcDataMethods } from "../providers/types";

/** The data provider with the DDC business operations. */
export const useDdcDataProvider = () =>
  useDataProvider() as ReturnType<typeof useDataProvider> & DdcDataMethods;

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
