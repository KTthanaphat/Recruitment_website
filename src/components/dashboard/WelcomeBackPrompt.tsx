"use client";

import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { dailyWelcomeMessage } from "@/lib/daily-messages";
import { formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { WelcomeSummary } from "@/lib/dashboard-summary-client";
import type { Language, Profile } from "@/types/recruitment";

export function WelcomeBackPrompt({
  language,
  open,
  profile,
  summary,
  loading,
  error,
  onClose,
  onPipeline,
  onRetry
}: {
  language: Language;
  open: boolean;
  profile: Profile | null;
  summary: WelcomeSummary | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPipeline: () => void;
  onRetry: () => void;
}) {
  const name = profile?.nickname ?? profile?.full_name ?? profile?.email ?? translate(language, "system");
  const title = translate(language, "welcomeBack");

  return (
    <Modal open={open} title={title} onClose={onClose} width="max-w-xl">
      {loading && summary ? <RefreshIndicator language={language} /> : null}{loading && !summary ? (
        <LoadingSkeleton variant="metrics" label={<>{translate(language, "loading")}</>} className="py-4 text-sm text-slate" />
      ) : error || !summary ? (
        <div role="alert" className="grid gap-3 py-2 text-sm text-danger">
          <p>{error || translate(language, "loadFailed")}</p>
          <div className="flex justify-end"><RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Welcome Back Prompt`} type="button"  onClick={onRetry}>{translate(language, "retry")}</RetryIconButton></div>
        </div>
      ) : (
        <WelcomeSummaryContent language={language} name={name} summary={summary} onClose={onClose} onPipeline={onPipeline} />
      )}
    </Modal>
  );
}

function WelcomeSummaryContent({ language, name, summary, onClose, onPipeline }: {
  language: Language;
  name: string;
  summary: WelcomeSummary;
  onClose: () => void;
  onPipeline: () => void;
}) {
  const fallbackMessage = translate(language, welcomeRatioMessageKey(summary.filledResponsibleVacancyBucket));
  const message = dailyWelcomeMessage({ language, ratio: summary.filledResponsibleVacancyRatio, name, fallback: fallbackMessage });
  const progressWidth = `${Math.min(summary.filledResponsibleVacancyRatio, 100)}%`;

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-lg border border-[#D7DEE8] bg-[#F8FBFF]">
        <div className="border-l-4 border-primary px-4 py-4">
          <p className="text-sm font-semibold leading-6 text-navy">{message}</p>
          <div className="mt-4 grid gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-slate">{translate(language, "welcomeFilledRatioLabel")}</p>
                <p className="mt-0.5 text-xs font-medium text-slate">
                  {translate(language, "welcomeFilledRatioHelper")
                    .replace("{filled}", formatNumber(summary.filledThisMonth, language))
                    .replace("{total}", formatNumber(summary.responsibleVacancyTotal, language))}
                </p>
              </div>
              <p className="text-2xl font-semibold tabular-nums text-navy">{formatNumber(summary.filledResponsibleVacancyRatio, language)}%</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#D7DEE8]" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: progressWidth }} />
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <WelcomeSummaryItem language={language} label={translate(language, "welcomeOpenRequisitions")} value={summary.openRequisitions} />
        <WelcomeSummaryItem language={language} label={translate(language, "welcomeOpenVacancy")} value={summary.openVacancy} />
        <WelcomeSummaryItem language={language} label={translate(language, "welcomeActiveCandidates")} value={summary.activeCandidates} />
        <WelcomeSummaryItem language={language} label={translate(language, "welcomeOfferFinalization")} value={summary.offerFinalizationNeeded} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-[#D7DEE8] pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>{translate(language, "close")}</Button>
        <Button type="button" onClick={onPipeline}>{translate(language, "viewPipeline")}</Button>
      </div>
    </div>
  );
}

function WelcomeSummaryItem({ language, label, value }: { language: Language; label: string; value: number }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-normal text-slate">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy">{formatNumber(value, language)}</p>
    </div>
  );
}

function welcomeRatioMessageKey(bucket: WelcomeSummary["filledResponsibleVacancyBucket"]) {
  return `welcomeFilledRatioMessage${bucket}` as const;
}
