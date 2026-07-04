import { redirect } from "next/navigation";
import { getSpaces } from "@/lib/db/pages";

export const dynamic = "force-dynamic";

export default async function Home() {
  const spaces = await getSpaces();
  const first = spaces[0];

  if (first) {
    redirect(`/${first.slug}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm opacity-60">
        No spaces exist yet. Seed the database with a School and Work space to
        get started.
      </p>
    </main>
  );
}
