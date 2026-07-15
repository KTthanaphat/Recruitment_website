"use client";

import { LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { clearStoredSupabaseSession, hasSupabaseConfig, supabase, withAuthTimeout } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Sign in with your recruitment tracking account.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    withAuthTimeout(supabase.auth.getSession(), "Session check timed out.")
      .then(({ data }) => {
        if (data.session) router.replace("/home");
      })
      .catch(() => {
        clearStoredSupabaseSession();
        if (active) setStatus("Your previous session could not be restored. Please sign in again.");
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@")) {
      setStatus("Please sign in with your email address, not your nickname.");
      return;
    }

    setBusy(true);
    setStatus("Signing in...");
    try {
      const signInResult = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email: trimmedEmail, password }),
        "Login request timed out. Please check your network and Supabase project.",
        15000
      );

      if (signInResult.error) {
        setStatus(signInResult.error.message);
        return;
      }

      router.replace("/home");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[linear-gradient(180deg,#FAFAFC_0%,#F1F5F9_100%)] px-4 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-[#C9D5E6] bg-white shadow-[0_24px_70px_rgba(11,19,43,0.12)]">
        <div className="h-1.5 bg-navy" />
        <div className="p-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-slate">Internal Recruitment</p>
        <h1 className="mb-2 text-3xl font-semibold tracking-normal text-navy">Recruitment Tracking</h1>
        <p role="status" aria-live="polite" aria-busy={busy} className={`mb-5 text-sm font-medium ${status.includes("Invalid") || status.includes("not") ? "text-orange" : "text-slate"}`}>
          {hasSupabaseConfig ? status : "Supabase environment variables are not configured."}
        </p>

        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Email">
            <TextInput
              type="email"
              inputMode="email"
              value={email}
              autoComplete="email"
              spellCheck={false}
              required
              onChange={(event) => setEmail(event.target.value)}
              placeholder="recruiter@example.com"
            />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Account password"
            />
          </Field>
          <Button
            type="submit"
            disabled={busy || !hasSupabaseConfig}
            icon={busy ? <LockKeyhole size={17} /> : <Mail size={17} />}
          >
            Sign In
          </Button>
        </form>
        </div>
      </section>
    </main>
  );
}
