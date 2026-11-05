import { JOB_ROLES, STEPS, STORES } from "./constants.js";
import { quarterOf, templateQuarter } from "./derive.js";
import { dayInMonth } from "./time.js";

const SAMPLE_NOTE = "Fictional sample. Not a real client item.";

function monthLabel(month) {
  const [year, mon] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

export function fixtureRecords(today, nowIso) {
  const month = today.slice(0, 7);
  const label = monthLabel(month);
  const on = (day) => dayInMonth(month, day);
  const calendar = [
    ["fx-cal-coupe", "bhbmw", "SAMPLE — red coupe still", on(2), null, "instagram", "Frances", "planned"],
    ["fx-cal-service", "abr", "SAMPLE — service drive reminder", on(6), null, "facebook", "Daisy", "in_progress"],
    ["fx-cal-letter", "hp", "SAMPLE — newsletter proof read", on(18), null, "email", "Eleanor", "ready"],
    ["fx-cal-walk", "bmwj", "SAMPLE — showroom walk frame", on(12), null, "gbp", "Ansel", "planned"],
    ["fx-cal-desk", "coop", "SAMPLE — agency desk photo", on(4), null, "instagram", "Lance", "planned"],
  ].map(([id, storeId, title, startsOn, endsOn, channel, owner, status]) => ({
    id, storeId, title, startsOn, endsOn, channel, owner, status, notes: SAMPLE_NOTE, nowIso, kind: "note",
  }));

  const coupe = calendar.find((item) => item.id === "fx-cal-coupe");
  Object.assign(coupe, {
    kind: "post",
    startsOn: on(8),
    channels: ["instagram", "facebook"],
    goal: "SAMPLE — put the coupe on the front line",
    offerLink: "sample:program/red-coupe",
    creativeRequest: "SAMPLE — one still and a 15-second walkaround. Caption in our voice.",
    subject: "SAMPLE red coupe",
    formats: ["photo", "reel"],
    pipeline: "creative",
  });
  const wagon = calendar.find((item) => item.id === "fx-cal-service");
  Object.assign(wagon, {
    kind: "post",
    startsOn: on(12),
    channels: ["facebook"],
    goal: "SAMPLE — service-drive reminder",
    offerLink: "sample:program/service",
    creativeRequest: "SAMPLE — a short reel at the service drive.",
    subject: "SAMPLE silver wagon",
    formats: ["reel"],
    pipeline: "brief",
  });

  const shoots = [
    ["fx-shoot-front", "bhbmw", on(4), "09:00", "12:00", "Lance", "SAMPLE front line", "Fictional shoot. Reel of the sample red coupe.", "confirmed", 90, [{ subject: "SAMPLE red coupe", format: "reel", key: "bhbmw|sample red coupe|reel" }], on(4), on(7)],
    ["fx-shoot-travel", "bmwj", on(12), "10:00", "14:00", "Lance", "SAMPLE showroom", "Fictional travel-day shoot.", "planned", 120, [], null, null],
  ].map(([id, storeId, shootOn, startTime, endTime, shooter, location, brief, status, durationMin, shotList, windowStart, windowEnd]) => ({
    id, storeId, shootOn, startTime, endTime, shooter, location, brief, status, durationMin, shotList, windowStart, windowEnd, nowIso,
  }));

  const events = [
    {
      id: "fx-event-booth",
      storeId: "abr",
      title: "SAMPLE — parish food festival booth",
      startsOn: on(14),
      endsOn: on(15),
      decision: "pending",
      offer: "Sample display car and two tickets. Not a real offer.",
      notes: "Fictional sponsorship. Waiting on a yes or no.",
      owner: "Lance",
      nowIso,
    },
    {
      id: "fx-event-parade",
      storeId: "hp",
      title: "SAMPLE — holiday parade car",
      startsOn: on(20),
      endsOn: on(20),
      decision: "no",
      offer: "Sample: one car in the parade.",
      notes: "Fictional. Marked no so the desk shows a decided event.",
      owner: "Daisy",
      nowIso,
    },
  ];

  const tasks = [
    ["fx-task-daisy", "SAMPLE — lock the month's program order", "Daisy", "bhbmw", on(6)],
    ["fx-task-eleanor", "SAMPLE — frame the red coupe still", "Eleanor", "bhbmw", on(4)],
    ["fx-task-frances", "SAMPLE — caption the service reminder", "Frances", "abr", on(6)],
    ["fx-task-ansel", "SAMPLE — color the showroom frames", "Ansel", "bmwj", on(12)],
    ["fx-task-steve", "SAMPLE — cut the front-line walkaround", "Steve", "bhbmw", on(5)],
    ["fx-task-della", "SAMPLE — book the travel-day shoot", "Della", "bmwj", on(8)],
    ["fx-task-lance", "SAMPLE — yes or no on the festival booth", "Lance", "abr", on(7)],
  ].map(([id, title, owner, storeId, dueOn]) => ({
    id, title, owner, storeId, dueOn, status: "open", notes: SAMPLE_NOTE, nowIso,
  }));

  const approvals = [
    {
      id: "fx-approval-still",
      title: "SAMPLE — approve the red coupe still",
      storeId: "bhbmw",
      kind: "creative",
      requestedBy: "Daisy",
      status: "pending",
      notes: "Fictional approval. Nothing publishes from this desk.",
      dueOn: on(8),
      briefId: "fx-cal-coupe",
      nowIso,
    },
    {
      id: "fx-approval-booth",
      title: "SAMPLE — yes or no on the festival booth",
      storeId: "abr",
      kind: "sponsorship",
      requestedBy: "Della",
      status: "pending",
      notes: "Fictional sponsorship decision for Lance.",
      dueOn: on(7),
      nowIso,
    },
    {
      id: "fx-approval-banner",
      title: "SAMPLE — last month's banner set",
      storeId: "hp",
      kind: "program",
      requestedBy: "Eleanor",
      status: "approved",
      notes: "Fictional. Already decided, so the queue can hide it.",
      dueOn: on(2),
      nowIso,
    },
  ];

  const stepState = {
    bhbmw: {
      programs_received: ["done", "Daisy"],
      program_sheet: ["in_progress", "Eleanor"],
      manager_email: ["waiting", "Daisy"],
      specials_page: ["not_started", "Frances"],
    },
    abr: {
      programs_received: ["waiting", "Daisy"],
    },
    hp: {
      programs_received: ["done", "Daisy"],
      program_sheet: ["done", "Frances"],
      newsletter: ["in_progress", "Eleanor"],
    },
    bmwj: {},
    coop: {
      programs_received: ["na", null],
      program_sheet: ["na", null],
      manager_email: ["na", null],
      specials_page: ["na", null],
      banners: ["na", null],
      email_blast: ["na", null],
      meta_posts: ["not_started", "Frances"],
      gbp_posts: ["not_started", "Frances"],
      paid_brief: ["na", null],
      newsletter: ["in_progress", "Eleanor"],
    },
  };

  const rollouts = STORES.map((store) => ({
    id: `rl-${store.id}-${month}`,
    storeId: store.id,
    month,
    programName: store.id === "bhbmw" || store.id === "hp" ? `SAMPLE — ${label} sheet` : "",
    notes: "Fictional rollout. Not a manufacturer program.",
    steps: STEPS.map((step) => {
      const picked = (stepState[store.id] && stepState[store.id][step.key]) || ["not_started", null];
      return {
        id: `rs-${store.id}-${month}-${step.key}`,
        stepKey: step.key,
        status: picked[0],
        owner: picked[1],
        note: picked[0] === "not_started" ? "" : "Sample step.",
      };
    }),
  }));

  const jobs = JOB_ROLES.map((role) => ({
    id: `fx-job-${role.role}`,
    briefId: "fx-cal-coupe",
    role: role.role,
    assignee: role.assignee,
    title: `SAMPLE — ${role.label.toLowerCase()} for the red coupe`,
    status: role.role === "design" ? "in_progress" : "requested",
    dueOn: on(8),
    notes: SAMPLE_NOTE,
    captionDraft: "",
    assetUrls: [],
    nowIso,
  }));

  const assets = [
    {
      id: "fx-asset-coupe-photo",
      storeId: "bhbmw",
      subject: "SAMPLE red coupe",
      format: "photo",
      source: "drive",
      url: "sample://library/red-coupe-still",
      nowIso,
    },
  ];

  const quarter = quarterOf(today);
  const quarters = STORES.map((store) => {
    const plan = templateQuarter(store.id, quarter);
    const current = plan.months.find((item) => item.month === month);
    if (current && (store.id === "bhbmw" || store.id === "hp")) current.programName = `SAMPLE — ${label} sheet`;
    return { ...plan, id: `fx-qp-${store.id}-${quarter}`, nowIso };
  });

  return { month, calendar, shoots, events, tasks, approvals, rollouts, jobs, assets, quarters };
}
