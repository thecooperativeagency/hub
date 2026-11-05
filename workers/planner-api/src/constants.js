export const TIMEZONE = "America/Chicago";

export const OWNERS = ["Daisy", "Eleanor", "Frances", "Ansel", "Steve", "Della", "Lance"];

export const STEPS = [
  { key: "programs_received", label: "Programs received", short: "Received" },
  { key: "program_sheet", label: "Program sheet", short: "Sheet" },
  { key: "manager_email", label: "Manager email", short: "Mgr email" },
  { key: "specials_page", label: "Specials page", short: "Specials" },
  { key: "banners", label: "Banners", short: "Banners" },
  { key: "email_blast", label: "Email blast", short: "Blast" },
  { key: "meta_posts", label: "Meta posts", short: "Meta" },
  { key: "gbp_posts", label: "Google Business posts", short: "GBP" },
  { key: "paid_brief", label: "Paid brief", short: "Paid" },
  { key: "newsletter", label: "Newsletter", short: "Letter" },
];

export const STEP_STATUS = ["not_started", "in_progress", "waiting", "done", "blocked", "na"];

export const CHANNELS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "meta", label: "Meta" },
  { id: "gbp", label: "Google Business" },
  { id: "email", label: "Email" },
  { id: "web", label: "Website" },
  { id: "paid", label: "Paid" },
  { id: "other", label: "Other" },
];

export const CALENDAR_STATUS = ["planned", "in_progress", "ready", "done", "dropped"];
export const SHOOT_STATUS = ["planned", "confirmed", "done", "cancelled"];
export const TASK_STATUS = ["open", "doing", "done", "parked"];
export const EVENT_DECISION = ["pending", "yes", "no"];
export const APPROVAL_STATUS = ["pending", "approved", "changes", "declined"];
export const APPROVAL_KIND = ["creative", "publish", "sponsorship", "program", "other"];

export const JOB_ROLES = [
  { role: "design", assignee: "Eleanor", label: "Design / look" },
  { role: "copy", assignee: "Frances", label: "Copy / captions" },
  { role: "photo", assignee: "Ansel", label: "Photo and video edit" },
  { role: "video", assignee: "Steve", label: "Video" },
  { role: "shoot", assignee: "Lance", label: "Shoot" },
];

export const CREATIVE_ROLES = JOB_ROLES.filter((role) => role.role !== "shoot");

export const BOT_ASSIGNEES = {
  eleanor: "Eleanor",
  frances: "Frances",
  ansel: "Ansel",
  steve: "Steve",
  lance: "Lance",
};

export const JOB_STATUS = ["requested", "in_progress", "delivered", "approved"];
export const ASSET_FORMATS = ["photo", "reel"];
export const PIPELINE = ["brief", "creative", "approved", "queued", "published"];

export const STORES = [
  {
    id: "bhbmw",
    name: "Brian Harris BMW",
    shortName: "BHBMW",
    postengineId: 2,
    cadenceDays: 2,
    market: "Baton Rouge, LA",
    sortOrder: 1,
  },
  {
    id: "abr",
    name: "Audi Baton Rouge",
    shortName: "ABR",
    postengineId: 3,
    cadenceDays: 2,
    market: "Baton Rouge, LA",
    sortOrder: 2,
  },
  {
    id: "hp",
    name: "Harris Porsche",
    shortName: "HP",
    postengineId: 4,
    cadenceDays: 2,
    market: "Baton Rouge, LA",
    sortOrder: 3,
  },
  {
    id: "bmwj",
    name: "BMW of Jackson",
    shortName: "BMWJ",
    postengineId: 1,
    cadenceDays: 2,
    market: "Jackson, MS",
    sortOrder: 4,
  },
  {
    id: "coop",
    name: "Coop",
    shortName: "Coop",
    postengineId: 6,
    cadenceDays: 7,
    market: "The agency",
    sortOrder: 5,
  },
];

export const STORE_IDS = new Set(STORES.map((store) => store.id));

const STORE_MATCHERS = [
  { id: "bmwj", test: /bmw of jackson|bmw jackson|jackson bmw|\bbmwj\b/i },
  { id: "hp", test: /harris porsche|\bporsche\b/i },
  { id: "bhbmw", test: /brian harris bmw|harris bmw|\bbhbmw\b/i },
  { id: "abr", test: /audi baton rouge|audi baton|\babr\b/i },
  { id: "coop", test: /the cooperative|cooperative agency|\bcoop\b/i },
];

export function matchStoreName(value) {
  const hay = String(value || "");
  for (const matcher of STORE_MATCHERS) {
    if (matcher.test.test(hay)) return matcher.id;
  }
  return null;
}

export function storeById(id) {
  return STORES.find((store) => store.id === id) || null;
}

export function storeByPostengineId(id) {
  const numeric = Number(id);
  return STORES.find((store) => store.postengineId === numeric) || null;
}
