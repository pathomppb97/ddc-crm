import { memoryStore } from "ra-core";
import { createAuthProvider } from "@/components/atomic-crm/providers/fakerest/authProvider";
import { CRM } from "@/components/atomic-crm/root/CRM";
import { ddcConfiguration } from "@/ddc/config";
import { generateDdcDemoData } from "@/ddc/demo/generateDemoData";
import { openLocalWorkspace } from "@/ddc/providers/localWorkspace";

const startup = await openLocalWorkspace(
  generateDdcDemoData(),
  "public-synthetic-v1",
  "ddc-crm-public-synthetic-v1",
)
  .then((provider) => ({ provider, error: null }))
  .catch((error: unknown) => ({
    provider: null,
    error: error instanceof Error ? error.message : String(error),
  }));

const App = () =>
  startup.provider ? (
    <CRM
      {...ddcConfiguration}
      title="DDC CRM Public Demo"
      dataProvider={startup.provider}
      authProvider={createAuthProvider(startup.provider)}
      store={memoryStore()}
    />
  ) : (
    <main className="mx-auto max-w-2xl p-8" role="alert">
      <h1 className="text-xl font-semibold">
        Local CRM storage needs attention
      </h1>
      <p className="mt-4">{startup.error}</p>
      <p className="mt-4">
        Keep this browser profile and use the same CRM address to access saved
        demo records.
      </p>
    </main>
  );

export default App;
