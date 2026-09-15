"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>Die Seite konnte nicht geladen werden.</h1>
      <p>Bitte erneut versuchen. Ihre gespeicherten Daten bleiben erhalten.</p>
      <button onClick={reset}>Erneut versuchen</button>
    </main>
  );
}
