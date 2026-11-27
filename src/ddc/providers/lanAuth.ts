import type { AuthProvider } from "ra-core";
import { defaultPermissionsFor } from "@/ddc/domain/defaultPermissions";
import { canAccessResource } from "@/ddc/domain/permissions";

export const lanAccountsEnabled = import.meta.env.VITE_LAN_ACCOUNTS === "true";

export interface LanAccount {
  id: number;
  username: string;
  roleKey: string;
  disabled: boolean;
}

export async function lanAccountRequest<T>(
  action: string,
  data?: object,
): Promise<T> {
  const response = await fetch(`/api/lan-accounts/${action}`, {
    credentials: "same-origin",
    ...(data && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as T;
}

export function createLanAuth() {
  let account: LanAccount | null = null;
  const getAccess = () => ({
    salesId: account?.id ?? null,
    administrator: account?.roleKey === "super_admin",
    roleKey: account?.roleKey ?? null,
    permissions: defaultPermissionsFor(account?.roleKey),
  });
  const refresh = async () => {
    try {
      account = await lanAccountRequest<LanAccount>("session");
      return account;
    } catch (error) {
      account = null;
      throw error;
    }
  };
  const authProvider: AuthProvider = {
    async login({ username, password }) {
      account = await lanAccountRequest<LanAccount>("login", {
        username,
        password,
      });
    },
    async logout() {
      await lanAccountRequest("logout", {});
      account = null;
    },
    async checkAuth() {
      await refresh();
    },
    checkError: async () => undefined,
    async getIdentity() {
      const user = account ?? (await refresh());
      return { id: user.id, fullName: user.username };
    },
    async canAccess(params) {
      if (!account) return false;
      return canAccessResource(getAccess(), params);
    },
  };
  return {
    authProvider,
    getAccess,
    getUser: () =>
      account && {
        id: account.id,
        administrator: account.roleKey === "super_admin",
        role_key: account.roleKey,
      },
  };
}
