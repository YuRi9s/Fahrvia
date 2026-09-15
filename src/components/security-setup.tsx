"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { de } from "@/messages/de";
export function SecuritySetup() {
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (setup) {
        const result = await authClient.twoFactor.verifyTotp({
          code: String(form.get("code")),
        });
        if (result.error) throw new Error(de.error);
        setVerified(true);
      } else {
        const result = await authClient.twoFactor.enable({
          password: String(form.get("password")),
          issuer: de.brand,
        });
        if (result.error || !result.data || !("totpURI" in result.data))
          throw new Error(de.error);
        setSetup(result.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
    } finally {
      setBusy(false);
    }
  }
  const secret = setup ? new URL(setup.totpURI).searchParams.get("secret") : "";
  return (
    <main className="security-page">
      <Link className="brand" href="/dashboard">
        <span className="logo-mark">F</span>
        {de.brand}
      </Link>
      <section className="panel security-panel">
        <p className="eyebrow">{de.security}</p>
        <h1>{de.securityTitle}</h1>
        <p className="muted">{de.securityDescription}</p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {verified ? (
          <>
            <p className="alert" role="status">
              {de.securityEnabled}
            </p>
            <Link className="button primary" href="/dashboard">
              {de.continueWorkspace}
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="security-form">
            {setup ? (
              <>
                <p>{de.authenticatorInstructions}</p>
                <label>
                  {de.setupKey}
                  <input
                    value={secret || ""}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                <label>
                  {de.mfa}
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </label>
              </>
            ) : (
              <label>
                {de.password}
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy ? de.loading : setup ? de.mfaVerify : de.securityStart}
            </button>
          </form>
        )}
        {setup && (
          <section className="backup-codes">
            <h2>{de.backupCodes}</h2>
            <p className="muted">{de.backupInstructions}</p>
            <pre>{setup.backupCodes.join("\n")}</pre>
          </section>
        )}
        <button
          className="text-button"
          onClick={async () => {
            await authClient.signOut();
            window.location.assign("/login");
          }}
        >
          {de.logout}
        </button>
      </section>
    </main>
  );
}
