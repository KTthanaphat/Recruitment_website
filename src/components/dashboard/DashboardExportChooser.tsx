"use client";
import { useCallback, useRef, useState } from "react";
import { Download, FileSpreadsheet, ImageDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDesktopInteractionLock } from "@/components/layout/DesktopInteractionContext";
import { Modal } from "@/components/ui/Modal";
import type { Language } from "@/types/recruitment";
import { translate } from "@/lib/i18n/dictionary";
export function DashboardExportChooser({ language, title, summary, pngLabel, disabled = false, onPng, onExcel }: {
    language: Language;
    title: string;
    summary: string;
    pngLabel: string;
    disabled?: boolean;
    onPng: () => Promise<void>;
    onExcel: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false), [busy, setBusy] = useState<"png" | "excel" | null>(null), [error, setError] = useState(false);
    useDesktopInteractionLock(open || busy !== null);
    const lock = useRef(false), close = useCallback(() => { if (!lock.current)
        setOpen(false); }, []);
    const th = language === "th", label = `${translate(language, "export")} ${title}`;
    async function run(format: "png" | "excel") {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(format);
        setError(false);
        try {
            await (format === "png" ? onPng() : onExcel());
            setOpen(false);
        }
        catch {
            setError(true);
        }
        finally {
            lock.current = false;
            setBusy(null);
        }
    }
    return <>
 <Button type="button" size="toolbar" variant="secondary" icon={<Download size={15}/>} aria-label={label} title={label} disabled={disabled || busy !== null} onClick={() => { setError(false); setOpen(true); }}>{translate(language, "export")}</Button>
 <Modal compactControls open={open} title={label} onClose={close} closeDisabled={busy !== null} closeLabel={th ? "ปิด" : "Close"} width="max-w-lg">
  <div className="dashboard-compact-controls grid min-w-0 gap-3" aria-busy={busy !== null}>
   <p className="break-words text-sm text-slate">{summary}</p>
   <p className="text-sm text-slate">{th ? "Excel มี 2 แผ่นงาน: ข้อมูลสรุป และข้อมูลต้นทาง" : "Excel has two sheets: Summary Data and Source Data."}</p>
   {error ? <p role="alert" className="text-sm text-danger">{th ? "ส่งออกไม่สำเร็จ โปรดลองอีกครั้ง" : "Could not export this report. Please try again."}</p> : null}
   {busy ? <p role="status" className="text-sm font-medium text-navy">{busy === "excel" ? (th ? "กำลังเตรียม Excel…" : "Preparing Excel…") : (th ? "กำลังเตรียม PNG…" : "Preparing PNG…")}</p> : null}
   <div className="grid gap-2 sm:grid-cols-2">
    <Button type="button" size="toolbar" variant="secondary" icon={<ImageDown size={16}/>} aria-label={pngLabel} disabled={busy !== null} onClick={() => void run("png")}>{th ? "ภาพ PNG" : "PNG image"}</Button>
    <Button type="button" size="toolbar" icon={<FileSpreadsheet size={16}/>} aria-label={`${label} XLSX`} disabled={busy !== null} onClick={() => void run("excel")}>{th ? "สมุดงาน Excel" : "Excel workbook"}</Button>
   </div>
  </div>
 </Modal>
 </>;
}
