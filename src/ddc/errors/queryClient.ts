import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { logCrmError, shouldRetryCrmError } from "./crmError";

export const createDdcQueryClient = (): QueryClient =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const resource =
          typeof query.queryKey?.[0] === "string"
            ? query.queryKey[0]
            : undefined;
        logCrmError(error, { operation: "query", resource });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        logCrmError(error, { operation: "mutation" });
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          shouldRetryCrmError(error, failureCount),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
