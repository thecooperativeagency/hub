const KEY = "coop-planner-key";
const VIEWS = [
  ["desk", "Desk"],
  ["quarter", "Quarter"],
  ["month", "Month"],
  ["needs", "Needs"],
  ["briefs", "Briefs"],
  ["queue", "Queue"],
  ["week", "Week"],
  ["shoots", "Shoots"],
  ["programs", "Programs"],
  ["events", "Events"],
  ["tasks", "Tasks"],
  ["approvals", "Approvals"],
];
const POST_STATUS = {
  on_pace: ["On pace", "ok"],
  behind: ["Behind", "behind"],
  most_behind: ["Most behind", "most"],
  no_posts: ["No posts", "behind"],
};
const STEP_LABEL = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  blocked: "Blocked",
  na: "N/A",
};
const CAL_STATUS = [
  ["planned", "Planned"],
  ["in_progress", "In progress"],
  ["ready", "Ready"],
  ["done", "Done"],
  ["dropped", "Dropped"],
];
const SHOOT_STATUS = [
  ["planned", "Planned"],
  ["confirmed", "Confirmed"],
  ["done", "Done"],
  ["cancelled", "Cancelled"],
];
const TASK_STATUS = [
  ["open", "Open"],
  ["doing", "Doing"],
  ["done", "Done"],
  ["parked", "Parked"],
];
const APPROVAL_STATUS = [
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["changes", "Changes"],
  ["declined", "Declined"],
];
const KINDS = [
  ["creative", "Creative"],
  ["publish", "Publish"],
  ["sponsorship", "Sponsorship"],
  ["program", "Program"],
  ["other", "Other"],
];

const params = new URLSearchParams(location.search);
const state = {
  view: VIEWS.some(([id]) => id === params.get("view")) ? params.get("view") : "desk",
  month: params.get("month") || "",
  week: "",
  selected: "",
  data: null,
  locked: false,
  offline: false,
  error: "",
  showDecided: false,
  busy: false,
};

const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");
const bannerEl = document.getElementById("banner");
const lockEl = document.getElementById("lock");
const lockBtn = document.getElementById("lock-btn");

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "value") node.value = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function apiBase() {
  const q = new URLSearchParams(location.search).get("api");
  return q ? q.replace(/\/$/, "") : "";
}

