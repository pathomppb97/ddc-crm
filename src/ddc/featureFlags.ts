/** Enable the ERP workspace explicitly when the integration phase begins. */
export const ERP_ENABLED = import.meta.env.VITE_ENABLE_ERP === "true";

/** Keep ERP contracts and stored data while hiding their application surfaces. */
export const isResourceEnabled = (name: string) =>
  ERP_ENABLED || !name.startsWith("erp_");

export const requireErpEnabled = () => {
  if (!ERP_ENABLED) throw new Error("ERP integration is disabled");
};
