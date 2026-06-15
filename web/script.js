const state = {
  requisitions: [],
  position_groups: [],
  groups: [],
  candidates: [],
  requisition_logs: [],
  recruitment_logs: [],
  offers: [],
  change_logs: [],
};

const statusBox = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh-button");
const languageToggle = document.querySelector("#language-toggle");
const siteFilter = document.querySelector("#site-filter");
const picFilter = document.querySelector("#pic-filter");
const clearFiltersButton = document.querySelector("#clear-filters");
const viewTitle = document.querySelector("#view-title");
const viewKicker = document.querySelector("#view-kicker");
const confirmDialog = document.querySelector("#confirm-dialog");
const confirmTitle = document.querySelector("#confirm-title");
const confirmSummary = document.querySelector("#confirm-summary");
const confirmDetails = document.querySelector("#confirm-details");
const confirmSubmit = document.querySelector("#confirm-submit");
const cancelSubmit = document.querySelector("#cancel-submit");
let pendingSubmit = null;
let draggedCandidate = null;
let currentLang = localStorage.getItem("recruitment_lang") || "en";
const savedFilters = JSON.parse(localStorage.getItem("recruitment_filters") || "{}");
const processOrder = ["No activity", "First Contact", "Phone Screen", "HR Interview", "Line Interview", "Test", "Reference Check", "Offer", "Rejected", "Withdrawn"];

const text = {
  en: {
    dashboard: "Dashboard",
    requisitions: "Requisitions",
    candidates: "Candidates",
    pipeline: "Pipeline",
    offers: "Offers",
    setup: "Setup",
    audit: "Audit Log",
    workQueue: "Work Queue",
    hiringDemand: "Hiring Demand",
    talentTracking: "Talent Tracking",
    processBoard: "Process Board",
    hiringOutcome: "Hiring Outcome",
    configuration: "Configuration",
    history: "History",
    newRequisition: "New Requisition",
    newCandidate: "New Candidate",
    processUpdate: "Process Update",
    refresh: "Refresh",
    site: "Site",
    personInCharge: "Person in Charge",
    clear: "Clear",
    activeRequisitions: "Active Requisitions",
    acceptedOffers: "Accepted Offers",
    openHeadcount: "Open Headcount",
    needsAction: "Needs Action",
    recentActivity: "Recent Activity",
    candidatePipeline: "Candidate Pipeline",
    fullPipeline: "Full Pipeline",
    addUpdate: "Add Update",
    addProcessUpdate: "Add Process Update",
    close: "Close",
    candidate: "Candidate",
    date: "Date",
    process: "Process",
    round: "Round",
    interviewer: "Interviewer",
    result: "Result",
    remark: "Remark",
    pending: "Pending",
    pass: "Pass",
    fail: "Fail",
    noCandidates: "No candidates",
    pipelineForwardOnly: "Pipeline cards can move forward only.",
    processDialogReady: "Complete the process update details before saving.",
    loading: "Loading recruitment records...",
    loaded: "Recruitment records loaded.",
    refreshing: "Refreshing...",
    saving: "Saving...",
    saved: "Saved.",
    confirmSave: "Confirm Save",
    confirmAdd: "Confirm Add",
    confirmChange: "Confirm Change",
    cancel: "Cancel",
    confirm: "Confirm",
    noExistingValue: "No existing value found",
    select: "Select...",
    noRecords: "No records yet",
    lastUpdate: "Last update",
    noUpdateYet: "No update yet",
  },
  th: {
    dashboard: "แดชบอร์ด",
    requisitions: "ใบขออัตรากำลัง",
    candidates: "ผู้สมัคร",
    pipeline: "ขั้นตอนผู้สมัคร",
    offers: "ข้อเสนอจ้าง",
    setup: "ตั้งค่า",
    audit: "ประวัติการแก้ไข",
    workQueue: "งานที่ต้องติดตาม",
    hiringDemand: "ความต้องการอัตรากำลัง",
    talentTracking: "ติดตามผู้สมัคร",
    processBoard: "กระดานขั้นตอน",
    hiringOutcome: "ผลการจ้างงาน",
    configuration: "การตั้งค่า",
    history: "ประวัติ",
    newRequisition: "สร้างใบขอใหม่",
    newCandidate: "เพิ่มผู้สมัคร",
    processUpdate: "อัปเดตขั้นตอน",
    refresh: "รีเฟรช",
    site: "ไซต์",
    personInCharge: "ผู้รับผิดชอบ",
    clear: "ล้าง",
    activeRequisitions: "ใบขอที่ยังดำเนินการ",
    acceptedOffers: "รับข้อเสนอแล้ว",
    openHeadcount: "อัตราที่ยังเปิด",
    needsAction: "งานที่ต้องดำเนินการ",
    recentActivity: "กิจกรรมล่าสุด",
    candidatePipeline: "ขั้นตอนผู้สมัคร",
    fullPipeline: "ดูทั้งหมด",
    addUpdate: "เพิ่มอัปเดต",
    addProcessUpdate: "บันทึกอัปเดตขั้นตอน",
    close: "ปิด",
    candidate: "ผู้สมัคร",
    date: "วันที่",
    process: "ขั้นตอน",
    round: "รอบ",
    interviewer: "ผู้สัมภาษณ์",
    result: "ผล",
    remark: "หมายเหตุ",
    pending: "รอดำเนินการ",
    pass: "ผ่าน",
    fail: "ไม่ผ่าน",
    noCandidates: "ไม่มีผู้สมัคร",
    pipelineForwardOnly: "การ์ดผู้สมัครเลื่อนไปขั้นตอนถัดไปเท่านั้น",
    processDialogReady: "กรอกข้อมูลอัปเดตขั้นตอนให้ครบก่อนบันทึก",
    loading: "กำลังโหลดข้อมูลสรรหา...",
    loaded: "โหลดข้อมูลสรรหาแล้ว",
    refreshing: "กำลังรีเฟรช...",
    saving: "กำลังบันทึก...",
    saved: "บันทึกแล้ว",
    confirmSave: "ยืนยันการบันทึก",
    confirmAdd: "ยืนยันการเพิ่ม",
    confirmChange: "ยืนยันการแก้ไข",
    cancel: "ยกเลิก",
    confirm: "ยืนยัน",
    noExistingValue: "ไม่พบค่าที่มีอยู่",
    select: "เลือก...",
    noRecords: "ยังไม่มีข้อมูล",
    lastUpdate: "อัปเดตล่าสุด",
    noUpdateYet: "ยังไม่มีอัปเดต",
  },
};

