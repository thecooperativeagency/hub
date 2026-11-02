import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  annotateChain,
  deriveAssetNeeds,
  deriveShoots,
  nextQuarter,
  quarterMonths,
  rollQuarter,
  templateQuarter,
} from "../src/derive.js";

const coupe = {
  id: "p1",
  kind: "post",
  storeId: "bhbmw",
  subject: "SAMPLE red coupe",
  formats: ["photo", "reel"],
  startsOn: "2026-11-08",
  title: "SAMPLE — red coupe still",
};
const coupeLater = {
  id: "p2",
  kind: "post",
  storeId: "bhbmw",
  subject: "sample   red coupe",
  formats: ["photo"],
  startsOn: "2026-11-20",
  title: "SAMPLE — another still",
};
const wagon = {
  id: "p3",
  kind: "post",
  storeId: "abr",
  subject: "SAMPLE silver wagon",
  formats: ["reel"],
  startsOn: "2026-11-28",
  title: "SAMPLE — wagon reel",
};

describe("derivation", () => {
  test("asset needs dedupe by store, subject, and format and keep the earliest due date", () => {
    const needs = deriveAssetNeeds([coupe, coupeLater, wagon, { id: "note", kind: "note", title: "ignore" }], []);
    const photo = needs.find((need) => need.format === "photo");
    const reel = needs.find((need) => need.storeId === "bhbmw" && need.format === "reel");
    assert.equal(needs.length, 3);
    assert.equal(photo.dueOn, "2026-11-08");
    assert.deepEqual(photo.postIds.sort(), ["p1", "p2"]);
    assert.equal(photo.covered, false);
    assert.equal(reel.subject, "SAMPLE red coupe");
  });

  test("library assets from Drive or PostEngine subtract from the needs", () => {
    const needs = deriveAssetNeeds([coupe], [{
      storeId: "bhbmw",
      subject: "SAMPLE red coupe",
      format: "photo",
      source: "drive",
      url: "sample://library/red-coupe-still",
    }]);
    const photo = needs.find((need) => need.format === "photo");
    const reel = needs.find((need) => need.format === "reel");
    assert.equal(photo.covered, true);
    assert.equal(photo.coveredBy.source, "drive");
    assert.equal(reel.covered, false);
  });

  test("open needs become shoots before the first due date, split when the window is wide", () => {
    const needs = deriveAssetNeeds([coupe, coupeLater, wagon], [{
      storeId: "bhbmw",
      subject: "SAMPLE red coupe",
      format: "photo",
      source: "drive",
    }]);
    const late = {
      id: "p4",
      kind: "post",
      storeId: "bhbmw",
      subject: "SAMPLE blue sedan",
      formats: ["photo"],
      startsOn: "2026-11-27",
      title: "SAMPLE — blue sedan",
    };
    const wide = deriveAssetNeeds([coupe, late], []);
    const shoots = deriveShoots(wide);
    assert.equal(shoots.length, 2);
    assert.equal(shoots[0].shooter, "Lance");
    assert.equal(shoots[0].shootOn, "2026-11-06");
    assert.equal(shoots[0].windowEnd, "2026-11-07");
    assert.equal(shoots[0].shotList[0].format, "photo");
    assert.ok(shoots[0].durationMin >= 30);

    const wagonNeeds = needs.filter((need) => need.storeId === "abr");
    const wagonShoot = deriveShoots(wagonNeeds)[0];
    assert.equal(wagonShoot.shootOn, "2026-11-26");
    assert.equal(wagonShoot.shotList[0].subject, "SAMPLE silver wagon");
  });

  test("a booked shoot blocks the need, and a covered need does not block creative jobs", () => {
    const posts = [coupe];
    const assets = [{ id: "a", storeId: "bhbmw", subject: "SAMPLE red coupe", format: "photo", source: "drive", url: "" }];
    const shoots = [{
      id: "s1",
      storeId: "bhbmw",
      status: "confirmed",
      shootOn: "2026-11-04",
      shooter: "Lance",
      shotList: [{ subject: "SAMPLE red coupe", format: "reel", key: "bhbmw|sample red coupe|reel" }],
    }];
    const jobs = [
      { id: "j1", briefId: "p1", role: "copy", assignee: "Frances", status: "requested", assetUrls: [] },
      { id: "j2", briefId: "p1", role: "shoot", assignee: "Lance", status: "requested", assetUrls: [] },
    ];
    const chain = annotateChain({ posts, assets, shoots, jobs, approvals: [], pePosts: [], peWriteEnabled: false });
    const reel = chain.needs.find((need) => need.format === "reel");
    const photo = chain.needs.find((need) => need.format === "photo");
    assert.equal(photo.blockedBy.length, 0);
    assert.match(reel.blockedBy[0], /shoot: confirmed/);
    const copy = chain.jobs.find((job) => job.role === "copy");
    const shootJob = chain.jobs.find((job) => job.role === "shoot");
    assert.match(copy.blockedBy[0], /reel/);
    assert.equal(shootJob.blockedBy.length, 0);
    assert.equal(chain.posts[0].stage, "brief");
    assert.equal(chain.suggestedShoots[0].bookedShootId, "s1");
  });

  test("quarter template and roll-forward shift three months", () => {
    assert.deepEqual(quarterMonths("2026-Q4"), ["2026-10", "2026-11", "2026-12"]);
    assert.equal(nextQuarter("2026-Q4"), "2027-Q1");
    const template = templateQuarter("bhbmw", "2026-Q4");
    assert.equal(template.slots.filter((slot) => slot.month === "2026-11" && slot.channel === "instagram")[0].targetCount, 8);
    const rolled = rollQuarter(template, "2027-Q1");
    assert.deepEqual(rolled.months.map((month) => month.month), ["2027-01", "2027-02", "2027-03"]);
    assert.equal(rolled.slots.find((slot) => slot.month === "2027-01" && slot.channel === "gbp").targetCount, 4);
    assert.equal(templateQuarter("coop", "2026-Q4").slots.find((slot) => slot.channel === "instagram").targetCount, 4);
  });
});