function authHeaders() {
  const key = sessionStorage.getItem(KEY) || "";
  if (!key) return {};
  return { Authorization: `Bearer ${key}`, "X-Planner-Pin": key };
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(apiBase() + path, {
      method: opts.method || "GET",
      headers: { ...authHeaders(), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    const error = new Error("offline");
    error.offline = true;
    throw error;
  }
  if (res.status === 401) {
    state.locked = true;
    sessionStorage.removeItem(KEY);
    render();
    throw new Error("locked");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The desk could not save that.");
  return data;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function mondayOf(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const delta = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

function prettyMonth(month) {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function prettyDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function shiftMonth(month, delta) {
  const [year, mon] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
}

function storeName(id) {
  const store = (state.data.stores || []).find((item) => item.id === id);
  return store ? store.name : "Agency";
}

function channelLabel(id) {
  const channel = (state.data.channels || []).find((item) => item.id === id);
  return channel ? channel.label : "";
}

function setView(view) {
  state.view = view;
  const url = new URL(location.href);
  url.searchParams.set("view", view);
  if (state.month) url.searchParams.set("month", state.month);
  history.replaceState(null, "", url);
  render();
}

function showError(form, message) {
  let node = form.querySelector(".form-error");
  if (!node) {
    node = h("p", { class: "form-error" });
    form.append(node);
  }
  node.hidden = false;
  node.textContent = message;
}

function openEditor({ title, fields, submitLabel, onSubmit, onDelete }) {
  const dialog = document.getElementById("editor");
  const form = h("form", {
    class: "editor",
    onSubmit: async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await onSubmit(Object.fromEntries(new FormData(event.target).entries()));
        dialog.close();
        await load();
      } catch (err) {
        button.disabled = false;
        if (err.message !== "locked") showError(form, err.message);
      }
    },
  });
  form.append(
    h("div", { class: "editor-head" },
      h("h3", {}, title),
      h("button", { type: "button", class: "text-button", onClick: () => dialog.close() }, "Close")),
    ...fields.map(fieldControl),
    h("p", { class: "form-error", hidden: true }),
    h("div", { class: "editor-actions" },
      onDelete ? h("button", {
        type: "button",
        class: "btn ghost danger",
        onClick: async () => {
          if (!confirm("Remove this from the desk?")) return;
          try {
            await onDelete();
            dialog.close();
            await load();
          } catch (err) {
            if (err.message !== "locked") showError(form, err.message);
          }
        },
      }, "Remove") : h("span"),
      h("button", { type: "submit", class: "btn" }, submitLabel || "Save")),
  );
  dialog.replaceChildren(form);
  if (!dialog.open) dialog.showModal();
  const first = form.querySelector("input, select, textarea");
  if (first) first.focus();
}

function fieldControl(spec) {
  const id = `f-${spec.name}`;
  let input;
  if (spec.type === "textarea") {
    input = h("textarea", { id, name: spec.name, rows: "4" }, spec.value || "");
  } else if (spec.type === "select") {
    input = h("select", { id, name: spec.name }, ...(spec.options || []).map((opt) => h("option", { value: opt.value }, opt.label)));
    input.value = spec.value == null ? "" : String(spec.value);
  } else {
    input = h("input", { id, name: spec.name, type: spec.type || "text", value: spec.value || "" });
  }
  return h("label", { for: id }, spec.label, input);
}

function storeSelect(value, allowEmpty) {
  const options = (state.data.stores || []).map((store) => ({ value: store.id, label: store.name }));
  if (allowEmpty) options.unshift({ value: "", label: "Agency, not one store" });
  return { name: "storeId", label: "Store", type: "select", value: value || "", options };
}

function ownerSelect(name, label, value, allowEmpty) {
  const options = (state.data.owners || []).map((owner) => ({ value: owner, label: owner }));
  if (allowEmpty) options.unshift({ value: "", label: "Unassigned" });
  return { name, label, type: "select", value: value || "", options };
}

function choiceSelect(name, label, pairs, value) {
  return {
    name,
    label,
    type: "select",
    value: value || pairs[0][0],
    options: pairs.map(([id, text]) => ({ value: id, label: text })),
  };
}

function channelSelect(value) {
  const options = [{ value: "", label: "No channel" }, ...(state.data.channels || []).map((channel) => ({ value: channel.id, label: channel.label }))];
  return { name: "channel", label: "Channel", type: "select", value: value || "", options };
}

async function load() {
  const query = state.month ? `?month=${encodeURIComponent(state.month)}` : "";
  try {
    const data = await api(`/api/planner${query}`);
    state.data = data;
    state.month = data.month;
    state.locked = false;
    state.offline = false;
    state.error = "";
    if (!state.selected) state.selected = data.today;
    if (!state.week) state.week = mondayOf(data.today);
    render();
  } catch (err) {
    if (err.message === "locked") return;
    state.offline = Boolean(err.offline);
    state.error = err.offline ? "" : err.message;
    render();
  }
}

async function changeMonth(next) {
  state.month = next;
  state.selected = `${next}-01`;
  await load();
}

function itemsOn(date) {
  const data = state.data;
  const planned = data.calendar.filter((item) => item.startsOn === date);
  const shoots = data.shoots.filter((item) => item.shootOn === date);
  const posts = data.posts.filter((item) => item.date === date);
  const events = data.events.filter((item) => item.startsOn === date || (item.startsOn && item.endsOn && item.startsOn <= date && item.endsOn >= date));
  return { planned, shoots, posts, events };
}

function render() {
  lockEl.hidden = !state.locked;
  document.querySelector(".page").hidden = state.locked;
  lockBtn.hidden = state.locked || !state.data || state.data.auth.mode === "open";
  renderNav();
  bannerEl.replaceChildren();
  appEl.replaceChildren();
  if (state.locked) return;
  if (state.offline) {
    appEl.append(h("section", { class: "sheet" },
      h("h2", {}, "The desk isn’t answering."),
      h("p", {}, "This page is only the shell. The planner API is not on this host yet, or the browser cannot reach it. Deploy the Worker and route hub.thecoopbrla.com/api/planner* before real use.")));
    return;
  }
  if (!state.data) {
    appEl.append(h("p", {}, state.error || "Opening the desk…"));
    return;
  }
  renderBanner();
  const view = {
    desk: renderDesk,
    quarter: renderQuarter,
    month: renderMonth,
    needs: renderNeeds,
    briefs: renderBriefs,
    queue: renderQueue,
    week: renderWeek,
    shoots: renderShoots,
    programs: renderPrograms,
    events: renderEvents,
    tasks: renderTasks,
    approvals: renderApprovals,
  }[state.view] || renderDesk;
  view();
}

function renderNav() {
  navEl.replaceChildren(...VIEWS.map(([id, label]) => h("button", {
    type: "button",
    "aria-current": state.view === id ? "page" : null,
    onClick: () => setView(id),
  }, label)));
}

function renderBanner() {
  const data = state.data;
  const actions = [];
  if (data.fixtureRows) {
    actions.push(h("button", { type: "button", class: "btn ghost", onClick: clearSamples }, "Clear sample rows"));
  }
  bannerEl.append(h("div", { class: "banner" }, h("p", {}, data.notice), h("div", {}, ...actions)));
}

async function clearSamples() {
  if (!confirm("Remove the fictional sample rows? Posting samples stay until Zernio and PostEngine are connected. This cannot be undone.")) return;
  await api("/api/planner/fixtures", { method: "DELETE" });
  await load();
}

function renderDesk() {
  const data = state.data;
  const worst = data.posting.stores.filter((row) => row.status === "most_behind").map((row) => row.name);
  const quiet = data.posting.stores.filter((row) => row.status === "no_posts").map((row) => row.shortName);
  let summary = "Every store is inside its cadence.";
  if (worst.length) summary = `${worst.join(" and ")} ${worst.length > 1 ? "are" : "is"} furthest behind cadence.`;
  else if (quiet.length) summary = `${quiet.join(", ")} ${quiet.length > 1 ? "have" : "has"} nothing published in this read.`;
  const pending = data.approvals.filter((item) => item.status === "pending");
  const upcoming = data.shoots.filter((item) => item.shootOn >= data.today && item.status !== "cancelled").slice(0, 4);

  appEl.append(h("section", { class: "sheet" },
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, sourceLine(data.posting)), h("h2", {}, "Posting")),
      h("p", { class: "note" }, summary)),
    postingTable(),
  ));

  const lower = h("div", { class: "card-grid" });
  lower.append(h("section", { class: "card" },
    h("p", { class: "kicker" }, "Waiting on Lance"),
    h("h3", {}, pending.length ? `${pending.length} in the queue` : "Queue is clear"),
    pending.length
      ? h("div", {}, ...pending.slice(0, 3).map((item) => h("p", {}, `${storeName(item.storeId)} — ${item.title}`)))
      : h("p", { class: "empty" }, "Nothing needs a yes right now."),
    h("button", { type: "button", class: "text-button", onClick: () => setView("approvals") }, "Open the queue")));
  lower.append(h("section", { class: "card" },
    h("p", { class: "kicker" }, "Shoots · Lance"),
    h("h3", {}, upcoming.length ? "On the books" : "None booked"),
    upcoming.length
      ? h("div", {}, ...upcoming.map((item) => h("p", {}, `${prettyDay(item.shootOn)} · ${storeName(item.storeId)} · ${item.location || item.brief}`)))
      : h("p", { class: "empty" }, "No shoots in this window."),
    h("button", { type: "button", class: "text-button", onClick: () => setView("shoots") }, "Open the schedule")));
  appEl.append(lower);
}

function sourceLine(posting) {
  const label = { fixture: "sample", live: "live", error: "unread" };
  return `Zernio ${label[posting.zernio] || posting.zernio} · PostEngine ${label[posting.postengine] || posting.postengine}`;
}

function postingTable() {
  const wrap = h("div", { class: "table-wrap" });
  const table = h("table", {},
    h("thead", {}, h("tr", {}, ...["Store", "Last post", "Cadence", "Since", "Behind", "Scheduled", ""].map((label) => h("th", {}, label)))),
    h("tbody", {}, ...state.data.posting.stores.map((row) => {
      const [label, kind] = POST_STATUS[row.status] || [row.status, ""];
      const input = h("input", { class: "cadence", type: "number", min: "1", max: "30", value: String(row.cadenceDays), "aria-label": `${row.name} cadence in days` });
      input.addEventListener("change", async () => {
        const cadenceDays = Number(input.value);
        try {
          await api(`/api/planner/stores/${row.storeId}`, { method: "PATCH", body: { cadenceDays } });
          await load();
        } catch (err) {
          if (err.message !== "locked") input.value = String(row.cadenceDays);
        }
      });
      return h("tr", { class: row.status === "most_behind" ? "most" : "" },
        h("td", {}, h("div", { class: "store-name" }, row.name), h("div", { class: "muted" }, row.shortName)),
        h("td", {}, row.lastPostDate ? `${prettyDay(row.lastPostDate)} · ${(row.channels || []).join(" · ") || "posted"}` : "—", row.lastPostTitle ? h("div", { class: "muted" }, row.lastPostTitle) : ""),
        h("td", {}, input, " days"),
        h("td", {}, row.daysSince == null ? "—" : String(row.daysSince)),
        h("td", {}, row.daysBehind == null ? "—" : String(row.daysBehind)),
        h("td", {}, String(row.scheduled)),
        h("td", {}, h("span", { class: `mark ${kind}` }, label)));
    })));
  wrap.append(table);
  return wrap;
}

function renderMonth() {
  const data = state.data;
  const [year, month] = data.month.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push({ date: addDays(`${data.month}-01`, i - startOffset), outside: true });
  for (let day = 1; day <= days; day += 1) cells.push({ date: `${data.month}-${String(day).padStart(2, "0")}`, outside: false });
  while (cells.length % 7) cells.push({ date: addDays(cells[cells.length - 1].date, 1), outside: true });

  const grid = h("div", {},
    h("div", { class: "legend" },
      h("span", {}, h("i", { class: "swatch shoot" }), "Shoot"),
      h("span", {}, h("i", { class: "swatch" }), "Planned"),
      h("span", {}, h("i", { class: "swatch engine" }), "In an engine, read only")),
    h("div", { class: "cal" },
      ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => h("div", { class: "dow" }, label)),
      ...cells.map((cell) => dayCell(cell))));

  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "Content calendar"), h("h2", {}, prettyMonth(data.month))),
      h("div", { class: "pager" },
        h("button", { type: "button", class: "btn ghost", onClick: () => changeMonth(shiftMonth(data.month, -1)) }, "Prev"),
        h("button", { type: "button", class: "btn ghost", onClick: () => changeMonth(shiftMonth(data.month, 1)) }, "Next"),
        h("button", { type: "button", class: "btn", onClick: () => editCalendar(null, state.selected || data.today) }, "Add planned"))),
    h("div", { class: "month-layout" }, grid, dayRail(state.selected || data.today))));
}

