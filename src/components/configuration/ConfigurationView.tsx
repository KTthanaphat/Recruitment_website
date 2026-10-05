"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Pencil, Plus, Search } from "lucide-react";
import { useDesktopInteractionLock } from "@/components/layout/DesktopInteractionContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { OnOffSwitch } from "@/components/ui/OnOffSwitch";
import { Button } from "@/components/ui/Button";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { TextInput } from "@/components/ui/Field";
import { MobileBottomSheet } from "@/components/ui/MobileBottomSheet";
import { configurationAncestors, configurationContents, configurationCopy, configurationEntries, resolveConfigurationFolder, type ConfigurationEntry } from "@/lib/configuration-folders";
import { pushWorkspaceUrlState, readWorkspaceUrlState, updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import { supabase } from "@/lib/supabase/client";
import { ConfigurationItemEditor, type ConfigurationEditorTarget } from "./ConfigurationItemEditor";
import type { DashboardData, Language } from "@/types/recruitment";

export function ConfigurationView({ language, data, canManageRejectionTemplates, onTemplatesChanged, onReasonsChanged }: { language: Language; data: DashboardData; canManageRejectionTemplates: boolean; onTemplatesChanged: () => Promise<unknown>; onReasonsChanged: () => Promise<void> }) {
  const t = configurationCopy[language];
  const entries = useMemo(() => configurationEntries(data, language), [data, language]);
  const [folder, setFolder] = useState("root"), [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(["root"]);
  const [query, setQuery] = useState(""), [status, setStatus] = useState<"all" | "active" | "archived">("all");
  const [mobileFolders, setMobileFolders] = useState(false), [editor, setEditor] = useState<ConfigurationEditorTarget | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [pendingToggle, setPendingToggle] = useState(false);
  useDesktopInteractionLock(Boolean(editor) || busy || pendingToggle);
  const guard = useRef<((action: () => void) => void) | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), toggleLock = useRef(false);
  const setGuard = useCallback((value: ((action: () => void) => void) | null) => { guard.current = value; }, []);
  const updateBusy = useCallback((value: boolean) => setBusy(value), []);
  function navigate(id: string, push = true) {
    const go = () => { const next = resolveConfigurationFolder(entries, id); setFolder(next); setQuery(""); setError(""); setMobileFolders(false); if (push) pushWorkspaceUrlState({ configurationFolder: next }); else updateWorkspaceUrlState({ configurationFolder: next }); };
    if (busy || pendingToggle) return;
    if (guard.current) guard.current(go); else go();
  }
  useEffect(() => { setFolder(readWorkspaceUrlState().get("configurationFolder") ?? "root"); setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    const valid = resolveConfigurationFolder(entries, folder);
    if (valid !== folder) setFolder(valid);
    setExpanded(current => [...new Set([...current, ...configurationAncestors(entries, valid).map(row => row.id)])]);
    updateWorkspaceUrlState({ configurationFolder: valid });
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }, [folder, entries, ready]);
  useEffect(() => {
    const restore = () => { const requested = readWorkspaceUrlState().get("configurationFolder") ?? "root"; if (guard.current) updateWorkspaceUrlState({ configurationFolder: folder }); navigate(requested, false); };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  });
  const current = entries.find(row => row.id === folder) ?? entries[0];
  const rows = configurationContents(entries, current.id, query, status);
  const breadcrumbs = configurationAncestors(entries, current.id);
  const canAdd = Boolean(current.actor && current.category === "reasons" || current.language && current.category !== "reasons");
  const addLabel = current.category === "reasons" ? current.reason ? t.addDetail : t.addMain : t.newFormat;
  const controlsDisabled = busy || pendingToggle;
  async function refreshToggle() {
    if (toggleLock.current) return;
    toggleLock.current = true; setBusy(true); setError("");
    try { await onReasonsChanged(); setPendingToggle(false); } catch { setError(t.refreshFailed); } finally { toggleLock.current = false; setBusy(false); }
  }
  async function toggle(entry: ConfigurationEntry) {
    if (!supabase || !entry.reason || controlsDisabled || toggleLock.current) return;
    toggleLock.current = true; setBusy(true); setError("");
    let written = false;
    try {
      const result = await supabase.from("rejection_reasons").update({ active: !entry.reason.active }).eq("reason_id", entry.reason.reason_id);
      if (result.error) throw result.error;
      written = true; setPendingToggle(true); await onReasonsChanged(); setPendingToggle(false);
    } catch (failure) { setError(written ? t.refreshFailed : failure instanceof Error ? failure.message : failure && typeof failure === "object" && "message" in failure ? String(failure.message) : t.saveFailed); }
    finally { toggleLock.current = false; setBusy(false); }
  }
  function edit(entry: ConfigurationEntry) { if (controlsDisabled) return; const parent = entries.find(row => row.id === entry.parent); if (parent) setEditor({ entry, parent }); }
  function reasonActions(entry: ConfigurationEntry) {
    return <div className="configuration-actions flex shrink-0 items-center gap-2">
      <Button type="button" size="icon-sm"  variant="ghost" icon={<Pencil size={16} />} aria-label={`${t.edit} ${entry.name}`} title={`${t.edit} ${entry.name}`} disabled={controlsDisabled} onClick={() => edit(entry)} />
      <OnOffSwitch checked={Boolean(entry.active)} onCheckedChange={() => toggle(entry)} label={`${t.active}: ${entry.name}`} language={language} disabled={controlsDisabled} />
      {entry.folder ? <Button type="button" size="icon-sm"  variant="secondary" icon={<Plus size={16} />} aria-label={`${t.addDetail} ${entry.name}`} title={entry.active ? `${t.addDetail} ${entry.name}` : t.archivedParent} disabled={controlsDisabled || !entry.active} onClick={() => setEditor({ parent: entry })} /> : null}
    </div>;
  }
  function treeKey(event: KeyboardEvent<HTMLButtonElement>, entry: ConfigurationEntry) {
    const root = event.currentTarget.closest('[role="tree"]');
    const items = Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? []);
    const index = items.indexOf(event.currentTarget);
    const child = entries.find(row => row.folder && row.parent === entry.id);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (event.key === "ArrowRight" && child) {
      event.preventDefault(); if (!expanded.includes(entry.id)) setExpanded(values => [...values, entry.id]); else items[index + 1]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault(); if (child && expanded.includes(entry.id)) setExpanded(values => values.filter(value => value !== entry.id)); else items.find(item => item.dataset.folder === entry.parent)?.focus();
    }
  }
  function treeRows(parent: string | null, depth: number): React.ReactNode {
    return entries.filter(row => row.folder && row.parent === parent).map((entry, index, siblings) => {
      const hasFolders = entries.some(row => row.folder && row.parent === entry.id), open = expanded.includes(entry.id);
      return <div key={entry.id} role="none"><div className="flex min-w-0 items-center" style={{ paddingLeft: depth * 12 }}>
        {hasFolders ? <button type="button" className="grid min-h-11 w-7 shrink-0 place-items-center text-slate" aria-label={`${open ? (language === "th" ? "ย่อ" : "Collapse") : (language === "th" ? "ขยาย" : "Expand")} ${entry.name}`} tabIndex={-1} disabled={controlsDisabled} onClick={() => setExpanded(values => open ? values.filter(value => value !== entry.id) : [...values, entry.id])}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="w-7 shrink-0" />}
        <button type="button" role="treeitem" aria-selected={folder === entry.id} aria-expanded={hasFolders ? open : undefined} aria-level={depth + 1} aria-posinset={index + 1} aria-setsize={siblings.length} data-folder={entry.id} tabIndex={folder === entry.id ? 0 : -1} disabled={controlsDisabled} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0A3CDC] ${folder === entry.id ? "bg-[#E9F2FF] font-medium text-[#0A3CDC]" : "text-navy hover:bg-[#F8FAFD]"}`} onKeyDown={event => treeKey(event, entry)} onClick={() => navigate(entry.id)}>
          {folder === entry.id ? <FolderOpen size={17} className="shrink-0" /> : <Folder size={17} className="shrink-0 text-slate" />}<span className="min-w-0 break-words">{entry.name}{entry.active === false ? <span className="ml-1 text-xs font-normal text-slate">· {t.archived}</span> : null}</span>
        </button></div>{hasFolders && open ? <div role="group">{treeRows(entry.id, depth + 1)}</div> : null}</div>;
    });
  }
  const tree = <div role="tree" aria-label={t.folders} className="configuration-tree min-w-0">{treeRows(null, 0)}</div>;
  if (!canManageRejectionTemplates) return <Panel><EmptyState variant="quiet" message={t.denied} /></Panel>;
  return <div data-configuration-browser className="grid min-w-0 gap-3">
    <h1 className="sr-only">{t.title}</h1>
    <div className="grid min-w-0 gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden min-w-0 self-start rounded-xl border border-[#E4E9F2] bg-white p-2 md:block"><p className="px-3 py-2 text-xs font-medium text-slate">{t.folders}</p>{tree}</aside>
      <Panel className="configuration-pane min-w-0">
        <Button type="button" variant="secondary" className="mb-3 md:hidden" disabled={controlsDisabled} icon={<Folder size={16} />} onClick={() => setMobileFolders(true)}>{t.browse}</Button>
        <nav aria-label={language === "th" ? "เส้นทางโฟลเดอร์" : "Folder breadcrumb"} className="configuration-breadcrumb mb-2 flex flex-wrap items-center gap-1 text-xs text-slate">{breadcrumbs.map((entry, index) => <span key={entry.id} className="inline-flex min-w-0 items-center gap-1">{index ? <ChevronRight size={12} /> : null}<button type="button" disabled={controlsDisabled} aria-current={entry.id === folder ? "page" : undefined} className="min-h-9 break-words rounded px-1 text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => navigate(entry.id)}>{entry.name}</button></span>)}</nav>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 flex-wrap items-center gap-2"><h2 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold text-navy outline-none"><FolderOpen size={21} className="shrink-0 text-primary" />{current.name}</h2><p role="status" className="text-xs text-slate" data-configuration-count>{rows.length} {t.items}</p></div><div className="configuration-actions flex flex-wrap items-center gap-2">{current.reason ? reasonActions(current) : null}{canAdd && !current.reason ? <Button type="button" size="sm" icon={<Plus size={16} />} disabled={controlsDisabled} onClick={() => setEditor({ parent: current })}>{addLabel}</Button> : null}</div></div>
        <div className="configuration-controls mb-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]"><div className="relative min-w-0"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate" /><TextInput aria-label={t.search} placeholder={t.search} className="pl-9" value={query} onChange={event => setQuery(event.target.value)} /></div><CommandSelector ariaLabel={t.status} emptyLabel={t.status} value={status} options={[{ value: "all", label: t.all }, { value: "active", label: t.active }, { value: "archived", label: t.archived }]} onValueChange={value => setStatus(value as typeof status)} /></div>
        {current.category === "reasons" ? <p className="mb-2 text-xs text-slate">{t.history}</p> : null}
        {busy ? <p role="status" className="mb-2 text-sm text-slate">{t.saving}</p> : null}
        {error ? <p role="alert" className="mb-2 text-sm text-danger">{error}</p> : null}
        {pendingToggle ? <Button type="button" variant="secondary" disabled={busy} onClick={refreshToggle}>{t.retry}</Button> : null}
        <div className="divide-y divide-[#E4E9F2]" data-configuration-contents>{rows.map(entry => <div key={entry.id} data-configuration-entry={entry.id} className="configuration-item">
          {entry.folder ? <Folder size={20} className="configuration-item-icon text-primary" /> : <FileText size={20} className="configuration-item-icon text-slate" />}
          <div className="configuration-item-name min-w-0">{entry.folder ? <button type="button" disabled={controlsDisabled} className="break-words text-left text-sm font-medium text-navy hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => navigate(entry.id)}>{entry.name}</button> : <p className="break-words text-sm font-medium text-navy">{entry.name}</p>}
            {query ? <button type="button" className="block break-words text-left text-xs text-slate hover:text-primary" disabled={controlsDisabled} onClick={() => navigate(entry.parent ?? "root")}>{configurationAncestors(entries, entry.parent ?? "root").map(parent => parent.name).join(" / ")}</button> : null}
          </div>
          <p className="configuration-item-metadata break-words text-xs text-slate">{entry.folder ? `${configurationContents(entries, entry.id, query, status).length} ${t.items}` : entry.template ? `${entry.template.language.toUpperCase()} · v${entry.template.version}` : ""}{entry.active !== undefined ? `${entry.folder || entry.template ? " · " : ""}${entry.active ? t.active : t.archived}` : ""}</p>
          {entry.reason ? reasonActions(entry) : entry.template ? <div className="configuration-actions"><Button type="button" size="sm" variant="secondary" disabled={controlsDisabled} onClick={() => edit(entry)}>{t.edit}</Button></div> : null}
        </div>)}</div>
        {!rows.length ? <EmptyState variant="quiet" message={t.empty} /> : null}
      </Panel>
    </div>
    <MobileBottomSheet open={mobileFolders} title={t.folders} closeLabel={t.close} onClose={() => setMobileFolders(false)}><div className="p-3">{tree}</div></MobileBottomSheet>
    {editor ? <ConfigurationItemEditor target={editor} data={data} language={language} parentPath={configurationAncestors(entries, editor.parent.id).map(entry => entry.name).join(" / ")} onClose={() => setEditor(null)} onBusyChange={updateBusy} onNavigationGuard={setGuard} onReasonsChanged={onReasonsChanged} onTemplatesChanged={onTemplatesChanged} /> : null}
  </div>;
}
