import { CRM } from "@/components/atomic-crm/root/CRM";
import { ddcConfiguration } from "./ddc/config";

/** DDC CRM, backed by Supabase (see README.md). */
const App = () => <CRM {...ddcConfiguration} />;

export default App;