const processText = {
  en: Object.fromEntries(processOrder.map((process) => [process, process])),
  th: {
    "No activity": "ยังไม่มีกิจกรรม",
    "First Contact": "ติดต่อครั้งแรก",
    "Phone Screen": "คัดกรองทางโทรศัพท์",
    "HR Interview": "สัมภาษณ์ HR",
    "Line Interview": "สัมภาษณ์หน่วยงาน",
    Test: "ทดสอบ",
    "Reference Check": "ตรวจสอบบุคคลอ้างอิง",
    Offer: "เสนอจ้าง",
    Rejected: "ไม่ผ่าน",
    Withdrawn: "ถอนตัว",
  },
};

function t(key) {
  return text[currentLang]?.[key] || text.en[key] || key;
}

function p(process) {
  return processText[currentLang]?.[process] || process || "-";
}

function resultText(value) {
  if (value === 1) return t("pass");
  if (value === 0) return t("fail");
  return t("pending");
}

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function escapeHtml(value) {
  return valueOrDash(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultBadge(value) {
  if (value === 1) return `<span class="badge pass">${escapeHtml(t("pass"))}</span>`;
  if (value === 0) return `<span class="badge fail">${escapeHtml(t("fail"))}</span>`;
  return `<span class="badge pending">${escapeHtml(t("pending"))}</span>`;
}

function statusBadge(value) {
  const status = valueOrDash(value).toLowerCase();
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== ""))].sort(
    (a, b) => String(a).localeCompare(String(b)),
  );
}

function fillDatalist(id, values) {
  const datalist = document.querySelector(`#${id}`);
  datalist.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    datalist.append(option);
  }
}

function datalistValues(input) {
  const listId = input.getAttribute("list");
  if (!listId) return [];
  return [...document.querySelectorAll(`#${CSS.escape(listId)} option`)].map((option) => option.value).filter(Boolean);
}

function closeComboPanels(exceptInput = null) {
  document.querySelectorAll(".combo-panel").forEach((panel) => {
    if (exceptInput && panel.dataset.forInput === exceptInput.dataset.comboId) return;
    panel.remove();
  });
}

