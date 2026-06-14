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
  if (value === 1) return '<span class="badge pass">Pass</span>';
  if (value === 0) return '<span class="badge fail">Fail</span>';
  return '<span class="badge pending">Pending</span>';
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

function acceptedOfferCount(row) {
  return Number(row.offer_count || 0);
}

function openHeadcount(row) {
  return Math.max(0, Number(row.head_count || 0) - acceptedOfferCount(row));
}

function fillSelect(select, rows, getValue, getLabel) {
  const currentValue = select.value;
  select.replaceChildren();

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = rows.length ? "Select..." : "No records yet";
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
      items.push({ title: `${row.doc_id} has no candidates`, body: `${row.position} - ${row.site} - ${row.person_in_charge || "No owner"}` });
    }
    if (openHeadcount(row) > 0 && acceptedOfferCount(row) > 0) {
      items.push({ title: `${row.doc_id} still has ${openHeadcount(row)} open headcount`, body: `${acceptedOfferCount(row)} accepted of ${row.head_count}` });
    }
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty">No immediate action items for the current filters.</p>';
    return;
  }

  container.innerHTML = items
    .slice(0, 8)
    .map((item) => `<div class="work-item"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></div>`)
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
          <td>${escapeHtml(row.doc_id)}</td>
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
          <td>${escapeHtml(row.candidate_id)}</td>
          <td>${escapeHtml(row.name)}</td>
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
  const processOrder = ["No activity", "First Contact", "Phone Screen", "HR Interview", "Line Interview", "Test", "Reference Check", "Offer", "Rejected", "Withdrawn"];
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
    column.innerHTML = `<h3>${escapeHtml(process)} <span>${rows.length}</span></h3>`;

    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No candidates";
      column.append(empty);
    } else {
      for (const row of rows) {
        const card = document.createElement("div");
        card.className = "pipeline-card";
        card.innerHTML = `
          <strong>${escapeHtml(row.name)}</strong>
          <p>${escapeHtml(row.candidate_id)} - ${escapeHtml(row.group_position)}</p>
          <p>${escapeHtml(row.site)} - ${escapeHtml(row.person_in_charge)}</p>
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
  confirmTitle.textContent = `${mode === "change" ? "Confirm Change" : "Confirm Add"}: ${entity}`;
  confirmSummary.textContent = mode === "change" ? "This will update an existing record and store a change log." : "This will create a new record. Existing keys are blocked by the server.";
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

function switchView(viewId) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewId));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
  const labels = {
    dashboard: ["Work Queue", "Dashboard"],
    requisitions: ["Hiring Demand", "Requisitions"],
    candidates: ["Talent Tracking", "Candidates"],
    pipeline: ["Process Board", "Pipeline"],
    offers: ["Hiring Outcome", "Offers"],
    setup: ["Configuration", "Setup"],
    audit: ["History", "Audit Log"],
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

function setDefaultDates() {
  document.querySelectorAll('input[type="date"][required]').forEach((input) => {
    if (!input.value) input.value = today();
  });
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  setStatus("Refreshing...");
  try {
    await loadDashboard();
    setStatus("Recruitment records loaded.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    refreshButton.disabled = false;
  }
});

siteFilter.addEventListener("input", render);
picFilter.addEventListener("input", render);
clearFiltersButton.addEventListener("click", () => {
  siteFilter.value = "";
  picFilter.value = "";
  render();
});

cancelSubmit.addEventListener("click", () => {
  pendingSubmit = null;
  confirmDialog.close();
});

confirmSubmit.addEventListener("click", async () => {
  if (!pendingSubmit) return;
  const { form } = pendingSubmit;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  confirmSubmit.disabled = true;
  setStatus("Saving...");

  try {
    await submitForm(form);
    confirmDialog.close();
    pendingSubmit = null;
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
    confirmSubmit.disabled = false;
  }
});

setupNavigation();
setupDialogButtons();
setupForms();
setupModeControls();
setupChangePrefill();
setupTableActions();
setDefaultDates();
loadDashboard()
  .then(() => setStatus("Recruitment records loaded."))
  .catch((error) => setStatus(error.message, true));
