import { addDays, daysBetween } from "./time.js";

export function normalizeSubject(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function quarterOf(month) {
  const [year, mon] = month.split("-").map(Number);
  const quarter = Math.floor((mon - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

export function quarterMonths(quarter) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter || "");
  if (!match) return [];
  const year = Number(match[1]);
  const start = (Number(match[2]) - 1) * 3 + 1;
  return [0, 1, 2].map((offset) => `${year}-${String(start + offset).padStart(2, "0")}`);
}

export function nextQuarter(quarter) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter || "");
  if (!match) return "";
  const year = Number(match[1]);
  const q = Number(match[2]);
  return q === 4 ? `${year + 1}-Q1` : `${year}-Q${q + 1}`;
}

export function previousQuarter(quarter) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter || "");
  if (!match) return "";
  const year = Number(match[1]);
  const q = Number(match[2]);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
}

export function templateQuarter(storeId, quarter) {
  const months = quarterMonths(quarter);
  const targets = storeId === "coop"
    ? { instagram: 4, facebook: 2, gbp: 2 }
    : { instagram: 8, facebook: 8, gbp: 4 };
  const themes = ["SAMPLE — front line", "SAMPLE — service", "SAMPLE — one offer"];
  return {
    storeId,
    quarter,
    theme: "SAMPLE — lot, service, and one offer",
    notes: "Fictional quarter template. Swap in the real themes before anyone works from it.",
    months: months.map((month, index) => ({
      month,
      theme: themes[index],
      programName: "",
      notes: "",
    })),
    slots: months.flatMap((month) => Object.entries(targets).map(([channel, targetCount]) => ({
      month,
      channel,
      targetCount,
    }))),
  };
}

export function rollQuarter(source, toQuarter) {
  const fromMonths = quarterMonths(source.quarter);
  const toMonths = quarterMonths(toQuarter);
  const shifted = new Map(fromMonths.map((month, index) => [month, toMonths[index]]));
  const move = (month) => shifted.get(month) || month;
  return {
    storeId: source.storeId,
    quarter: toQuarter,
    theme: source.theme,
    notes: source.notes,
    months: (source.months || []).map((month) => ({ ...month, month: move(month.month) })),
    slots: (source.slots || []).map((slot) => ({ ...slot, month: move(slot.month) })),
  };
}

