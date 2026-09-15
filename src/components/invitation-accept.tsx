"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { request } from "./api";
import { valueLabel } from "@/messages/de";
type Preview = {
  name: string;
  email: string;
  role: string;
  organization: string;
  expiresAt: string;
};
export function InvitationAccept() {
  const [invitation, setInvitation] = useState<Preview | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const value = window.location.hash.slice(1);
    // Keep the bearer token in component memory; never send it in a navigation or browser storage.
    request<Preview>("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", token: value }),
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setInvitation(data);
        setToken(value);
        window.history.replaceState(null, "", "/invite");
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Die Einladung konnte nicht geprüft werden. Bitte den Link erneut öffnen.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <main className="login-layout">
      <section className="login-brand">
        <Link className="brand" href="/login">
          Fahriva
        </Link>
        <div>
          <p className="eyebrow">Gemeinsam unterwegs</p>
          <h1>Willkommen im Team.</h1>
          <p>Ihr persönlicher Zugang zu Fahriva.</p>
        </div>
      </section>
      <section className="login-content">
        <form
          className="login-form invitation-accept"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            if (form.get("password") !== form.get("confirm")) {
              setError("Die Passwörter stimmen nicht überein.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              await request("/api/invitations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "accept",
                  token,
                  password: form.get("password"),
                }),
              });
              setDone(true);
              setToken("");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Die Einladung konnte nicht angenommen werden.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h1>{done ? "Ihr Konto ist bereit." : "Einladung annehmen"}</h1>
          {!loaded && <p role="status">Einladung wird geprüft …</p>}
          {done ? (
            <>
              <p>Sie können sich jetzt mit Ihrer E-Mail-Adresse anmelden.</p>
              {invitation?.role === "ADMIN" && (
                <p>
                  Richten Sie nach der Anmeldung die
                  Zwei-Faktor-Authentifizierung ein.
                </p>
              )}
              <Link className="button primary" href="/login">
                Zur Anmeldung
              </Link>
            </>
          ) : (
            invitation && (
              <>
                <p>
                  <strong>{invitation.organization}</strong> lädt Sie als{" "}
                  {valueLabel(invitation.role)} ein.
                </p>
                <p>
                  {invitation.name}
                  <br />
                  {invitation.email}
                </p>
                <label>
                  Passwort
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={busy}
                  />
                </label>
                <p className="muted">Mindestens 12 Zeichen.</p>
                <label>
                  Passwort wiederholen
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={busy}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Konto wird erstellt …" : "Konto erstellen"}
                </button>
              </>
            )
          )}
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {!invitation && loaded && <Link href="/login">Zur Anmeldung</Link>}
        </form>
      </section>
    </main>
  );
}
