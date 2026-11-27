import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";
import { Navigate } from "react-router";

import type { CrmDataProvider } from "../providers/types";
import { LoginSkeleton } from "./LoginSkeleton";
import { LoginPage } from "./LoginPage";
import { disableEmailPasswordAuthentication } from "./authConfig";
import { lanAccountsEnabled } from "@/ddc/providers/lanAuth";

export const StartPage = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const {
    data: isInitialized,
    error,
    isPending,
  } = useQuery({
    queryKey: ["init"],
    queryFn: async () => {
      return dataProvider.isInitialized();
    },
    enabled: !lanAccountsEnabled,
  });

  if (lanAccountsEnabled) return <LoginPage />;
  if (isPending) return <LoginSkeleton />;
  if (error) return <LoginPage />;
  if (isInitialized) return <LoginPage />;
  if (disableEmailPasswordAuthentication) return <LoginPage />;

  return <Navigate to="/sign-up" />;
};