export function deriveAssetNeeds(posts, assets) {
  const library = assets || [];
  const grouped = new Map();
  for (const post of posts || []) {
    if (!post || post.kind !== "post") continue;
    const formats = Array.isArray(post.formats) && post.formats.length ? post.formats : ["photo"];
    const subject = String(post.subject || post.title || "").trim();
    if (!subject || !post.storeId || !post.startsOn) continue;
    for (const format of formats) {
      if (format !== "photo" && format !== "reel") continue;
      const key = `${post.storeId}|${normalizeSubject(subject)}|${format}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          key,
          storeId: post.storeId,
          subject,
          format,
          dueOn: post.startsOn,
          postIds: [post.id],
        });
      } else {
        if (!current.postIds.includes(post.id)) current.postIds.push(post.id);
        if (post.startsOn < current.dueOn) current.dueOn = post.startsOn;
      }
    }
  }
  return [...grouped.values()].map((need) => {
    const hit = library.find((asset) => asset.storeId === need.storeId
      && asset.format === need.format
      && normalizeSubject(asset.subject) === normalizeSubject(need.subject));
    return {
      ...need,
      covered: Boolean(hit),
      coveredBy: hit ? { id: hit.id || null, source: hit.source, url: hit.url || "" } : null,
    };
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
}

function clusterNeeds(needs, windowDays) {
  const sorted = [...needs].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
  const clusters = [];
  for (const need of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || daysBetween(last.anchor, need.dueOn) > windowDays) {
      clusters.push({ anchor: need.dueOn, needs: [need] });
    } else {
      last.needs.push(need);
    }
  }
  return clusters;
}

export function deriveShoots(needs, options = {}) {
  const leadDays = options.leadDays ?? 2;
  const windowDays = options.windowDays ?? 7;
  const open = (needs || []).filter((need) => !need.covered);
  const byStore = new Map();
  for (const need of open) {
    const list = byStore.get(need.storeId) || [];
    list.push(need);
    byStore.set(need.storeId, list);
  }
  const shoots = [];
  for (const [storeId, storeNeeds] of byStore) {
    for (const cluster of clusterNeeds(storeNeeds, windowDays)) {
      const due = cluster.needs.map((need) => need.dueOn).sort()[0];
      const shootOn = addDays(due, -leadDays);
      const shots = cluster.needs.length;
      shoots.push({
        key: `${storeId}|${shootOn}|${due}`,
        storeId,
        shootOn,
        windowStart: shootOn,
        windowEnd: addDays(due, -1),
        location: "Lot",
        shooter: "Lance",
        durationMin: Math.min(240, 30 + shots * 20),
        status: "suggested",
        shotList: cluster.needs.map((need) => ({
          subject: need.subject,
          format: need.format,
          dueOn: need.dueOn,
          key: need.key,
        })),
        needKeys: cluster.needs.map((need) => need.key),
      });
    }
  }
  return shoots.sort((a, b) => a.shootOn.localeCompare(b.shootOn) || a.storeId.localeCompare(b.storeId));
}

function shootCovers(shoot, need) {
  if (!shoot || shoot.status === "cancelled" || shoot.storeId !== need.storeId) return false;
  const list = Array.isArray(shoot.shotList) ? shoot.shotList : [];
  return list.some((shot) => shot.key === need.key
    || (normalizeSubject(shot.subject) === normalizeSubject(need.subject) && shot.format === need.format));
}

export function annotateChain({ posts, assets, shoots, jobs, approvals, pePosts, peWriteEnabled }) {
  const needs = deriveAssetNeeds(posts, assets);
  const suggestions = deriveShoots(needs).map((suggestion) => {
    const booked = (shoots || []).find((shoot) => suggestion.needKeys.every((key) => {
      const need = needs.find((item) => item.key === key);
      return need && shootCovers(shoot, need);
    }) && suggestion.needKeys.length > 0);
    return { ...suggestion, bookedShootId: booked ? booked.id : null };
  });

  const needView = needs.map((need) => {
    if (need.covered) return { ...need, blockedBy: [] };
    const booked = (shoots || []).find((shoot) => shootCovers(shoot, need));
    if (!booked) {
      const suggestion = suggestions.find((item) => item.needKeys.includes(need.key) && !item.bookedShootId);
      return {
        ...need,
        blockedBy: [suggestion
          ? `shoot: suggested ${suggestion.shootOn}, not on the calendar`
          : "shoot: not grouped yet"],
      };
    }
    if (booked.status !== "done") {
      return { ...need, blockedBy: [`shoot: ${booked.status} · ${booked.shootOn} · ${booked.shooter || "Lance"}`] };
    }
    return { ...need, blockedBy: ["shoot: marked done, asset not in the library"] };
  });

  const postViews = (posts || []).filter((post) => post.kind === "post").map((post) => {
    const relatedNeeds = needView.filter((need) => need.postIds.includes(post.id));
    const openNeeds = relatedNeeds.filter((need) => !need.covered);
    const relatedJobs = (jobs || []).filter((job) => job.briefId === post.id);
    const creative = relatedJobs.filter((job) => job.role !== "shoot");
    const approval = (approvals || []).find((item) => item.briefId === post.id);
    const pe = (pePosts || []).find((item) => item.peId && post.postenginePostId && String(item.peId) === String(post.postenginePostId));
    const jobsDone = creative.length > 0 && creative.every((job) => job.status === "delivered" || job.status === "approved");
    let stage = "brief";
    if (pe && pe.status === "published") stage = "published";
    else if (pe && ["draft", "queued", "scheduled"].includes(pe.status)) stage = "queued";
    else if (approval && approval.status === "approved" && openNeeds.length === 0 && jobsDone) stage = "approved";
    else if (creative.some((job) => job.status !== "requested") || (creative.length && openNeeds.length === 0)) stage = "creative";

    const blockedBy = [];
    if (openNeeds.length) {
      for (const need of openNeeds) blockedBy.push(`need: ${need.format} · ${need.subject}`);
    } else if (!jobsDone && creative.some((job) => job.status !== "delivered" && job.status !== "approved")) {
      for (const job of creative.filter((item) => item.status !== "delivered" && item.status !== "approved")) {
        blockedBy.push(`job: ${job.assignee} ${job.role} is ${job.status.replace("_", " ")}`);
      }
    } else if (!approval || approval.status === "pending" || approval.status === "changes") {
      blockedBy.push("approval: waiting on Lance");
    } else if (approval.status === "approved" && !post.postenginePostId) {
      blockedBy.push(peWriteEnabled
        ? "postengine: approved, not queued yet"
        : "postengine: write is off (PLANNER_PE_WRITE=0)");
    } else if (approval.status === "declined") {
      blockedBy.push("approval: declined");
    }
    return { ...post, stage, blockedBy, approvalId: approval ? approval.id : null };
  });

  const jobViews = (jobs || []).map((job) => {
    if (job.role === "shoot") return { ...job, blockedBy: [] };
    const openNeeds = needView.filter((need) => need.postIds.includes(job.briefId) && !need.covered);
    return {
      ...job,
      blockedBy: openNeeds.map((need) => `need: ${need.format} · ${need.subject}`),
    };
  });

  return { needs: needView, suggestedShoots: suggestions, posts: postViews, jobs: jobViews };
}
