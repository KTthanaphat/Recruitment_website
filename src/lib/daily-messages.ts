import type { Language } from "@/types/recruitment";

type DailyMessageDay = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

type DailyMessageRow = {
  day: DailyMessageDay;
  workload: "high" | "medium" | "low";
  filledMin: number;
  th: string;
  en: string;
};

const weekdayKeys: DailyMessageDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const recruitmentDailyMessages: DailyMessageRow[] = [
  { day: "Mon", workload: "high", filledMin: 0, th: "สวัสดีวันจันทร์ค่ะ คุณ{name} เริ่มต้นสัปดาห์ใหม่อาจจะมีตำแหน่งงานค้างอยู่ค่อนข้างมาก ค่อยๆ บริหารจัดการไปทีละส่วนนะคะ Keep Energetic! และเริ่มต้นวันทำงานด้วยพลังบวกกันค่ะ สู้ๆ นะคะ", en: "Happy Monday, Khun {name}! There may be quite a few open positions waiting at the start of this new week. Take them one step at a time and keep the momentum going. Keep energetic, start the day with positive energy, and keep fighting—you’ve got this!" },
  { day: "Mon", workload: "medium", filledMin: 0.33, th: "สวัสดีวันจันทร์ค่ะ เปิดสัปดาห์ด้วยปริมาณงานที่กำลังพอดี เป็นโอกาสที่ดีในการวางแผนและจัดลำดับความสำคัญของงานในสัปดาห์นี้ ขอให้เป็นวันเริ่มต้นที่ดีค่ะ", en: "Happy Monday! The week is starting with a manageable workload, making this a great opportunity to plan and prioritize your tasks for the week ahead. Wishing you a great start to the week!" },
  { day: "Mon", workload: "low", filledMin: 0.66, th: "สวัสดีวันจันทร์ค่ะ สัปดาห์นี้เปิดมาแบบชิล ๆ  เพราะตำแหน่งงานเหลือน้อยมากกก สตาร์ทเครื่องแบบสบายๆ ไม่ต้องเครียดเลยน้าา Week นี้สบาย ๆ ค่ะ", en: "Happy Monday! This week is off to a relaxed start because there are very few positions left to manage. Ease into the day—there’s no need to stress. It looks like a comfortable week ahead!" },
  { day: "Tue", workload: "high", filledMin: 0, th: "สวัสดีวันอังคารค่ะ ปริมาณงานยังเยอะอยู่พอสมควร แต่อย่าเพิ่งหมดกำลังใจนะคะ ค่อยๆ เคลียร์ไปทีละขั้น คุณ{name}สามารถจัดการได้อย่างราบรื่นแน่นอนค่ะ", en: "Happy Tuesday! The workload is still fairly high, but don’t lose heart. Work through it one step at a time—Khun {name} can definitely manage everything smoothly!" },
  { day: "Tue", workload: "medium", filledMin: 0.33, th: "สวัสดีวันอังคารสีชมพูค่ะ ปริมาณงานในวันนี้อยู่ในระดับที่กำลังพอดี ค่อยๆ จัดสรรเวลาในการดำเนินงาน เพื่อความถูกต้องและราบรื่นตลอดทั้งวันนะคะ", en: "Happy Pink Tuesday! Today’s workload is at a manageable level. Take your time to allocate your schedule carefully so everything remains accurate and runs smoothly throughout the day." },
  { day: "Tue", workload: "low", filledMin: 0.66, th: "แฮปปี้วันอังคารค่ะ ตำแหน่งงานเหลือเคลียร์แค่นิดเดียวเอง มีเวลาในการตรวจสอบความเรียบร้อย หรือเตรียมพร้อมสำหรับงานส่วนอื่นๆ ได้อย่างเต็มที่ค่ะ", en: "Happy Tuesday! There are only a few positions left to clear, so you’ll have plenty of time to double-check everything or prepare for other tasks." },
  { day: "Wed", workload: "high", filledMin: 0, th: "สวัสดีวันพุธค่ะ เดินทางมาถึงกลางสัปดาห์แล้ว แม้ว่าตำแหน่งงานจะยังคงมีอยู่มาก สู้ ๆ ลุยงานต่อด้วยพลังที่เต็มเปี่ยมกันนะคะ", en: "Happy Wednesday! We’ve reached the middle of the week. Even though there are still many positions to manage, let’s keep going with full energy. You’ve got this!" },
  { day: "Wed", workload: "medium", filledMin: 0.33, th: "สวัสดีวันพุธค่ะ ครึ่งทางของสัปดาห์แล้ว กับตำแหน่งงานที่เหลือกำลังดี วันนี้มาช่วยกันปิดจ็อบที่เหลือให้ราบรื่นกันค่ะ", en: "Happy Wednesday! We’re halfway through the week, with a manageable number of positions remaining. Let’s work together to close the remaining jobs smoothly today." },
  { day: "Wed", workload: "low", filledMin: 0.66, th: "สวัสดีวันพุธค่ะ วันนี้การทำงานค่อนข้างคล่องตัวเนื่องจากตำแหน่งงานเหลือน้อย ถือเป็นวันกลางสัปดาห์ที่ได้หายใจหายคอแบบโล่งๆ ทำงานวันนี้ให้สนุกและมีความสุขน้า", en: "Happy Wednesday! Work should flow quite smoothly today because only a few positions remain. Enjoy this lighter midweek moment, and have a fun and happy workday!" },
  { day: "Thu", workload: "high", filledMin: 0, th: "สวัสดีวันพฤหัสบดีค่ะ ใกล้จะถึงวันหยุดสุดสัปดาห์แล้วแต่งานยังเยอะอยู่ ไม่เป็นไรนะคะ ค่อยๆ เคลียร์ไปทีละสเต็ป มีอะไรขอให้ทีมช่วยได้นะคะ เป็นกำลังใจให้เสมอค่ะ", en: "Happy Thursday! The weekend is getting closer, but there is still a lot of work to handle. That’s okay—take it one step at a time, and reach out to the team whenever you need support. We’re always cheering you on!" },
  { day: "Thu", workload: "medium", filledMin: 0.33, th: "สวัสดีวันพฤหัสบดีค่ะ งานเหลืออีกไม่มากแล้ว มาช่วยกันจัดการงานตรงหน้าให้เรียบร้อย เพื่อที่จะได้ไม่ต้องมีงานค้างไปจนถึงสัปดาห์นะคะ มีอะไรขอให้ทีมช่วยได้นะคะ", en: "Happy Thursday! There isn’t much work left, so let’s finish what’s in front of us and avoid carrying pending tasks into next week. Please reach out if there is anything the team can help with." },
  { day: "Thu", workload: "low", filledMin: 0.66, th: "สวัสดีวันพฤหัสค่ะ ตำแหน่งงานเหลือน้อยมากก เคลียร์โค้งสุดท้าย เตรียมตัวต้อนรับวันศุกร์ได้เลยค่ะ มีอะไรขอให้ทีมช่วยได้นะคะ", en: "Happy Thursday! There are very few positions left—let’s clear the final stretch and get ready to welcome Friday. Please reach out if there is anything the team can help with." },
  { day: "Fri", workload: "high", filledMin: 0, th: "สวัสดีวันสุขค่ะ ตำแหน่งงานยังเหลือเยอะส่งท้ายสัปดาห์เลย ค่อยๆ เคลียร์เท่าที่ไหว รักษาพลังไว้ แล้วค่อยกลับมาเคลียร์หลังวันหยุดนะคะ (อย่าลืมบันทึกข้อมูลด้วยน้า)", en: "Happy Friday! There are still many positions left as we wrap up the week. Clear as much as you comfortably can, save your energy, and continue after the weekend. (Please don’t forget to update the records!)" },
  { day: "Fri", workload: "medium", filledMin: 0.33, th: "สวัสดีวันสุขค่ะ งานเหลืออีกเพียงเล็กน้อยเท่านั้น มาช่วยกันเคลียร์งานส่วนที่เหลือให้เสร็จสิ้น เพื่อที่จะได้พักผ่อนในวันหยุดสุดสัปดาห์ได้อย่างสบายใจไร้กังวลค่ะ (อย่าลืมบันทึกข้อมูลด้วยน้า)", en: "Happy Friday! Only a small amount of work remains. Let’s finish the remaining tasks so everyone can enjoy the weekend with peace of mind. (Please don’t forget to update the records!)" },
  { day: "Fri", workload: "low", filledMin: 0.66, th: "สวัสดีวันสุขค่ะ สัปดาห์ที่ผ่านมาทำได้ดีมาก งานเหลืออีกเพียงเล็กน้อยเท่านั้น มาช่วยกันเคลียร์งานส่วนที่เหลือให้เสร็จสิ้น แล้วใช้วันหยุดให้มีความสุขนะคะ (อย่าลืมบันทึกข้อมูลด้วยน้า)", en: "Happy Friday! You’ve done a great job this week, and only a few tasks remain. Let’s finish them up, then enjoy a happy and well-deserved weekend. (Please don’t forget to update the records!)" },
  { day: "Sat", workload: "high", filledMin: 0, th: "สวัสดีวันเสาร์ค่ะ สำหรับผู้ที่ยังคงปฏิบัติงานในวันเสาร์และต้องรับมือกับตำแหน่งงานที่เยอะ ขอขอบคุณในความทุ่มเทและความเสียสละนะคะ ค่อยๆ บริหารจัดการไปทีละส่วน และอย่าลืมดูแลสุขภาพด้วยค่ะ (อย่าลืมบันทึกข้อมูลด้วยน้า)", en: "Happy Saturday! To everyone working today and handling a high number of positions, thank you for your dedication and commitment. Take things one section at a time, and remember to look after your health. (Please don’t forget to update the records!)" },
  { day: "Sat", workload: "medium", filledMin: 0.33, th: "สวัสดีวันเสาร์ค่ะ งานวันนี้มีพอประมาณ ไม่หนักจนเกินไปนะคะ ขอให้เคลียร์งานได้อย่างราบรื่นและเสร็จสิ้นตามเป้าหมายค่ะ (อย่าลืมบันทึกข้อมูลด้วยน้า)", en: "Happy Saturday! Today’s workload is moderate and not too heavy. Wishing you a smooth workday and successful completion of your targets. (Please don’t forget to update the records!)" },
  { day: "Sat", workload: "low", filledMin: 0.66, th: "สวัสดีวันเสาร์ค่ะ งานวันเสาร์เหลือน้อยมากถึงมากที่สุด จัดการแป๊บเดียวก็เรียบร้อย มีเวลาเหลือสำหรับวันหยุดวันพรุ่งนี้แน่นอนค่ะ (อย่าลืมบันทึกข้อมูลด้วยน้า)", en: "Happy Saturday! There is very little work left today, so it should be completed in no time. You’ll definitely have time to enjoy your day off tomorrow. (Please don’t forget to update the records!)" },
  { day: "Sun", workload: "high", filledMin: 0, th: "สวัสดีวันอาทิตย์ค่ะ งานยังคงมีเข้ามาค่อนข้างมากในวันหยุดนี้ ขอขอบคุณในความทุ่มเทนะคะ ค่อยๆ เคลียร์ไปทีละงาน อย่าลืมแบ่งเวลาให้ตัวเองด้วยนะคะ", en: "Happy Sunday! There is still quite a lot of work coming in during the holiday. Thank you for your dedication. Take it one task at a time, and remember to set aside some time for yourself too." },
  { day: "Sun", workload: "medium", filledMin: 0.33, th: "สวัสดีวันอาทิตย์ค่า งานมีเข้ามาปานกลาง เคลียร์งานตรงนี้เสร็จแล้ว อย่าลืมหาเวลาพักผ่อน ชาร์จแบตให้ตัวเองเยอะๆ น้า", en: "Happy Sunday! The workload is moderate today. Once everything is cleared, remember to make time to rest and fully recharge your energy." },
  { day: "Sun", workload: "low", filledMin: 0.66, th: "สวัสดีวันอาทิตย์ค่ะ งานเหลือน้อยสบายๆ แทบไม่มีอะไรน่าห่วงเลย เคลียร์งานเสร็จแล้ว ไปเที่ยวพักผ่อนให้เต็มที่เพื่อเตรียมลุยสัปดาห์หน้ากันค่ะ สู้ๆ", en: "Happy Sunday! There is very little work left and almost nothing to worry about. Once it’s done, enjoy your time off and recharge fully so you’re ready for the week ahead. You’ve got this!" }
];

export function dailyWelcomeMessage({
  language,
  ratio,
  name,
  date = new Date(),
  fallback
}: {
  language: Language;
  ratio: number;
  name: string;
  date?: Date;
  fallback: string;
}) {
  const day = weekdayKeys[date.getDay()];
  const rawRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  const safeRatio = rawRatio > 1 ? rawRatio / 100 : rawRatio;
  const match = recruitmentDailyMessages
    .filter((row) => row.day === day && row.filledMin <= safeRatio)
    .sort((a, b) => b.filledMin - a.filledMin)[0];
  const template = match ? match[language] : fallback;
  return template.replace(/\{name\}/g, name);
}