function dayCell(cell) {
  const bag = itemsOn(cell.date);
  const chips = [
    ...bag.shoots.map((item) => h("button", { type: "button", class: "chip shoot", onClick: (event) => { event.stopPropagation(); editShoot(item); } }, item.location || item.brief || "Shoot")),
        ...bag.planned.map((item) => h("button", { type: "button", class: "chip", onClick: (event) => { event.stopPropagation(); editCalendar(item); } }, `${item.kind === "post" ? `${item.stage || "brief"} · ` : ""}${item.title.replace(/^SAMPLE — /, "")}`)),
    ...bag.posts.map((item) => h("button", { type: "button", class: "chip engine", onClick: (event) => { event.stopPropagation(); showReadOnly(item); } }, `${(item.channels || []).join(" ") || "Post"} · ${item.title.replace(/^SAMPLE — /, "")}`)),
    ...bag.events.filter((item) => item.decision === "pending").map((item) => h("button", { type: "button", class: "chip event", onClick: (event) => { event.stopPropagation(); setView("events"); } }, "Needs a yes")),
  ];
  const shown = chips.slice(0, 3);
  if (chips.length > 3) shown.push(h("button", { type: "button", class: "more", onClick: (event) => { event.stopPropagation(); state.selected = cell.date; render(); } }, `+${chips.length - 3} more`));
  return h("div", {
    class: `cell${cell.outside ? " is-out" : ""}${cell.date === state.data.today ? " is-today" : ""}${cell.date === state.selected ? " is-selected" : ""}`,
    onClick: () => { state.selected = cell.date; render(); },
  }, h("span", { class: "num" }, String(Number(cell.date.slice(-2)))), ...shown);
}