function renderComboPanel(input) {
  const values = datalistValues(input);
  if (!values.length) return;

  closeComboPanels(input);
  let panel = document.querySelector(`.combo-panel[data-for-input="${input.dataset.comboId}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "combo-panel";
    panel.dataset.forInput = input.dataset.comboId;
    input.closest("label")?.append(panel);
  }

  const query = input.value.trim().toLowerCase();
  const matches = values.filter((value) => !query || value.toLowerCase().includes(query)).slice(0, 12);

  if (!matches.length) {
    panel.innerHTML = `<button type="button" class="combo-option is-empty" disabled>${escapeHtml(t("noExistingValue"))}</button>`;
    return;
  }

  panel.innerHTML = matches.map((value) => `<button type="button" class="combo-option" data-combo-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
}

function currentFilters() {
  return {
    site: siteFilter.value.trim().toLowerCase(),
    person_in_charge: picFilter.value.trim().toLowerCase(),
  };
}

function matchesFilters(row) {
  const filters = currentFilters();
  const site = valueOrDash(row.site).toLowerCase();
  const owner = valueOrDash(row.person_in_charge).toLowerCase();
  return (!filters.site || site.includes(filters.site)) && (!filters.person_in_charge || owner.includes(filters.person_in_charge));
}

function filteredRequisitions() {
  return state.requisitions.filter(matchesFilters);
}

function filteredGroups() {
  return state.groups.filter(matchesFilters);
}

function filteredCandidates() {
  return state.candidates.filter(matchesFilters);
}

function filteredRecruitmentLogs() {
  return state.recruitment_logs.filter(matchesFilters);
}

function filteredOffers() {
  return state.offers.filter(matchesFilters);
}

function activePipelineCandidates() {
  return filteredCandidates().filter((candidate) => !candidate.accepted_date);
}

function processIndex(process) {
  const index = processOrder.indexOf(process || "No activity");
  return index === -1 ? 0 : index;
}

function saveFilters() {
  localStorage.setItem(
    "recruitment_filters",
    JSON.stringify({
      site: siteFilter.value,
      person_in_charge: picFilter.value,
    }),
  );
}

function latestCandidateLog(candidateId) {
  return state.recruitment_logs
    .filter((log) => log.candidate_id === candidateId)
    .sort((a, b) => String(b.log_date || "").localeCompare(String(a.log_date || "")) || Number(b.log_id || 0) - Number(a.log_id || 0))[0];
}

function candidateLogs(candidateId) {
  return state.recruitment_logs
    .filter((log) => log.candidate_id === candidateId)
    .sort((a, b) => String(b.log_date || "").localeCompare(String(a.log_date || "")) || Number(b.log_id || 0) - Number(a.log_id || 0));
}

function requisitionCandidates(docId) {
  return state.candidates.filter((candidate) => candidate.doc_id === docId);
}

function requisitionOffers(docId) {
  return state.offers.filter((offer) => offer.doc_id === docId);
}

function detailGrid(items) {
  return `<dl class="detail-grid">${items.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function detailTimeline(logs) {
  if (!logs.length) return `<p class="empty">${escapeHtml(t("noRecords"))}</p>`;
  return `<div class="timeline">${logs
    .map(
      (log) => `
        <div class="timeline-item">
          <strong>${escapeHtml(log.log_date)} - ${escapeHtml(p(log.recruitment_process))}</strong>
          <p>${escapeHtml(t("round"))} ${escapeHtml(log.round)} ${resultBadge(log.result)}</p>
          <p>${escapeHtml(log.interviewer || "")}${log.remark ? ` - ${escapeHtml(log.remark)}` : ""}</p>
        </div>
      `,
    )
    .join("")}</div>`;
}

function acceptedOfferCount(row) {
  return Number(row.offer_count || 0);
}

function openHeadcount(row) {
  return Math.max(0, Number(row.head_count || 0) - acceptedOfferCount(row));
}

function enhanceSearchableInputs() {
  document.querySelectorAll("input[list]").forEach((input, index) => {
    if (input.dataset.comboReady) return;
    input.dataset.comboReady = "true";
    input.dataset.comboId = `combo-${index}`;
    input.autocomplete = "off";
    input.closest("label")?.classList.add("combo-field");

    input.addEventListener("focus", () => renderComboPanel(input));
    input.addEventListener("click", () => renderComboPanel(input));
    input.addEventListener("input", () => renderComboPanel(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeComboPanels();
    });
  });

  document.addEventListener("click", (event) => {
    const option = event.target.closest("[data-combo-value]");
    if (option) {
      const panel = option.closest(".combo-panel");
      const input = document.querySelector(`[data-combo-id="${panel.dataset.forInput}"]`);
      input.value = option.dataset.comboValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      closeComboPanels();
      return;
    }

    if (!event.target.closest(".combo-field")) closeComboPanels();
  });
}

function fillSelect(select, rows, getValue, getLabel) {
  const currentValue = select.value;
  select.replaceChildren();

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = rows.length ? t("select") : t("noRecords");
  select.append(empty);

  for (const row of rows) {
    const option = document.createElement("option");
    option.value = getValue(row);
    option.textContent = getLabel(row);
    select.append(option);
  }

  if ([...select.options].some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function refreshSelects() {
  document.querySelectorAll('select[data-source="requisitions"]').forEach((select) => {
    fillSelect(select, filteredRequisitions(), (row) => row.doc_id, (row) => `${row.doc_id} - ${row.position}`);
  });
  document.querySelectorAll('select[data-source="position-groups"]').forEach((select) => {
    fillSelect(select, state.position_groups, (row) => row.group_id, (row) => `${row.group_id} - ${row.group_position}`);
  });
  document.querySelectorAll('select[data-source="groups"]').forEach((select) => {
    fillSelect(select, filteredGroups(), (row) => row.doc_group_id, (row) => `${row.doc_group_id} - ${row.group_position}`);
  });
  document.querySelectorAll('select[data-source="candidates"]').forEach((select) => {
    fillSelect(select, filteredCandidates(), (row) => row.candidate_id, (row) => `${row.candidate_id} - ${row.name}`);
  });
}

function refreshDatalists() {
  fillDatalist("requisition-id-options", uniqueValues(state.requisitions, "doc_id"));
  fillDatalist("site-options", uniqueValues(state.requisitions, "site"));
  fillDatalist("position-options", uniqueValues(state.requisitions, "position"));
  fillDatalist("department-options", uniqueValues(state.requisitions, "department"));
  fillDatalist("section-options", uniqueValues(state.requisitions, "section"));
  fillDatalist("level-options", uniqueValues(state.requisitions, "level"));
  fillDatalist("pic-options", uniqueValues(state.requisitions, "person_in_charge"));
  fillDatalist("manager-options", uniqueValues(state.requisitions, "line_manager"));
  fillDatalist("group-position-options", uniqueValues(state.position_groups, "group_position"));
  fillDatalist("candidate-channel-options", uniqueValues(state.candidates, "channel"));
  fillDatalist("ref-name-options", uniqueValues(state.candidates, "ref_name"));
  fillDatalist("interviewer-options", uniqueValues(state.recruitment_logs, "interviewer"));
  fillDatalist("offer-type-options", uniqueValues(state.offers, "offered_type"));
  fillDatalist("replaced-options", uniqueValues(state.offers, "replaced"));
}

function renderMetrics() {
  const requisitions = filteredRequisitions();
  document.querySelector("#metric-requisitions").textContent = requisitions.filter((row) => row.current_status === "ongoing").length;
  document.querySelector("#metric-candidates").textContent = filteredCandidates().length;
  document.querySelector("#metric-offers").textContent = filteredOffers().length;
  document.querySelector("#metric-open-hc").textContent = requisitions.reduce((sum, row) => sum + openHeadcount(row), 0);
}

function renderNeedsAction() {
  const container = document.querySelector("#needs-action-list");
  const items = [];

  for (const row of filteredRequisitions()) {
    if (row.current_status === "ongoing" && Number(row.candidate_count || 0) === 0) {
      items.push({ title: `${row.doc_id} has no candidates`, body: `${row.position} - ${row.site} - ${row.person_in_charge || "No owner"}`, type: "requisition", id: row.doc_id });
    }
    if (openHeadcount(row) > 0 && acceptedOfferCount(row) > 0) {
      items.push({ title: `${row.doc_id} still has ${openHeadcount(row)} open headcount`, body: `${acceptedOfferCount(row)} accepted of ${row.head_count}`, type: "requisition", id: row.doc_id });
    }
  }

  for (const candidate of activePipelineCandidates()) {
    const latest = latestCandidateLog(candidate.candidate_id);
    if (!latest?.log_date) {
      items.push({ title: `${candidate.name} has no process update`, body: `${candidate.candidate_id} - ${candidate.person_in_charge || "No owner"}`, type: "candidate", id: candidate.candidate_id });
    }
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty">No immediate action items for the current filters.</p>';
    return;
  }

  container.innerHTML = items
    .slice(0, 8)
    .map((item) => `<button type="button" class="work-item action-item" data-detail-type="${escapeHtml(item.type)}" data-detail-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></button>`)
    .join("");
}

function renderRequisitions() {
  const tbody = document.querySelector("#requisition-table");
  const rows = filteredRequisitions();

  if (!rows.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="10">No requisitions match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td><button type="button" class="link-button" data-detail-requisition="${escapeHtml(row.doc_id)}">${escapeHtml(row.doc_id)}</button></td>
          <td>${escapeHtml(row.position)}</td>
          <td>${escapeHtml(row.department)}</td>
          <td>${escapeHtml(row.section)}</td>
          <td>${escapeHtml(row.person_in_charge)}</td>
          <td>${statusBadge(row.current_status)}</td>
          <td>${escapeHtml(row.head_count)}</td>
          <td>${escapeHtml(row.offer_count)}</td>
          <td>${escapeHtml(row.candidate_count)}</td>
          <td><button type="button" class="small secondary" data-edit-requisition="${escapeHtml(row.doc_id)}">Edit</button></td>
        </tr>
      `,
    )
    .join("");
}

