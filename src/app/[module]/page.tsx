import { assignmentBoard } from "../../features/assignments/board";
import { redirect, notFound } from "next/navigation";
import { requirePrincipal } from "../../server/auth";
import { listModule } from "../../server/queries";
import { Workspace } from "../../components/workspace";
import { AppError } from "../../server/policy";
export const dynamic = "force-dynamic";
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { module } = await params;
  let p;
  try {
    p = await requirePrincipal();
  } catch (e) {
    if (
      e instanceof AppError &&
      e.status === 403 &&
      e.message.includes("Zwei-Faktor")
    )
      redirect("/security");
    redirect("/login");
  }
  const q = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(q))
    if (typeof value === "string") query.set(key, value);
  let initialData;
  try {
    initialData =
      module === "assignments" && p.role !== "DRIVER"
        ? await assignmentBoard(p, query)
        : await listModule(p, module, query);
  } catch (e) {
    if (e instanceof AppError && [403, 404].includes(e.status)) notFound();
    if (e instanceof AppError && e.status === 400) {
      initialData = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        error: e.message,
      };
    } else throw e;
  }
  return (
    <Workspace
      initialQuery={query.toString()}
      principal={p}
      module={module}
      initialData={JSON.parse(JSON.stringify(initialData))}
    />
  );
}