function dayRail(date) {
  const bag = itemsOn(date);
  const list = h("div", { class: "day-list" });
  if (![...bag.shoots, ...bag.planned, ...bag.posts, ...bag.events].length) {
    list.append(h("p", { class: "empty" }, "Nothing on this day yet."));
  }
  for (const item of bag.shoots) list.append(h("button", { type: "button", class: "chip shoot", onClick: () => editShoot(item) }, `Shoot · ${item.startTime || ""} ${storeName(item.storeId)}`.trim()));
  for (const item of bag.planned) list.append(h("button", { type: "button", class: "chip", onClick: () => editCalendar(item) }, item.title));
  for (const item of bag.posts) list.append(h("p", { class: "note" }, `Read only · ${item.sources ? item.sources.join(" + ") : item.source} · ${item.title}`));
  for (const item of bag.events) list.append(h("p", {}, `${item.decision === "pending" ? "Needs a yes" : item.decision} · ${item.title}`));
  return h("aside", { class: "sheet rail" },
    h("p", { class: "kicker" }, "Selected day"),
    h("h3", {}, prettyDay(date)),
    list,
    h("button", { type: "button", class: "btn", onClick: () => editCalendar(null, date) }, "Add to this day"));
}

function renderWeek() {
  const start = state.week || mondayOf(state.data.today);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "This week of content"), h("h2", {}, `${prettyDay(days[0])} – ${prettyDay(days[6])}`)),
      h("div", { class: "pager" },
        h("button", { type: "button", class: "btn ghost", onClick: () => moveWeek(-7) }, "Prev"),
        h("button", { type: "button", class: "btn ghost", onClick: () => moveWeek(7) }, "Next"))),
    h("div", { class: "week" }, ...days.map((date) => {
      const bag = itemsOn(date);
      return h("article", { class: date === state.data.today ? "is-today" : "" },
        h("span", { class: "num" }, prettyDay(date)),
        ...bag.shoots.map((item) => h("button", { type: "button", class: "chip shoot", onClick: () => editShoot(item) }, item.location || "Shoot")),
        ...bag.planned.map((item) => h("button", { type: "button", class: "chip", onClick: () => editCalendar(item) }, `${item.kind === "post" ? `${item.stage || "brief"} · ` : ""}${item.title.replace(/^SAMPLE — /, "")}`)),
        ...bag.posts.map((item) => h("p", { class: "note" }, item.title.replace(/^SAMPLE — /, ""))),
        h("button", { type: "button", class: "text-button", onClick: () => editCalendar(null, date) }, "Add"));
    }))));
}

async function moveWeek(delta) {
  const next = addDays(state.week || mondayOf(state.data.today), delta);
  state.week = next;
  const end = addDays(next, 6);
  const range = state.data.range;
  if (next < range.from || end > range.to) {
    state.month = next.slice(0, 7);
    await load();
    return;
  }
  render();
}

function renderShoots() {
  const shoots = [...state.data.shoots].sort((a, b) => a.shootOn.localeCompare(b.shootOn) || String(a.startTime || "").localeCompare(String(b.startTime || "")));
  const body = shoots.map((item) => h("tr", {},
    h("td", {}, `${prettyDay(item.shootOn)}${item.startTime ? ` · ${item.startTime}` : ""}`),
    h("td", {}, storeName(item.storeId)),
    h("td", {}, item.shooter),
    h("td", {}, item.location || item.brief),
    h("td", {}, h("button", { type: "button", class: "text-button", onClick: () => editShoot(item) }, item.status))));
  const table = h("table", {},
    h("thead", {}, h("tr", {}, ...["When", "Store", "Shooter", "Where", ""].map((label) => h("th", {}, label)))),
    h("tbody", {}, ...body));
  appEl.append(h("section", { class: "sheet" },
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "Lance is the shooter for now"), h("h2", {}, "Shoots")),
      h("button", { type: "button", class: "btn", onClick: () => editShoot(null) }, "Add a shoot")),
    shoots.length ? h("div", { class: "table-wrap" }, table) : h("p", { class: "empty" }, "No shoots in this month. Add one when Della has a day.")));
}

