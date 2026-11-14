"use client";
import { useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase/client";
import type { Language } from "@/types/recruitment";
export function secretErrorMessage(message:string,language:Language){
 const text=(en:string,th:string)=>language==="th"?th:en;
 if(message.includes("SECRET_MIXED_GROUPS"))return text("Ordinary and secret requisitions cannot share a group. Unlink conflicting requisitions first.","ใบขออัตราทั่วไปและลับอยู่ในกลุ่มเดียวกันไม่ได้ กรุณายกเลิกการเชื่อมโยงที่ขัดแย้งก่อน")+(message.includes(":")?` (${message.split(":").slice(1).join(":").trim()})`:"");
 if(message.includes("SECRET_CROSS_TYPE"))return text("This would move application history between ordinary and secret groups. Create a separate group and application.","การดำเนินการนี้จะย้ายประวัติระหว่างกลุ่มทั่วไปและกลุ่มลับ กรุณาสร้างกลุ่มและใบสมัครแยก");
 if(message.includes("SECRET_STALE"))return text("This record changed. Reload it before trying again.","ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนลองอีกครั้ง");
 if(message.includes("ORDINARY_CANNOT"))return text("An ordinary requisition cannot be changed to secret.","ใบขออัตราทั่วไปเปลี่ยนเป็นลับไม่ได้");
 if(message.includes("SECRET_LINK_CONFIRMATION"))return text("Review and confirm the confidentiality change before linking this group.","กรุณาตรวจสอบและยืนยันการเปลี่ยนเป็นกลุ่มลับก่อนเชื่อมโยง");
 if(message.includes("SECRET_ADMIN"))return text("Only System Admin and Admin Recruiter can manage secret records.","เฉพาะผู้ดูแลระบบและผู้ดูแลสรรหาเท่านั้นที่จัดการข้อมูลลับได้");
 return message;
}
export function SecretBadge({language}:{language:Language}){return <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-navy"><LockKeyhole size={12} aria-hidden="true"/>{language==="th"?"ลับ":"Secret"}</span>;}
export function SecretReveal({kind,id,updatedAt,language}:{kind:"requisition"|"group";id:string;updatedAt:string;language:Language}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");const locked=useRef(false);
 const t=(en:string,th:string)=>language==="th"?th:en;
 async function reveal(){if(locked.current||!supabase)return;locked.current=true;setBusy(true);setError("");try{const {error}=await supabase.rpc(kind==="requisition"?"app_reveal_secret_requisition_v1":"app_reveal_secret_group_v1",{payload:{[kind==="requisition"?"doc_id":"group_id"]:id,expected_updated_at:updatedAt,confirmed:true}});if(error)throw error;setOpen(false);window.dispatchEvent(new Event("recruitment:classification-changed"));}catch(error){setError(secretErrorMessage(error instanceof Error?error.message:String((error as {message?:string})?.message??error),language));}finally{locked.current=false;setBusy(false);}}
 return <><Button type="button" variant="secondary" className="min-h-11" onClick={()=>{setError("");setOpen(true);}}>{t("Make ordinary","เปลี่ยนเป็นทั่วไป")}</Button><Modal open={open} title={t("Make this record ordinary?","เปลี่ยนข้อมูลนี้เป็นทั่วไปหรือไม่?")} closeLabel={t("Close","ปิด")} closeDisabled={busy} onClose={()=>{if(!locked.current)setOpen(false);}} width="max-w-md"><div className="grid gap-4"><p className="break-words text-sm font-semibold text-navy">{id}</p><p className="text-sm leading-relaxed text-slate">{kind==="requisition"?t("This record and its eligible linked groups will become visible under ordinary access rules. Its history will appear in reports immediately. This requisition cannot be made secret again.","ข้อมูลนี้และกลุ่มที่เชื่อมโยงซึ่งเข้าเงื่อนไขจะใช้สิทธิ์เข้าถึงแบบทั่วไป และประวัติจะปรากฏในรายงานทันที ใบขออัตรานี้จะเปลี่ยนกลับเป็นลับไม่ได้"):t("This unlinked group and its application history will become visible under ordinary access rules.","กลุ่มที่ไม่ได้เชื่อมโยงนี้และประวัติใบสมัครจะใช้สิทธิ์เข้าถึงแบบทั่วไป")}</p>{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={()=>setOpen(false)}>{t("Keep secret","คงเป็นลับ")}</Button><Button type="button" disabled={busy} onClick={()=>void reveal()}>{busy?t("Saving…","กำลังบันทึก…"):t("Confirm make ordinary","ยืนยันเปลี่ยนเป็นทั่วไป")}</Button></div></div></Modal></>;
}
