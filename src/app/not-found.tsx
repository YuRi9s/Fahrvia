import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <h1>Seite nicht verfügbar</h1>
      <p>
        Diese Seite existiert nicht oder ist für Ihr Konto nicht freigegeben.
      </p>
      <Link href="/dashboard">Zum Dashboard</Link>
    </main>
  );
}