function renderPrograms() {
  const data = state.data;
  const head = h("tr", {}, h("th", {}, "Store"), ...data.steps.map((step) => h("th", {}, step.short)));
  const body = data.rollouts.map((rollout) => {
    const done = rollout.steps.filter((step) => step.status === "done").length;
    const counted = rollout.steps.filter((step) => step.status !== "na").length;
    return h("tr", {},
      h("td", {},
        h("button", { type: "button", class: "text-button", onClick: () => editRollout(rollout) }, storeName(rollout.storeId)),
        h("div", { class: "prog" }, rollout.programName || "No program name yet"),
        h("div", { class: "muted" }, `${done} of ${counted}`)),
      ...rollout.steps.map((step) => h("td", {}, h("button", {
        type: "button",
        class: `step-btn ${step.status}`,
        onClick: () => editStep(rollout, step),
      }, h("strong", {}, STEP_LABEL[step.status] || step.status), step.owner || "—"))));
  });
  appEl.append(h("section", { class: "sheet" },
    h("div", { class: "section-head" },
      h("div", {},
        h("p", { class: "kicker" }, "Once the programs land"),
        h("h2", {}, prettyMonth(data.month))),
      h("div", { class: "pager" },
        h("button", { type: "button", class: "btn ghost", onClick: () => changeMonth(shiftMonth(data.month, -1)) }, "Prev"),
        h("button", { type: "button", class: "btn ghost", onClick: () => changeMonth(shiftMonth(data.month, 1)) }, "Next"))),
    h("p", { class: "note" }, "Ten steps for each rooftop. Click a cell to set the status and who owns it."),
    h("div", { class: "matrix-wrap" }, h("table", { class: "matrix" }, h("thead", {}, head), h("tbody", {}, ...body)))));
}

function renderEvents() {
  const events = state.data.events;
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "Pending, yes, or no"), h("h2", {}, "Events")),
      h("button", { type: "button", class: "btn", onClick: () => editEvent(null) }, "Add an event")),
    events.length ? h("div", { class: "card-grid" }, ...events.map((item) => h("article", { class: "card" },
      h("p", { class: "kicker" }, `${storeName(item.storeId)}${item.startsOn ? ` · ${prettyDay(item.startsOn)}` : ""}`),
      h("h3", {}, item.title),
      item.offer ? h("p", {}, item.offer) : null,
      item.notes ? h("p", { class: "note" }, item.notes) : null,
      h("div", { class: "decision" }, ...["pending", "yes", "no"].map((decision) => h("button", {
        type: "button",
        "aria-pressed": item.decision === decision ? "true" : "false",
        onClick: () => setDecision(item, decision),
      }, decision === "pending" ? "Pending" : decision === "yes" ? "Yes" : "No"))),
      h("button", { type: "button", class: "text-button", onClick: () => editEvent(item) }, "Edit notes"))))
      : h("p", { class: "empty" }, "No events or sponsorships on the desk.")));
}

async function setDecision(item, decision) {
  await api(`/api/planner/events/${item.id}`, {
    method: "PATCH",
    body: {
      storeId: item.storeId || "",
      title: item.title,
      startsOn: item.startsOn || "",
      endsOn: item.endsOn || "",
      decision,
      offer: item.offer || "",
      notes: item.notes || "",
      owner: item.owner || "",
    },
  });
  await load();
}

function renderTasks() {
  const owners = state.data.owners || [];
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "Who has it"), h("h2", {}, "Tasks"))),
    h("div", { class: "owner-grid" }, ...owners.map((owner) => {
      const tasks = state.data.tasks.filter((task) => task.owner === owner && task.status !== "done");
      return h("section", { class: "owner-col" },
        h("h3", {}, owner),
        tasks.length ? h("div", {}, ...tasks.map((task) => h("div", { class: "task" },
          h("button", { type: "button", class: "item", onClick: () => editTask(task) }, task.title),
          h("div", { class: "muted" }, [storeName(task.storeId), task.dueOn ? prettyDay(task.dueOn) : "", task.status].filter(Boolean).join(" · ")))))
          : h("p", { class: "empty" }, "Clear."),
        h("button", { type: "button", class: "text-button", onClick: () => editTask(null, owner) }, "Add"));
    }))));
}

function renderApprovals() {
  const rows = state.data.approvals.filter((item) => state.showDecided || item.status === "pending");
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "Lance"), h("h2", {}, "Approval queue")),
      h("div", { class: "pager" },
        h("button", { type: "button", class: "btn ghost", onClick: () => { state.showDecided = !state.showDecided; render(); } }, state.showDecided ? "Pending only" : "Show decided"),
        h("button", { type: "button", class: "btn", onClick: () => editApproval(null) }, "Add"))),
    rows.length ? h("div", { class: "stack" }, ...rows.map((item) => h("article", { class: "approval" },
      h("div", {},
        h("p", { class: "kicker" }, `${storeName(item.storeId)} · ${item.kind} · ${item.requestedBy || "unassigned"}`),
        h("h3", {}, item.title),
        item.notes ? h("p", { class: "note" }, item.notes) : null,
        h("button", { type: "button", class: "text-button", onClick: () => editApproval(item) }, "Edit")),
      h("div", { class: "actions" },
        ...[["approved", "Approve"], ["changes", "Changes"], ["declined", "Decline"]].map(([status, label]) => h("button", {
          type: "button",
          class: item.status === status ? "btn" : "btn ghost",
          onClick: () => setApproval(item, status),
        }, label))))))
      : h("p", { class: "sheet empty" }, "Nothing is waiting on Lance.")));
}

async function setApproval(item, status) {
  await api(`/api/planner/approvals/${item.id}`, {
    method: "PATCH",
    body: {
      title: item.title,
      storeId: item.storeId || "",
      kind: item.kind,
      requestedBy: item.requestedBy || "",
      status,
      notes: item.notes || "",
      dueOn: item.dueOn || "",
    },
  });
  await load();
}

