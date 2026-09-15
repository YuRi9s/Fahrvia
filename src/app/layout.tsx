import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fahriva · Flottenmanagement",
  description: "Fahrer, Fahrzeuge und Betrieb an einem Ort.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
