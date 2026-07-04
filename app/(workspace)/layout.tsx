import AppShell from "@/components/app-shell/AppShell";
import Sidebar from "@/components/sidebar/Sidebar";
import { getSpaces } from "@/lib/db/pages";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const spaces = await getSpaces();

  return (
    <AppShell
      sidebar={<Sidebar />}
      spaces={spaces.map(({ id, slug, name }) => ({ id, slug, name }))}
    >
      {children}
    </AppShell>
  );
}