function renderCandidates() {
  const tbody = document.querySelector("#candidate-table");
  const rows = filteredCandidates();

  if (!rows.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="8">No candidates match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td><button type="button" class="link-button" data-detail-candidate="${escapeHtml(row.candidate_id)}">${escapeHtml(row.candidate_id)}</button></td>
          <td><button type="button" class="link-button" data-detail-candidate="${escapeHtml(row.candidate_id)}">${escapeHtml(row.name)}</button></td>
          <td>${escapeHtml(row.group_position || row.doc_group_id)}</td>
          <td>${escapeHtml(row.site)}</td>
          <td>${escapeHtml(row.person_in_charge)}</td>
          <td>${escapeHtml(row.latest_process)}</td>
          <td>${resultBadge(row.latest_result)}</td>
          <td><button type="button" class="small secondary" data-edit-candidate="${escapeHtml(row.candidate_id)}">Edit</button></td>
        </tr>
      `,
    )
    .join("");
}

function renderPipelineBoard(board) {
  const grouped = new Map(processOrder.map((process) => [process, []]));

  for (const candidate of activePipelineCandidates()) {
    const process = candidate.latest_process || "No activity";
    if (!grouped.has(process)) grouped.set(process, []);
    grouped.get(process).push(candidate);
  }

  board.replaceChildren();
  for (const [process, rows] of grouped.entries()) {
    const column = document.createElement("section");
    column.className = "pipeline-column";
    column.dataset.process = process;
    column.dataset.processIndex = processIndex(process);
    column.innerHTML = `<h3>${escapeHtml(p(process))} <span>${rows.length}</span></h3>`;

    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = t("noCandidates");
      column.append(empty);
    } else {
      for (const row of rows) {
        const latest = latestCandidateLog(row.candidate_id);
        const card = document.createElement("div");
        card.className = "pipeline-card";
        card.draggable = true;
        card.dataset.candidateId = row.candidate_id;
        card.dataset.candidateName = row.name;
        card.dataset.currentProcess = row.latest_process || "No activity";
        card.dataset.currentIndex = processIndex(row.latest_process);
        card.innerHTML = `
          <span class="pipeline-status ${row.latest_result === 1 ? "pass" : row.latest_result === 0 ? "fail" : "pending"}">${escapeHtml(resultText(row.latest_result))}</span>
          <strong>${escapeHtml(row.name)}</strong>
          <p>${escapeHtml(row.candidate_id)} - ${escapeHtml(row.group_position)}</p>
          <div class="tag-row">
            <span>${escapeHtml(row.site || "-")}</span>
            <span>${escapeHtml(row.person_in_charge || "-")}</span>
          </div>
          <p>${escapeHtml(latest?.log_date ? `${t("lastUpdate")}: ${latest.log_date}` : t("noUpdateYet"))}</p>
        `;
        column.append(card);
      }
    }
    board.append(column);
  }
}

function renderPipeline() {
  renderPipelineBoard(document.querySelector("#pipeline-board"));
  renderPipelineBoard(document.querySelector("#pipeline-board-full"));
}

function nextProcessRound(candidateId, nextProcess) {
  const matchingLogs = state.recruitment_logs.filter((log) => log.candidate_id === candidateId && log.recruitment_process === nextProcess);
  return matchingLogs.reduce((max, log) => Math.max(max, Number(log.round || 0)), 0) + 1;
}

function openPipelineProcessDialog(candidate, nextProcess) {
  const dialog = document.querySelector("#process-dialog");
  const form = dialog?.querySelector("form");
  if (!dialog || !form) return;

  form.reset();
  refreshSelects();
  form.elements.namedItem("candidate_id").value = candidate.candidate_id;
  form.elements.namedItem("log_date").value = today();
  form.elements.namedItem("recruitment_process").value = nextProcess;
  form.elements.namedItem("round").value = nextProcessRound(candidate.candidate_id, nextProcess);
  form.elements.namedItem("result").value = "";
  form.elements.namedItem("remark").value = `Moved from ${candidate.latest_process || "No activity"} to ${nextProcess} by pipeline drag and drop`;
  setStatus(t("processDialogReady"));
  dialog.showModal();
}

function renderActivity() {
  const container = document.querySelector("#activity-list");
  const logs = filteredRecruitmentLogs();

  if (!logs.length) {
    container.innerHTML = '<p class="empty">No recruitment activity matches the current filters.</p>';
    return;
  }

  container.innerHTML = logs
    .slice(0, 8)
    .map(
      (row) => `
        <div class="activity-item">
          <strong>${escapeHtml(row.log_date)}</strong>
          <p>${escapeHtml(row.candidate_name)} - ${escapeHtml(row.recruitment_process)} round ${escapeHtml(row.round)} ${resultBadge(row.result)}</p>
        </div>
      `,
    )
    .join("");
}

function renderOffers() {
  const tbody = document.querySelector("#offer-table");
  const rows = filteredOffers();

  if (!rows.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="7">No offers match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.candidate_name || row.candidate_id)}</td>
          <td>${escapeHtml(row.doc_id)}</td>
          <td>${escapeHtml(row.position)}</td>
          <td>${escapeHtml(row.accepted_date)}</td>
          <td>${escapeHtml(row.first_working_date)}</td>
          <td>${escapeHtml(row.offered_type)}</td>
          <td><button type="button" class="small secondary" data-open-form="offer-dialog">Edit</button></td>
        </tr>
      `,
    )
    .join("");
}

