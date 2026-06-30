"use client";

import { LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { hasSupabaseConfig, supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Sign in with your recruitment tracking account.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard");
    });
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
      const signInResult = await Promise.race([
        supabase.auth.signInWithPassword({ email: trimmedEmail, password }),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("Login request timed out. Please check your network and Supabase project.")), 15000)
        )
      ]);

      if (signInResult.error) {
        setStatus(signInResult.error.message);
        return;
      }

      router.replace("/dashboard");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-offwhite px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-[#D7DEE8] bg-white p-6 shadow-panel">
        <p className="mb-1 text-xs font-extrabold uppercase tracking-normal text-slate">Internal Recruitment</p>
        <h1 className="mb-2 text-3xl font-extrabold tracking-normal text-navy">Recruitment Tracking</h1>
        <p className={`mb-5 text-sm font-bold ${status.includes("Invalid") || status.includes("not") ? "text-orange" : "text-slate"}`}>
          {hasSupabaseConfig ? status : "Supabase environment variables are not configured."}
        </p>

        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Email">
            <TextInput
              type="text"
              inputMode="email"
              value={email}
              autoComplete="email"
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
      </section>
    </main>
  );
}
