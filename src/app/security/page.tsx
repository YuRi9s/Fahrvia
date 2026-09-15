import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../server/auth";
import { SecuritySetup } from "../../components/security-setup";
export const dynamic = "force-dynamic";
export default async function SecurityPage() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return <SecuritySetup />;
}