function renderSetup() {
  const groupContainer = document.querySelector("#position-group-list");
  groupContainer.innerHTML = state.position_groups.length
    ? state.position_groups
        .map(
          (row) => `
            <div class="work-item">
              <strong>${escapeHtml(row.group_id)} - ${escapeHtml(row.group_position)}</strong>
              <p>Facebook ${row.channel_fb ? "yes" : "no"} - JobThai ${row.channel_jobthai ? "yes" : "no"} - JobTopGun ${row.channel_jobtopgun ? "yes" : "no"} - JobDB ${row.channel_jobdb ? "yes" : "no"}</p>
            </div>
          `,
        )
        .join("")
    : '<p class="empty">No position groups yet.</p>';

  const matchContainer = document.querySelector("#group-match-list");
  matchContainer.innerHTML = filteredGroups().length
    ? filteredGroups()
        .map(
          (row) => `
            <div class="work-item">
              <strong>${escapeHtml(row.doc_id)} - ${escapeHtml(row.group_id || row.doc_group_id)}</strong>
              <p>${escapeHtml(row.group_position)} - ${escapeHtml(row.site)} - ${escapeHtml(row.person_in_charge)}</p>
            </div>
          `,
        )
        .join("")
    : '<p class="empty">No requisition/group matches for the current filters.</p>';
}

