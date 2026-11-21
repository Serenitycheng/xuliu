import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopCredential, desktopWidgetOrigin, parseDesktopCredential } from "../lib/desktop-widget-credential.ts";
import { completeDesktopWidgetTask, desktopWidgetDate, desktopWidgetView } from "../lib/desktop-widget-view.ts";
import { reviewPoolCourseVisibility, reviewPoolTodayCounts } from "../lib/course-review-pool.ts";
import { createEmptyWorkspaceState, workspaceStateSchema } from "../lib/workspace-state-schema.ts";

const today = "2026-11-20";
const task = (id, extra = {}) => ({ id, title: id, area: "课内", source: "课程", elapsed: 0, done: false, today: true, ...extra });
const node = (id, extra = {}) => ({ id, title: id, date: today, time: "16:00", area: "课内", location: "", requirements: "", done: false, ...extra });
const course = (id, title, ended) => ({ id, title, ended, term: "", teacher: "", location: "", progress: 0, requirements: "", schedule: [], blocks: [] });
const review = (id, courseName, extra = {}) => ({ id, course: courseName, chapter: "第一章", note: "private note", done: false, progress: 0, sources: [], ...extra });

test("desktop projection matches today, omits ended reviews and uses the site's upcoming deadlines", () => {
  const data = {
    ...createEmptyWorkspaceState(),
    tasks: [task("due", { due: today, requirements: "private requirements" }), task("later", { today: false, due: "2026-11-25" }), task("too far", { due: "2026-12-01" })],
    milestones: [node("course task", { courseId: "tax" }), node("plain calendar", { requiresCompletion: false })],
    courses: [course("tax", "税收理论与实务"), course("probability", "概率论与数理统计", true)],
    reviewPool: { version: 1, items: [
      review("ended", "概率论", { selectedDate: today, steps: [{ id: "ended-step", title: "past review", done: false, selectedDate: today }] }),
      review("active", "税务", { selectedDate: today, steps: [{ id: "step", title: "practice", done: true, selectedDate: today, completedDate: today }] }),
      review("custom", "没有课程记录的复习"),
    ] },
  };
  assert.equal(workspaceStateSchema.safeParse(data).success, true);
  const result = desktopWidgetView(data, today, 4);
  assert.equal(result.total, 4);
  assert.equal(result.completed, 1);
  assert.equal(result.revision, 4);
  assert.deepEqual(result.deadlines.map(({ title }) => title), ["course task", "due", "later"]);
  assert.doesNotMatch(JSON.stringify(result), /private|past review|plain calendar|too far/);
  const visible = reviewPoolCourseVisibility(data.courses);
  assert.equal(visible("没有课程记录的复习"), true);
  assert.deepEqual(reviewPoolTodayCounts(data.reviewPool.items.filter((item) => visible(item.course)), today), { total: 2, completed: 1 });
  assert.equal(reviewPoolCourseVisibility([course("restored", "概率论与数理统计")])("概率论"), true);
  assert.equal(reviewPoolCourseVisibility([...data.courses, course("current", "概率论")])("概率论"), true);
});

test("desktop completion and reopening share stable existing IDs and preserve unrelated state", () => {
  const data = {
    ...createEmptyWorkspaceState(),
    tasks: [task("today", { progress: 35, progressLogs: [{ id: "old", date: today, progress: 35, status: "进行中", note: "old" }] }),
      task("hidden", { today: false, plannedDate: "2026-11-21" })],
    milestones: [node("node", { courseId: "tax" }), node("event", { requiresCompletion: false })],
    courses: [course("tax", "税收理论与实务")],
    reviewPool: { version: 1, items: [review("review", "税务", { selectedDate: today, steps: [{ id: "step", title: "practice", done: false, selectedDate: today }] })] },
  };
  const completed = completeDesktopWidgetTask(data, { kind: "task", id: "today" }, true, today, "done");
  assert.equal(completed.tasks[0].status, "已完成");
  assert.equal(completed.tasks[0].completedDate, today);
  assert.equal(completed.tasks[0].progressLogs.length, 2);
  assert.equal(completed.tasks[1], data.tasks[1]);
  assert.equal(completed.finance, data.finance);
  assert.equal(completeDesktopWidgetTask(completed, { kind: "task", id: "today" }, true, today, "retry"), completed);
  const reopened = completeDesktopWidgetTask(completed, { kind: "task", id: "today" }, false, today, "reopen");
  assert.equal(reopened.tasks[0].progress, 35);
  assert.equal(reopened.tasks[0].completedDate, undefined);
  assert.equal(completeDesktopWidgetTask(data, { kind: "task", id: "hidden" }, true, today, "invalid"), null);
  assert.equal(completeDesktopWidgetTask(data, { kind: "milestone", id: "event" }, true, today, "invalid"), null);
  const courseDone = completeDesktopWidgetTask(reopened, { kind: "milestone", id: "node" }, true, today, "node-log");
  const reviewDone = completeDesktopWidgetTask(courseDone, { kind: "review", id: "review" }, true, today, "review-log");
  const stepDone = completeDesktopWidgetTask(reviewDone, { kind: "review-step", id: "review", stepId: "step" }, true, today, "step-log");
  assert.equal(courseDone.milestones[0].completedDate, today);
  assert.equal(reviewDone.reviewPool.items[0].completedDate, today);
  assert.equal(stepDone.reviewPool.items[0].steps[0].completedDate, today);
  assert.equal(workspaceStateSchema.safeParse(stepDone).success, true);
});

test("desktop credential scopes and Spacedash origins are strictly separated", () => {
  const code = createDesktopCredential("xdp1", "owner");
  const token = createDesktopCredential("xdt1", "owner");
  assert.equal(parseDesktopCredential(code, "xdp1").accountId, "owner");
  assert.equal(parseDesktopCredential(token, "xdt1").hash.length, 64);
  assert.notEqual(parseDesktopCredential(code, "xdp1").hash, parseDesktopCredential(token, "xdt1").hash);
  assert.equal(parseDesktopCredential(code, "xdt1"), null);
  const yiyanCode = createDesktopCredential("xyp1", "owner");
  const yiyanToken = createDesktopCredential("xyt1", "owner");
  assert.equal(parseDesktopCredential(yiyanCode, "xyp1").accountId, "owner");
  assert.equal(parseDesktopCredential(yiyanToken, "xyt1").accountId, "owner");
  assert.equal(parseDesktopCredential(yiyanCode, "xdp1"), null);
  assert.equal(parseDesktopCredential(yiyanToken, "xdt1"), null);
  assert.equal(parseDesktopCredential(token, "xyt1"), null);
  assert.equal(parseDesktopCredential(token.replace(".owner.", ".other."), "xdt1"), null);
  assert.equal(desktopWidgetOrigin("http://w-0af.localhost:57140"), "http://w-0af.localhost:57140");
  for (const origin of [null, "null", "http://localhost:57140", "https://w-123.localhost:57140", "http://w-123.localhost:57141", "http://w-123.localhost:57140.evil.test"]) {
    assert.equal(desktopWidgetOrigin(origin), null);
  }
  assert.equal(desktopWidgetDate("Asia/Shanghai", new Date("2026-11-19T18:00:00Z")), today);
  assert.equal(desktopWidgetDate("Invalid/Zone"), null);
});