function editCalendar(item, date, forceKind) {
  const kind = forceKind || (item && item.kind) || "note";
  openEditor({
    title: item ? (item.kind === "post" ? "Edit post brief" : "Edit planned item") : (kind === "post" ? "Add a post brief" : "Add planned item"),
    fields: [
      storeSelect(item ? item.storeId : state.data.stores[0].id, false),
      choiceSelect("kind", "Kind", [["note", "Note"], ["post", "Post brief"]], kind),
      { name: "title", label: "Title", value: item ? item.title : "" },
      { name: "startsOn", label: "Date", type: "date", value: item ? item.startsOn : date },
      { name: "endsOn", label: "Through", type: "date", value: item && item.endsOn || "" },
      { name: "channels", label: "Channels", value: ((item && item.channels) || []).join(", ") },
      channelSelect(item && item.channel),
      { name: "subject", label: "Subject / vehicle", value: item && item.subject || "" },
      { name: "formats", label: "Formats (photo, reel)", value: ((item && item.formats) || []).join(", ") },
      { name: "goal", label: "Goal", value: item && item.goal || "" },
      { name: "offerLink", label: "Offer or program", value: item && item.offerLink || "" },
      { name: "creativeRequest", label: "What creative is needed", type: "textarea", value: item && item.creativeRequest || "" },
      { name: "caption", label: "Caption", type: "textarea", value: item && item.caption || "" },
      ownerSelect("owner", "Owner", item && item.owner, true),
      choiceSelect("status", "Status", CAL_STATUS, item && item.status),
      { name: "notes", label: "Notes", type: "textarea", value: item ? item.notes : "" },
    ],
    onSubmit: (body) => api(item ? `/api/planner/calendar/${item.id}` : "/api/planner/calendar", { method: item ? "PATCH" : "POST", body }),
    onDelete: item ? () => api(`/api/planner/calendar/${item.id}`, { method: "DELETE" }) : null,
  });
}

function editShoot(item) {
  openEditor({
    title: item ? "Edit shoot" : "Add a shoot",
    fields: [
      storeSelect(item ? item.storeId : "bhbmw", false),
      { name: "shootOn", label: "Date", type: "date", value: item ? item.shootOn : state.data.today },
      { name: "startTime", label: "Start", type: "time", value: item && item.startTime || "09:00" },
      { name: "endTime", label: "End", type: "time", value: item && item.endTime || "" },
      { name: "shooter", label: "Shooter — Lance, store staff, or a freelancer", value: item ? item.shooter : "Lance" },
      { name: "location", label: "Where", value: item ? item.location : "" },
      { name: "brief", label: "Brief", type: "textarea", value: item ? item.brief : "" },
      choiceSelect("status", "Status", SHOOT_STATUS, item && item.status),
    ],
    onSubmit: (body) => api(item ? `/api/planner/shoots/${item.id}` : "/api/planner/shoots", { method: item ? "PATCH" : "POST", body }),
    onDelete: item ? () => api(`/api/planner/shoots/${item.id}`, { method: "DELETE" }) : null,
  });
}

function editEvent(item) {
  openEditor({
    title: item ? "Edit event" : "Add an event",
    fields: [
      storeSelect(item && item.storeId, true),
      { name: "title", label: "Event", value: item ? item.title : "" },
      { name: "startsOn", label: "Starts", type: "date", value: item && item.startsOn || "" },
      { name: "endsOn", label: "Ends", type: "date", value: item && item.endsOn || "" },
      choiceSelect("decision", "Decision", [["pending", "Pending"], ["yes", "Yes"], ["no", "No"]], item && item.decision),
      { name: "offer", label: "Offer", value: item ? item.offer : "" },
      ownerSelect("owner", "Owner", item && item.owner, true),
      { name: "notes", label: "Notes", type: "textarea", value: item ? item.notes : "" },
    ],
    onSubmit: (body) => api(item ? `/api/planner/events/${item.id}` : "/api/planner/events", { method: item ? "PATCH" : "POST", body }),
    onDelete: item ? () => api(`/api/planner/events/${item.id}`, { method: "DELETE" }) : null,
  });
}

function editTask(item, owner) {
  openEditor({
    title: item ? "Edit task" : `Add a task for ${owner || "the desk"}`,
    fields: [
      { name: "title", label: "Task", value: item ? item.title : "" },
      ownerSelect("owner", "Owner", item ? item.owner : owner, false),
      storeSelect(item && item.storeId, true),
      { name: "dueOn", label: "Due", type: "date", value: item && item.dueOn || "" },
      choiceSelect("status", "Status", TASK_STATUS, item && item.status),
      { name: "notes", label: "Notes", type: "textarea", value: item ? item.notes : "" },
    ],
    onSubmit: (body) => api(item ? `/api/planner/tasks/${item.id}` : "/api/planner/tasks", { method: item ? "PATCH" : "POST", body }),
    onDelete: item ? () => api(`/api/planner/tasks/${item.id}`, { method: "DELETE" }) : null,
  });
}

function editApproval(item) {
  openEditor({
    title: item ? "Edit approval" : "Add to Lance’s queue",
    fields: [
      { name: "title", label: "What needs a yes", value: item ? item.title : "" },
      storeSelect(item && item.storeId, true),
      choiceSelect("kind", "Kind", KINDS, item && item.kind),
      ownerSelect("requestedBy", "Asked by", item && item.requestedBy, true),
      choiceSelect("status", "Status", APPROVAL_STATUS, item && item.status),
      { name: "dueOn", label: "Due", type: "date", value: item && item.dueOn || "" },
      { name: "notes", label: "Notes", type: "textarea", value: item ? item.notes : "" },
    ],
    onSubmit: (body) => api(item ? `/api/planner/approvals/${item.id}` : "/api/planner/approvals", { method: item ? "PATCH" : "POST", body }),
    onDelete: item ? () => api(`/api/planner/approvals/${item.id}`, { method: "DELETE" }) : null,
  });
}