function renderAudit() {
  const tbody = document.querySelector("#audit-table");
  if (!state.change_logs.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="4">No change logs yet.</td></tr>';
    return;
  }

  tbody.innerHTML = state.change_logs
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.changed_at)}</td>
          <td>${escapeHtml(row.entity)}</td>
          <td>${escapeHtml(row.entity_id)}</td>
          <td>${escapeHtml(row.action)}</td>
        </tr>
      `,
    )
    .join("");
}

function openRequisitionDetail(docId) {
  const row = state.requisitions.find((item) => item.doc_id === docId);
  if (!row) return;
  const candidates = requisitionCandidates(docId);
  const offers = requisitionOffers(docId);
  document.querySelector("#requisition-detail-title").textContent = `${row.doc_id} - ${row.position}`;
  document.querySelector("#requisition-detail-kicker").textContent = t("requisitions");
  document.querySelector("#requisition-detail-body").innerHTML = `
    ${detailGrid([
      ["Doc ID", row.doc_id],
      ["Position", row.position],
      ["Department", row.department],
      ["Section", row.section],
      [t("site"), row.site],
      [t("personInCharge"), row.person_in_charge],
      ["Status", row.current_status],
      ["Headcount", `${acceptedOfferCount(row)} / ${row.head_count}`],
      ["Open", openHeadcount(row)],
    ])}
    <div class="detail-section">
      <h4>${escapeHtml(t("candidates"))}</h4>
      ${
        candidates.length
          ? candidates
              .map((candidate) => `<button type="button" class="detail-list-item" data-detail-candidate="${escapeHtml(candidate.candidate_id)}"><strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.candidate_id)} - ${escapeHtml(p(candidate.latest_process))}</span></button>`)
              .join("")
          : `<p class="empty">${escapeHtml(t("noCandidates"))}</p>`
      }
    </div>
    <div class="detail-section">
      <h4>${escapeHtml(t("offers"))}</h4>
      ${
        offers.length
          ? offers.map((offer) => `<div class="detail-list-item"><strong>${escapeHtml(offer.candidate_name || offer.candidate_id)}</strong><span>${escapeHtml(offer.accepted_date || "-")} - ${escapeHtml(offer.first_working_date || "-")}</span></div>`).join("")
          : `<p class="empty">${escapeHtml(t("noRecords"))}</p>`
      }
    </div>
  `;
  document.querySelector("#requisition-detail-dialog").showModal();
}

function openCandidateDetail(candidateId) {
  const row = state.candidates.find((item) => item.candidate_id === candidateId);
  if (!row) return;
  const logs = candidateLogs(candidateId);
  const offers = state.offers.filter((offer) => offer.candidate_id === candidateId);
  document.querySelector("#candidate-detail-title").textContent = `${row.name} - ${row.candidate_id}`;
  document.querySelector("#candidate-detail-kicker").textContent = t("candidate");
  document.querySelector("#candidate-detail-body").innerHTML = `
    ${detailGrid([
      ["ID", row.candidate_id],
      ["Name", row.name],
      ["Group", row.group_position || row.doc_group_id],
      [t("site"), row.site],
      [t("personInCharge"), row.person_in_charge],
      [t("process"), p(row.latest_process)],
      [t("result"), resultText(row.latest_result)],
      ["Last update", logs[0]?.log_date || "-"],
    ])}
    <div class="detail-actions">
      <button type="button" class="small" data-open-candidate-update="${escapeHtml(row.candidate_id)}">${escapeHtml(t("processUpdate"))}</button>
      <button type="button" class="small secondary" data-edit-candidate="${escapeHtml(row.candidate_id)}">${escapeHtml("Edit")}</button>
    </div>
    <div class="detail-section">
      <h4>${escapeHtml(t("process"))}</h4>
      ${detailTimeline(logs)}
    </div>
    <div class="detail-section">
      <h4>${escapeHtml(t("offers"))}</h4>
      ${
        offers.length
          ? offers.map((offer) => `<div class="detail-list-item"><strong>${escapeHtml(offer.doc_id)}</strong><span>${escapeHtml(offer.accepted_date || "-")} - ${escapeHtml(offer.first_working_date || "-")}</span></div>`).join("")
          : `<p class="empty">${escapeHtml(t("noRecords"))}</p>`
      }
    </div>
  `;
  document.querySelector("#candidate-detail-dialog").showModal();
}

function render() {
  renderMetrics();
  renderNeedsAction();
  renderRequisitions();
  renderCandidates();
  renderPipeline();
  renderActivity();
  renderOffers();
  renderSetup();
  renderAudit();
  refreshSelects();
  refreshDatalists();
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
  Object.assign(state, await response.json());
  render();
}

function formPayload(form) {
  const payload = {};
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) payload[key] = value;
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    payload[input.name] = input.checked ? "1" : "";
  });
  return payload;
}

function openConfirmation(form, payload) {
  pendingSubmit = { form, payload };
  const mode = payload.mode || "new";
  const entity = form.dataset.entity || "Record";
  confirmTitle.textContent = `${mode === "change" ? t("confirmChange") : t("confirmAdd")}: ${entity}`;
  confirmSummary.textContent =
    mode === "change"
      ? currentLang === "th"
        ? "ระบบจะแก้ไขข้อมูลเดิมและบันทึกประวัติการเปลี่ยนแปลง"
        : "This will update an existing record and store a change log."
      : currentLang === "th"
        ? "ระบบจะสร้างข้อมูลใหม่ และป้องกันการสร้างคีย์ซ้ำ"
        : "This will create a new record. Existing keys are blocked by the server.";
  confirmDetails.replaceChildren();

  for (const [key, value] of Object.entries(payload).filter(([key]) => key !== "mode")) {
    const term = document.createElement("dt");
    term.textContent = key.replaceAll("_", " ");
    const description = document.createElement("dd");
    description.textContent = valueOrDash(value);
    confirmDetails.append(term, description);
  }

  confirmDialog.showModal();
}

async function submitForm(form) {
  const response = await fetch(form.dataset.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formPayload(form)),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);

  form.reset();
  form.querySelectorAll('input[type="date"][required]').forEach((input) => {
    input.value = today();
  });
  await loadDashboard();
  form.closest("dialog")?.close();
}

async function submitPayload(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
  await loadDashboard();
}

function switchView(viewId) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewId));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
  const labels = {
    dashboard: [t("workQueue"), t("dashboard")],
    requisitions: [t("hiringDemand"), t("requisitions")],
    candidates: [t("talentTracking"), t("candidates")],
    pipeline: [t("processBoard"), t("pipeline")],
    offers: [t("hiringOutcome"), t("offers")],
    setup: [t("configuration"), t("setup")],
    audit: [t("history"), t("audit")],
  };
  const [kicker, title] = labels[viewId] || labels.dashboard;
  viewKicker.textContent = kicker;
  viewTitle.textContent = title;
}

function openDialog(id, keepValues = false) {
  const dialog = document.querySelector(`#${id}`);
  if (!dialog) return;
  const form = dialog.querySelector("form");
  if (form && !keepValues) {
    form.reset();
    form.querySelectorAll('input[name="mode"][value="new"]').forEach((input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    form.querySelectorAll('input[type="date"][required]').forEach((input) => {
      input.value = today();
    });
  }
  dialog.showModal();
}

function setFormValues(form, record) {
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    const field = form.elements.namedItem(key);
    if (!field || field instanceof RadioNodeList) continue;
    if (field.type === "checkbox") field.checked = value === 1 || value === "1" || value === true;
    else field.value = value ?? "";
  }
}

function setNodeText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function setLabelText(selector, value) {
  const label = document.querySelector(selector);
  if (!label) return;
  const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = value;
}

