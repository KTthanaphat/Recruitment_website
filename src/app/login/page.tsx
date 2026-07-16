"use client";

import { LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { translate } from "@/lib/i18n/dictionary";
import { siteAccentStyle } from "@/lib/site-theme";
import { clearStoredSupabaseSession, hasSupabaseConfig, supabase, withAuthTimeout } from "@/lib/supabase/client";
import type { Language } from "@/types/recruitment";

export default function LoginPage() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("en");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusKey, setStatusKey] = useState("loginHelp");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const savedLanguage = localStorage.getItem("recruitment_lang");
    if (savedLanguage === "en" || savedLanguage === "th") setLanguage(savedLanguage);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    withAuthTimeout(supabase.auth.getSession(), "Session check timed out.")
      .then(({ data }) => {
        if (data.session) router.replace("/home");
      })
      .catch(() => {
        clearStoredSupabaseSession();
        if (active) {
          setStatusKey("loginRestoreFailed");
          setStatusMessage(null);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  function toggleLanguage() {
    setLanguage((current) => {
      const next = current === "en" ? "th" : "en";
      localStorage.setItem("recruitment_lang", next);
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@")) {
      setStatusKey("loginInvalidEmail");
      setStatusMessage(null);
      return;
    }

    setBusy(true);
    setStatusKey("loginSigningIn");
    setStatusMessage(null);
    try {
      const signInResult = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email: trimmedEmail, password }),
        translate(language, "loginTimeout"),
        15000
      );

      if (signInResult.error) {
        setStatusMessage(signInResult.error.message);
        return;
      }

      router.replace("/home");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : translate(language, "loginUnknownError"));
    } finally {
      setBusy(false);
    }
  }

  const statusText = hasSupabaseConfig ? statusMessage ?? translate(language, statusKey) : translate(language, "loginNoConfig");

  return (
    <main className="grid min-h-screen place-items-center bg-[linear-gradient(180deg,#FAFAFC_0%,#F1F5F9_100%)] px-4 py-10" style={siteAccentStyle(null)}>
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-[#C9D5E6] bg-white shadow-[0_24px_70px_rgba(11,19,43,0.12)]">
        <div className="h-1.5 bg-navy" />
        <div className="p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-slate">{translate(language, "internalRecruitment")}</p>
            <h1 className="text-3xl font-semibold tracking-normal text-navy">{translate(language, "recruitmentTracking")}</h1>
          </div>
          <button type="button" className="min-h-8 rounded-md border border-[#D7DEE8] px-3 text-xs font-semibold text-navy hover:bg-[#F8FAFD] focus:outline-none focus:ring-2 focus:ring-primary/25" onClick={toggleLanguage}>
            {translate(language, "language")}
          </button>
        </div>
        <p role="status" aria-live="polite" aria-busy={busy} className={`mb-5 text-sm font-medium ${statusText.includes("Invalid") || statusText.includes("not") || statusText.includes("ไม่") ? "text-orange" : "text-slate"}`}>
          {statusText}
        </p>

        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label={translate(language, "email")}>
            <TextInput
              type="email"
              inputMode="email"
              value={email}
              autoComplete="email"
              spellCheck={false}
              required
              onChange={(event) => setEmail(event.target.value)}
              placeholder={translate(language, "recruiterEmailPlaceholder")}
            />
          </Field>
          <Field label={translate(language, "password")}>
            <TextInput
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
              placeholder={translate(language, "accountPasswordPlaceholder")}
            />
          </Field>
          <Button
            type="submit"
            disabled={busy || !hasSupabaseConfig}
            icon={busy ? <LockKeyhole size={17} /> : <Mail size={17} />}
          >
            {translate(language, "signIn")}
          </Button>
        </form>
        </div>
      </section>
    </main>
  );
}
