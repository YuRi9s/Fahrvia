import { InvitationAccept } from "../../components/invitation-accept";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Einladung · Fahriva",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function InvitePage() {
  return <InvitationAccept />;
}