function editRollout(rollout) {
  openEditor({
    title: storeName(rollout.storeId),
    submitLabel: "Save program",
    fields: [
      { name: "programName", label: "Program name", value: rollout.programName || "" },
      { name: "notes", label: "Notes", type: "textarea", value: rollout.notes || "" },
    ],
    onSubmit: (body) => api(`/api/planner/rollouts/${rollout.storeId}/${rollout.month}`, { method: "PATCH", body }),
  });
}

function editStep(rollout, step) {
  const meta = state.data.steps.find((item) => item.key === step.stepKey);
  openEditor({
    title: `${storeName(rollout.storeId)} · ${meta ? meta.label : step.stepKey}`,
    fields: [
      choiceSelect("status", "Status", Object.entries(STEP_LABEL), step.status),
      ownerSelect("owner", "Owner", step.owner, true),
      { name: "note", label: "Note", type: "textarea", value: step.note || "" },
    ],
    onSubmit: (body) => api(`/api/planner/rollouts/${rollout.storeId}/${rollout.month}/steps/${step.stepKey}`, { method: "PATCH", body }),
  });
}

function showReadOnly(item) {
  openEditor({
    title: "Already in an engine",
    submitLabel: "Close",
    fields: [
      { name: "title", label: "Post", value: item.title },
      { name: "source", label: "Source", value: (item.sources || [item.source]).join(", ") },
      { name: "note", label: "Note", type: "textarea", value: "Read only. This desk cannot publish, edit, or schedule it." },
    ],
    onSubmit: async () => {},
  });
}

function storeLabel(id) {
  return storeName(id);
}

function renderQuarter() {
  const quarter = state.data.quarter;
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {},
        h("p", { class: "kicker" }, "Planned a quarter at a time"),
        h("h2", {}, quarter.quarter.replace("-", " "))),
      h("p", { class: "note" }, "Themes, programs, events, and how many posts each channel should carry. Roll the next quarter from this one or from the template.")),
    h("div", { class: "quarter-grid" }, ...quarter.plans.map((plan) => h("article", { class: "sheet" },
      h("p", { class: "kicker" }, storeLabel(plan.storeId)),
      h("h3", {}, plan.theme || storeLabel(plan.storeId)),
      plan.notes ? h("p", { class: "note" }, plan.notes) : null,
      h("div", { class: "month-pills" }, ...plan.months.map((month) => {
        const slots = plan.slots.filter((slot) => slot.month === month.month);
        const events = (plan.events || []).filter((event) => event.startsOn && event.startsOn.startsWith(month.month));
        return h("div", { class: "month-pill" },
          h("strong", {}, prettyMonth(month.month)),
          month.theme || "No theme",
          h("div", {}, month.programName || "No program yet"),
          h("div", { class: "muted" }, slots.map((slot) => `${slot.channel} ${slot.filled || 0}/${slot.targetCount}`).join(" · ") || "No slots"),
          events.length ? h("div", {}, events.map((event) => event.title.replace(/^SAMPLE — /, "")).join(", ")) : null);
      })),
      h("div", { class: "pager", style: "margin-top:0.8rem" },
        h("button", { type: "button", class: "btn ghost", onClick: () => rollQuarter(plan.storeId, quarter.next, "previous") }, `Roll to ${quarter.next}`),
        h("button", { type: "button", class: "btn ghost", onClick: () => rollQuarter(plan.storeId, quarter.next, "template") }, "From template")))))));
}

async function rollQuarter(storeId, quarter, source) {
  await api("/api/planner/quarters/roll", { method: "POST", body: { storeId, quarter, source } });
  await load();
}

function renderNeeds() {
  const needs = state.data.needs || [];
  const suggestions = (state.data.suggestedShoots || []).filter((shoot) => !shoot.bookedShootId);
  const needRows = needs.map((need) => h("div", { class: "job" },
    h("strong", {}, `${storeLabel(need.storeId)} · ${need.subject}`),
    h("div", {}, `${need.format} · due ${prettyDay(need.dueOn)} · ${need.postIds.length} post${need.postIds.length === 1 ? "" : "s"}`),
    need.covered
      ? h("div", { class: "covered" }, `Covered · ${need.coveredBy.source}${need.coveredBy.url ? ` · ${need.coveredBy.url}` : ""}`)
      : h("p", { class: "block" }, need.blockedBy.join(" · "))));
  const shootRows = suggestions.map((shoot) => h("div", { class: "job" },
    h("strong", {}, `${storeLabel(shoot.storeId)} · ${prettyDay(shoot.shootOn)}`),
    h("div", {}, `${shoot.shooter} · ${shoot.durationMin} min · ${shoot.location}`),
    h("div", { class: "muted" }, shoot.shotList.map((shot) => `${shot.format} · ${shot.subject}`).join(" · ")),
    h("button", { type: "button", class: "btn", onClick: () => acceptShoot(shoot) }, "Put on the calendar")));
  const needList = needs.length ? h("div", {}, ...needRows) : h("p", { class: "empty" }, "No post briefs yet, so nothing to shoot.");
  const shootList = suggestions.length ? h("div", {}, ...shootRows) : h("p", { class: "empty" }, "Every open need is already on a shoot, or the library already has it.");
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "From the posts"), h("h2", {}, "Needs and shoots")),
      h("p", { class: "note" }, "Photos and reels, deduped. Covered when Drive, PostEngine, or a finished shoot already has the asset. Open needs become a shoot before the due date.")),
    h("div", { class: "need-grid" },
      h("article", { class: "sheet" }, h("h3", {}, "Asset needs"), needList),
      h("article", { class: "sheet" }, h("h3", {}, "Suggested shoots"), shootList))));
}

