"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { de } from "@/messages/de";
export function LoginForm({ token = "" }: { token?: string }) {
  const [mode, setMode] = useState<
    "login" | "request" | "reset" | "mfa" | "recovery"
  >(token ? "reset" : "login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(e.currentTarget);
    try {
      const result =
        mode === "request"
          ? await authClient.requestPasswordReset({
              email: String(data.get("email")),
              redirectTo: `${window.location.origin}/login`,
            })
          : mode === "reset"
            ? await authClient.resetPassword({
                newPassword: String(data.get("password")),
                token,
              })
            : mode === "recovery"
              ? await authClient.twoFactor.verifyBackupCode({
                  code: String(data.get("code")),
                })
              : mode === "mfa"
                ? await authClient.twoFactor.verifyTotp({
                    code: String(data.get("code")),
                  })
                : await authClient.signIn.email({
                    email: String(data.get("email")),
                    password: String(data.get("password")),
                  });
      if (result.error) {
        setError(de.error);
        return;
      }
      if (mode === "request") {
        setNotice(de.resetSent);
      } else if (mode === "reset") {
        window.history.replaceState(null, "", "/login");
        setMode("login");
        setNotice(de.saved);
      } else if (
        mode === "login" &&
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      ) {
        setMode("mfa");
      } else {
        window.location.assign("/dashboard");
      }
    } catch {
      setError(de.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-brand">
        <Link href="/login" className="brand">
          <span className="logo-mark">F</span>
          {de.brand}
        </Link>
        <div>
          <p className="eyebrow">{de.operations}</p>
          <h1>{de.tagline}</h1>
          <p>{de.private}</p>
        </div>
        <span className="login-art" aria-hidden="true">
          F
        </span>
      </section>
      <section className="login-content">
        <form className="login-form" onSubmit={submit}>
          <p className="eyebrow">{de.brand}</p>
          <h1>
            {mode === "login"
              ? de.loginIntro
              : mode === "mfa"
                ? de.mfa
                : de.resetSave}
          </h1>
          <p className="muted">{de.loginDescription}</p>
          {["login", "request"].includes(mode) && (
            <label>
              {de.email}
              <input type="email" name="email" autoComplete="email" required />
            </label>
          )}
          {["login", "reset"].includes(mode) && (
            <label>
              {mode === "reset" ? de.newPassword : de.password}
              <input
                type="password"
                name="password"
                autoComplete={
                  mode === "reset" ? "new-password" : "current-password"
                }
                minLength={mode === "reset" ? 12 : undefined}
                required
              />
            </label>
          )}
          {mode === "mfa" && (
            <label>
              {de.mfa}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </label>
          )}
          {mode === "recovery" && (
            <label>
              Wiederherstellungscode
              <input
                name="code"
                autoComplete="one-time-code"
                required
                maxLength={100}
              />
            </label>
          )}
          {["mfa", "recovery"].includes(mode) && (
            <button
              type="button"
              onClick={() => {
                setMode(mode === "mfa" ? "recovery" : "mfa");
                setError("");
              }}
            >
              {mode === "mfa"
                ? "Wiederherstellungscode verwenden"
                : "Authenticator-Code verwenden"}
            </button>
          )}
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="alert">
              {notice}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? de.loading
              : mode === "request"
                ? de.resetSend
                : mode === "reset"
                  ? de.resetSave
                  : mode === "mfa"
                    ? de.mfaVerify
                    : de.signIn}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode(mode === "login" ? "request" : "login");
              setError("");
              setNotice("");
            }}
          >
            {mode === "login" ? de.reset : de.backLogin}
          </button>
        </form>
      </section>
    </main>
  );
}
