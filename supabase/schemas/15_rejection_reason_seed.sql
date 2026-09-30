-- Stable IDs let wording change without changing saved reason references.
with seed(code, actor, th, en, position) as (values
  ('c1', 'candidate', 'ค่าตอบแทนและสวัสดิการ', 'Compensation and benefits', 1),
  ('c2', 'candidate', 'ลักษณะงานและโอกาสเติบโต', 'Job scope and growth opportunities', 2),
  ('c3', 'candidate', 'สถานที่และเงื่อนไขการทำงาน', 'Workplace and working conditions', 3),
  ('c4', 'candidate', 'ความพร้อมและเหตุผลส่วนบุคคล', 'Readiness and personal reasons', 4),
  ('c5', 'candidate', 'กระบวนการสรรหา', 'Recruitment process', 5),
  ('e1', 'company', 'คุณสมบัติและประสบการณ์', 'Qualifications and experience', 1),
  ('e2', 'company', 'ทักษะและผลการประเมิน', 'Skills and assessment results', 2),
  ('e3', 'company', 'ค่าตอบแทนและเงื่อนไขการจ้าง', 'Compensation and employment terms', 3),
  ('e4', 'company', 'ความเหมาะสมกับลักษณะงาน', 'Fit for the role', 4),
  ('e5', 'company', 'การตรวจสอบและข้อกำหนดการจ้าง', 'Employment checks and requirements', 5)
)
insert into public.rejection_reasons (reason_id, reason_kind, actor, label_th, label_en, sort_order)
select md5('rejection-reason:' || code)::uuid, 'main', actor, th, en, position from seed
on conflict (reason_id) do nothing;

with seed(code, parent, actor, th, en, position) as (values
  ('c1_1','c1','candidate','เงินเดือนต่ำกว่าความคาดหวัง','Salary below expectations',1),
  ('c1_2','c1','candidate','สวัสดิการไม่ตรงความต้องการ','Benefits do not meet needs',2),
  ('c1_3','c1','candidate','ได้รับข้อเสนอให้อยู่ต่อจากนายจ้างเดิม','Received a counteroffer from current employer',3),
  ('c1_4','c1','candidate','ได้รับข้อเสนอที่ดีกว่าจากบริษัทอื่น','Received a better offer elsewhere',4),
  ('c2_1','c2','candidate','ลักษณะงานไม่ตรงความคาดหวัง','Job scope differs from expectations',1),
  ('c2_2','c2','candidate','ไม่สนใจตำแหน่งงาน','No longer interested in the position',2),
  ('c2_3','c2','candidate','โอกาสเติบโตไม่ตรงเป้าหมายอาชีพ','Growth opportunities do not match career goals',3),
  ('c3_1','c3','candidate','ระยะทางหรือการเดินทางไม่สะดวก','Commute is inconvenient',1),
  ('c3_2','c3','candidate','ไม่สะดวกทำงานวันเสาร์','Unable to work Saturdays',2),
  ('c3_3','c3','candidate','ไม่สะดวกทำงานเป็นกะ','Unable to work shifts',3),
  ('c3_4','c3','candidate','ไม่สะดวกกับสภาพแวดล้อมการทำงาน (ฝุ่น/กลิ่น)','Work environment is unsuitable (dust or odors)',4),
  ('c3_5','c3','candidate','ไม่สะดวกย้ายพื้นที่ทำงาน','Unable to relocate work location',5),
  ('c4_1','c4','candidate','ยังไม่พร้อมเปลี่ยนงาน','Not ready to change jobs',1),
  ('c4_2','c4','candidate','เหตุผลส่วนตัว','Personal reasons',2),
  ('c5_1','c5','candidate','ไม่สะดวกเข้าร่วมสัมภาษณ์หรือทดสอบ','Unable to attend interview or test',1),
  ('c5_2','c5','candidate','ไม่พึงพอใจประสบการณ์สรรหา','Unsatisfied with recruitment experience',2),
  ('c5_3','c5','candidate','ถอนตัวโดยไม่ระบุเหตุผล','Withdrew without giving a reason',3),
  ('e1_1','e1','company','วุฒิการศึกษาไม่ตรงข้อกำหนด','Education does not meet requirements',1),
  ('e1_2','e1','company','ประสบการณ์ยังไม่เพียงพอ','Insufficient experience',2),
  ('e1_3','e1','company','ขาดคุณสมบัติหรือใบอนุญาตที่จำเป็น','Missing required qualification or license',3),
  ('e2_1','e2','company','ทักษะเฉพาะทางไม่ตรงความต้องการ','Technical skills do not meet needs',1),
  ('e2_2','e2','company','ไม่สามารถอธิบายประสบการณ์ที่เกี่ยวข้องได้ชัดเจน','Unable to clearly explain relevant experience',2),
  ('e2_3','e2','company','ไม่สามารถตอบคำถามเกี่ยวกับงานได้ตามเกณฑ์','Job-related answers did not meet criteria',3),
  ('e2_4','e2','company','ผลสัมภาษณ์ไม่ผ่านเกณฑ์','Interview result did not meet criteria',4),
  ('e2_5','e2','company','ผลการทดสอบไม่ผ่านเกณฑ์','Test result did not meet criteria',5),
  ('e3_1','e3','company','เงินเดือนที่คาดหวังเกินโครงสร้าง','Expected salary exceeds pay structure',1),
  ('e3_2','e3','company','ไม่สามารถเริ่มงานตามกำหนด','Unable to start on schedule',2),
  ('e3_3','e3','company','ไม่สามารถปฏิบัติงานในพื้นที่ที่กำหนด','Unable to work at assigned location',3),
  ('e4_1','e4','company','ความคาดหวังไม่สอดคล้องกับหน้าที่ของตำแหน่ง','Expectations do not align with role duties',1),
  ('e4_2','e4','company','ไม่สอดคล้องกับ Leadership Competency','Does not meet leadership competency criteria',2),
  ('e5_1','e5','company','ข้อมูลประสบการณ์ทำงานไม่ตรงกับข้อเท็จจริงที่ตรวจสอบได้','Work history differs from verified facts',1),
  ('e5_2','e5','company','ไม่ผ่านการตรวจสอบบุคคลอ้างอิงตามเกณฑ์','Reference check did not meet criteria',2),
  ('e5_3','e5','company','ไม่ผ่านการตรวจสอบประวัติอาชญากรรม','Criminal background check did not pass',3),
  ('e5_4','e5','company','ไม่ผ่านเกณฑ์สุขภาพที่จำเป็นสำหรับตำแหน่ง','Does not meet role health requirements',4),
  ('e5_5','e5','company','เอกสารไม่ครบถ้วน','Incomplete documents',5)
)
insert into public.rejection_reasons (reason_id, reason_kind, actor, parent_id, label_th, label_en, sort_order)
select md5('rejection-reason:' || code)::uuid, 'detail', actor, md5('rejection-reason:' || parent)::uuid, th, en, position from seed
on conflict (reason_id) do nothing;