function applyLanguage() {
  document.documentElement.lang = currentLang === "th" ? "th" : "en";
  languageToggle.textContent = currentLang === "en" ? "TH" : "EN";

  const navLabels = {
    dashboard: t("dashboard"),
    requisitions: t("requisitions"),
    candidates: t("candidates"),
    pipeline: t("pipeline"),
    offers: t("offers"),
    setup: t("setup"),
    audit: t("audit"),
  };
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.textContent = navLabels[button.dataset.view] || button.textContent;
  });

  setNodeText('[data-open-form="requisition-dialog"]', t("newRequisition"));
  setNodeText('[data-open-form="candidate-dialog"]', t("newCandidate"));
  setNodeText('[data-open-form="process-dialog"]', t("processUpdate"));
  setNodeText("#refresh-button", t("refresh"));
  setNodeText("#clear-filters", t("clear"));
  setLabelText('label:has(#site-filter)', t("site"));
  setLabelText('label:has(#pic-filter)', t("personInCharge"));
  siteFilter.placeholder = currentLang === "th" ? "ทุกไซต์" : "All sites";
  picFilter.placeholder = currentLang === "th" ? "ทุกผู้รับผิดชอบ" : "All owners";

  document.querySelector("#metric-requisitions")?.nextElementSibling && (document.querySelector("#metric-requisitions").nextElementSibling.textContent = t("activeRequisitions"));
  document.querySelector("#metric-candidates")?.nextElementSibling && (document.querySelector("#metric-candidates").nextElementSibling.textContent = t("candidates"));
  document.querySelector("#metric-offers")?.nextElementSibling && (document.querySelector("#metric-offers").nextElementSibling.textContent = t("acceptedOffers"));
  document.querySelector("#metric-open-hc")?.nextElementSibling && (document.querySelector("#metric-open-hc").nextElementSibling.textContent = t("openHeadcount"));

  setNodeText("#dashboard .layout article:nth-child(1) h3", t("needsAction"));
  setNodeText("#dashboard .layout article:nth-child(2) h3", t("recentActivity"));
  document.querySelectorAll("#dashboard article h3, #pipeline article h3").forEach((heading) => {
    if (heading.textContent.includes("Candidate Pipeline") || heading.textContent.includes("ขั้นตอนผู้สมัคร")) heading.textContent = t("candidatePipeline");
  });
  setNodeText('[data-view-jump="pipeline"]', t("fullPipeline"));
  setNodeText('#pipeline [data-open-form="process-dialog"]', t("addUpdate"));

  setNodeText("#process-dialog h3", t("processUpdate"));
  setNodeText('#process-dialog button[type="submit"]', t("addProcessUpdate"));
  setLabelText('#process-dialog label:has([name="candidate_id"])', t("candidate"));
  setLabelText('#process-dialog label:has([name="log_date"])', t("date"));
  setLabelText('#process-dialog label:has([name="recruitment_process"])', t("process"));
  setLabelText('#process-dialog label:has([name="round"])', t("round"));
  setLabelText('#process-dialog label:has([name="interviewer"])', t("interviewer"));
  setLabelText('#process-dialog label:has([name="result"])', t("result"));
  setLabelText('#process-dialog label:has([name="remark"])', t("remark"));
  document.querySelectorAll('#process-dialog select[name="recruitment_process"] option').forEach((option) => {
    option.textContent = p(option.value);
  });
  const resultSelect = document.querySelector('#process-dialog select[name="result"]');
  if (resultSelect) {
    resultSelect.options[0].textContent = t("pending");
    resultSelect.options[1].textContent = t("pass");
    resultSelect.options[2].textContent = t("fail");
  }

  setNodeText("#confirm-title", t("confirmSave"));
  setNodeText("#cancel-submit", t("cancel"));
  setNodeText("#confirm-submit", t("confirm"));

  switchView(document.querySelector(".view.is-active")?.id || "dashboard");
}

function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-view-jump]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewJump)));
}

function setupDialogButtons() {
  document.querySelectorAll("[data-open-form]").forEach((button) => button.addEventListener("click", () => openDialog(button.dataset.openForm)));
  document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
}

function setupForms() {
  document.querySelectorAll("form[data-endpoint]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.classList.add("was-validated");
        form.reportValidity();
        setStatus(currentLang === "th" ? "กรอกข้อมูลที่จำเป็นให้ครบก่อนบันทึก" : "Complete the required fields before saving.", true);
        return;
      }
      openConfirmation(form, formPayload(form));
    });
  });
}

function setupModeControls() {
  document.querySelectorAll("form[data-endpoint]").forEach((form) => {
    const modeInputs = form.querySelectorAll('input[name="mode"]');
    if (!modeInputs.length) return;

    const applyMode = () => {
      const mode = form.querySelector('input[name="mode"]:checked')?.value || "new";
      form.querySelectorAll('select[name="candidate_id"], select[name="group_id"]').forEach((select) => {
        select.required = mode === "change";
        if (mode === "new") select.value = "";
      });
    };

    modeInputs.forEach((input) => input.addEventListener("change", applyMode));
    applyMode();
  });
}

function setupChangePrefill() {
  const requisitionForm = document.querySelector('#requisition-dialog form');
  requisitionForm?.elements.namedItem("doc_id")?.addEventListener("change", (event) => {
    if (requisitionForm.querySelector('input[name="mode"]:checked')?.value !== "change") return;
    setFormValues(requisitionForm, state.requisitions.find((row) => row.doc_id === event.target.value));
  });

  const groupForm = document.querySelector('#group-dialog form');
  groupForm?.elements.namedItem("group_id")?.addEventListener("change", (event) => {
    if (groupForm.querySelector('input[name="mode"]:checked')?.value !== "change") return;
    setFormValues(groupForm, state.position_groups.find((row) => row.group_id === event.target.value));
  });

  const candidateForm = document.querySelector('#candidate-dialog form');
  candidateForm?.elements.namedItem("candidate_id")?.addEventListener("change", (event) => {
    if (candidateForm.querySelector('input[name="mode"]:checked')?.value !== "change") return;
    setFormValues(candidateForm, state.candidates.find((row) => row.candidate_id === event.target.value));
  });
}

