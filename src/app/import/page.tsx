import { ImportForm } from "@/components/import-form";
import { SignInPrompt } from "@/components/states";
import { getCurrentUser } from "@/server/auth";
import { can } from "@/server/policy";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Import the daily file</h1>
        <p className="text-sm text-muted-foreground">
          Upload the clients&apos; disputes CSV, preview every row, then confirm. Rows with a full card number are rejected and never stored.
        </p>
      </div>
      <ImportForm key={user.id} canImport={can(user, "dispute:import")} />
    </div>
  );
}