async function acceptShoot(shoot) {
  await api("/api/planner/shoots/accept", {
    method: "POST",
    body: {
      storeId: shoot.storeId,
      shootOn: shoot.shootOn,
      shooter: shoot.shooter,
      location: shoot.location,
      durationMin: shoot.durationMin,
      windowStart: shoot.windowStart,
      windowEnd: shoot.windowEnd,
      shotList: shoot.shotList,
      brief: shoot.shotList.map((shot) => `${shot.format}: ${shot.subject}`).join("; "),
    },
  });
  await load();
}

function renderBriefs() {
  const posts = (state.data.calendar || []).filter((item) => item.kind === "post");
  const cards = posts.map((post) => {
    const jobs = (state.data.jobs || []).filter((job) => job.briefId === post.id);
    const jobRows = jobs.map((job) => h("div", { class: "job" },
      h("strong", {}, `${job.assignee} · ${job.role} · ${job.status.replaceAll("_", " ")}`),
      job.blockedBy && job.blockedBy.length
        ? h("div", { class: "block" }, job.blockedBy.join(" · "))
        : h("div", { class: "covered" }, "Clear to work")));
    return h("article", { class: "sheet" },
      h("p", { class: "kicker" }, `${storeLabel(post.storeId)} · ${prettyDay(post.startsOn)} · ${post.stage || "brief"}`),
      h("h3", {}, post.title),
      h("p", {}, post.goal || "No goal yet."),
      h("p", { class: "note" }, post.creativeRequest || "No creative request yet."),
      h("p", { class: "muted" }, [(post.channels || []).join(", ") || post.channel, (post.formats || []).join(", "), post.offerLink, post.subject].filter(Boolean).join(" · ")),
      post.blockedBy && post.blockedBy.length ? h("p", { class: "block" }, post.blockedBy.join(" · ")) : null,
      jobs.length ? h("div", {}, ...jobRows) : h("p", { class: "empty" }, "No jobs yet."),
      h("div", { class: "pager", style: "margin-top:0.7rem" },
        h("button", { type: "button", class: "btn ghost", onClick: () => editCalendar(post) }, "Edit brief"),
        h("button", { type: "button", class: "btn", onClick: () => makeJobs(post) }, "Make the jobs")));
  });
  const body = posts.length
    ? h("div", { class: "stack" }, ...cards)
    : h("p", { class: "sheet empty" }, "No post briefs this month. Add one, or open the quarter and fill the slots.");
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "What creative is needed"), h("h2", {}, "Briefs")),
      h("button", { type: "button", class: "btn", onClick: () => editCalendar(null, state.data.today, "post") }, "Add a post")),
    body));
}

async function makeJobs(post) {
  await api(`/api/planner/calendar/${post.id}/jobs`, { method: "POST", body: {} });
  await load();
}

function renderQueue() {
  const jobs = state.data.jobs || [];
  const names = [...new Set(jobs.map((job) => job.assignee))];
  const columns = names.map((name) => h("section", { class: "owner-col" },
    h("h3", {}, name),
    ...jobs.filter((job) => job.assignee === name).map((job) => h("div", { class: "job" },
      h("strong", {}, job.title.replace(/^SAMPLE — /, "")),
      h("div", { class: "muted" }, `${job.role} · ${job.status.replaceAll("_", " ")}${job.dueOn ? ` · ${prettyDay(job.dueOn)}` : ""}`),
      job.blockedBy && job.blockedBy.length
        ? h("div", { class: "block" }, job.blockedBy.join(" · "))
        : h("div", { class: "covered" }, "Ready")))));
  const body = names.length ? h("div", { class: "owner-grid" }, ...columns) : h("p", { class: "empty" }, "No jobs yet.");
  appEl.append(h("section", {},
    h("div", { class: "section-head" },
      h("div", {}, h("p", { class: "kicker" }, "What the bots poll"), h("h2", {}, "Job queue")),
      h("p", { class: "note" }, "GET /api/planner/jobs?assignee=Frances with that bot’s token. Deliver comes back on the same job.")),
    body));
}

function tickClock() {
  const node = document.getElementById("clock");
  if (!node) return;
  node.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short",
  }).format(new Date());
}

document.getElementById("lock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = new FormData(event.target).get("pin");
  const error = document.getElementById("lock-error");
  try {
    const res = await fetch(apiBase() + "/api/planner/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Planner-Pin": pin, Authorization: `Bearer ${pin}` },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) throw new Error("That PIN does not open the desk.");
    sessionStorage.setItem(KEY, String(pin));
    error.hidden = true;
    await load();
  } catch (err) {
    error.hidden = false;
    error.textContent = err.message === "Failed to fetch" ? "The planner API isn’t answering." : err.message;
  }
});

lockBtn.addEventListener("click", () => {
  sessionStorage.removeItem(KEY);
  state.locked = true;
  state.data = null;
  render();
});

tickClock();
setInterval(tickClock, 30000);
render();
load();