function setupTableActions() {
  document.addEventListener("click", (event) => {
    const actionItem = event.target.closest("[data-detail-type]");
    if (actionItem) {
      if (actionItem.dataset.detailType === "requisition") openRequisitionDetail(actionItem.dataset.detailId);
      if (actionItem.dataset.detailType === "candidate") openCandidateDetail(actionItem.dataset.detailId);
      return;
    }

    const requisitionDetailButton = event.target.closest("[data-detail-requisition]");
    if (requisitionDetailButton) {
      openRequisitionDetail(requisitionDetailButton.dataset.detailRequisition);
      return;
    }

    const candidateDetailButton = event.target.closest("[data-detail-candidate]");
    if (candidateDetailButton) {
      openCandidateDetail(candidateDetailButton.dataset.detailCandidate);
      return;
    }

    const updateCandidateButton = event.target.closest("[data-open-candidate-update]");
    if (updateCandidateButton) {
      const candidate = state.candidates.find((row) => row.candidate_id === updateCandidateButton.dataset.openCandidateUpdate);
      if (candidate) openPipelineProcessDialog(candidate, candidate.latest_process && candidate.latest_process !== "No activity" ? candidate.latest_process : "First Contact");
      return;
    }

    const pipelineCard = event.target.closest(".pipeline-card");
    if (pipelineCard && !event.target.closest(".pipeline-status")) {
      openCandidateDetail(pipelineCard.dataset.candidateId);
      return;
    }

    const requisitionButton = event.target.closest("[data-edit-requisition]");
    if (requisitionButton) {
      const form = document.querySelector("#requisition-dialog form");
      form.reset();
      form.querySelector('input[name="mode"][value="change"]').checked = true;
      setFormValues(form, state.requisitions.find((row) => row.doc_id === requisitionButton.dataset.editRequisition));
      openDialog("requisition-dialog", true);
    }

    const candidateButton = event.target.closest("[data-edit-candidate]");
    if (candidateButton) {
      const form = document.querySelector("#candidate-dialog form");
      form.reset();
      form.querySelector('input[name="mode"][value="change"]').checked = true;
      setFormValues(form, state.candidates.find((row) => row.candidate_id === candidateButton.dataset.editCandidate));
      openDialog("candidate-dialog", true);
    }
  });
}

function setupPipelineDragDrop() {
  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".pipeline-card");
    if (!card) return;
    draggedCandidate = {
      candidate_id: card.dataset.candidateId,
      name: card.dataset.candidateName,
      latest_process: card.dataset.currentProcess,
      current_index: Number(card.dataset.currentIndex || 0),
    };
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedCandidate.candidate_id);
  });

  document.addEventListener("dragend", (event) => {
    event.target.closest(".pipeline-card")?.classList.remove("is-dragging");
    document.querySelectorAll(".pipeline-column").forEach((column) => column.classList.remove("is-drop-target", "is-blocked"));
    draggedCandidate = null;
  });

  document.addEventListener("dragover", (event) => {
    const column = event.target.closest(".pipeline-column");
    if (!column || !draggedCandidate) return;
    const targetIndex = Number(column.dataset.processIndex || 0);
    column.classList.toggle("is-drop-target", targetIndex > draggedCandidate.current_index);
    column.classList.toggle("is-blocked", targetIndex <= draggedCandidate.current_index);
    if (targetIndex > draggedCandidate.current_index) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  });

  document.addEventListener("dragleave", (event) => {
    const column = event.target.closest(".pipeline-column");
    if (!column || column.contains(event.relatedTarget)) return;
    column.classList.remove("is-drop-target", "is-blocked");
  });

  document.addEventListener("drop", (event) => {
    const column = event.target.closest(".pipeline-column");
    if (!column || !draggedCandidate) return;
    event.preventDefault();
    const targetIndex = Number(column.dataset.processIndex || 0);
    if (targetIndex <= draggedCandidate.current_index) {
      setStatus(t("pipelineForwardOnly"), true);
      return;
    }

    const candidate = state.candidates.find((row) => row.candidate_id === draggedCandidate.candidate_id);
    if (!candidate) {
      setStatus("Candidate not found.", true);
      return;
    }
    openPipelineProcessDialog(candidate, column.dataset.process);
  });
}

function setDefaultDates() {
  document.querySelectorAll('input[type="date"][required]').forEach((input) => {
    if (!input.value) input.value = today();
  });
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  setStatus(t("refreshing"));
  try {
    await loadDashboard();
    setStatus(t("loaded"));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    refreshButton.disabled = false;
  }
});

languageToggle.addEventListener("click", () => {
  currentLang = currentLang === "en" ? "th" : "en";
  localStorage.setItem("recruitment_lang", currentLang);
  applyLanguage();
  render();
  setStatus(t("loaded"));
});

siteFilter.addEventListener("input", render);
siteFilter.addEventListener("change", saveFilters);
picFilter.addEventListener("input", render);
picFilter.addEventListener("change", saveFilters);
clearFiltersButton.addEventListener("click", () => {
  siteFilter.value = "";
  picFilter.value = "";
  saveFilters();
  render();
});

cancelSubmit.addEventListener("click", () => {
  pendingSubmit = null;
  confirmDialog.close();
});

confirmSubmit.addEventListener("click", async () => {
  if (!pendingSubmit) return;
  const { form, endpoint, payload, source } = pendingSubmit;
  const button = form?.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  confirmSubmit.disabled = true;
  setStatus(t("saving"));

  try {
    if (source === "pipeline") {
      await submitPayload(endpoint, payload);
    } else {
      await submitForm(form);
    }
    confirmDialog.close();
    pendingSubmit = null;
    setStatus(t("saved"));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    if (button) button.disabled = false;
    confirmSubmit.disabled = false;
  }
});

setupNavigation();
setupDialogButtons();
setupForms();
setupModeControls();
setupChangePrefill();
setupTableActions();
setupPipelineDragDrop();
enhanceSearchableInputs();
siteFilter.value = savedFilters.site || "";
picFilter.value = savedFilters.person_in_charge || "";
applyLanguage();
setDefaultDates();
loadDashboard()
  .then(() => setStatus(t("loaded")))
  .catch((error) => setStatus(error.message, true));
