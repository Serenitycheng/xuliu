import type { z } from "zod";
import { eventRequiresCompletion } from "./course-events.ts";
import { reviewPoolCourseVisibility, reviewPoolItemVisibleOnDate, reviewPoolStepVisibleOnDate, updateReviewPoolItem, withoutReviewPoolSources } from "./course-review-pool.ts";
import { isLinkedExamReviewTask, withoutUnselectedExamReviewTasks } from "./exam-review-pool.ts";
import { isTaskNode, setTaskCompleted, taskCompletionDate, taskStatusOf, taskVisibleToday } from "./task-progress.ts";
import { studyTaskVisibleOnDate } from "./study-task-automation.ts";
import { upcomingDeadlines } from "./upcoming-deadlines.ts";
import type { workspaceStateSchema } from "./workspace-state-schema.ts";

type Workspace = z.infer<typeof workspaceStateSchema>;
export type DesktopWidgetTarget = { kind: "task" | "milestone" | "review"; id: string }
  | { kind: "review-step"; id: string; stepId: string };

type WidgetTask = {
  target: DesktopWidgetTarget;
  title: string;
  detail: string;
  done: boolean;
  due?: string;
};

export function desktopWidgetDate(zone: string, now = new Date()): string | null {
  if (!zone || zone.length > 64) return null;
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    return ["year", "month", "day"].map((part) => parts.find((value) => value.type === part)?.value).join("-");
  } catch { return null; }
}

function taskRows(data: Workspace, date: string) {
  const visible = withoutReviewPoolSources(data);
  const selected = withoutUnselectedExamReviewTasks(visible, date);
  const courseVisible = reviewPoolCourseVisibility(data.courses);
  const rows: WidgetTask[] = [
    ...selected.tasks.filter((task) => isLinkedExamReviewTask(task, data.milestones)
      ? !task.done || taskCompletionDate(task) === date
      : taskVisibleToday(task, date)).map((task): WidgetTask => ({
      target: { kind: "task", id: task.id }, title: task.title, done: task.done, due: task.due,
      detail: !task.done && task.progressedDates?.includes(date) ? "今日已推进"
        : taskStatusOf(task) === "已暂停" ? "已暂停" : task.courseId ? "课程" : task.area,
    })),
    ...visible.milestones.filter((node) => isTaskNode(node) && eventRequiresCompletion(node) && studyTaskVisibleOnDate(node, date))
      .map((node): WidgetTask => ({
        target: { kind: "milestone", id: node.id }, title: node.title, done: node.done, due: node.date || undefined,
        detail: !node.done && node.progressedDates?.includes(date) ? "今日已推进" : node.automationKey ? "自动学习" : node.courseId ? "课程" : "事项",
      })),
    ...(data.reviewPool?.items ?? []).filter((item) => courseVisible(item.course)).flatMap((item): WidgetTask[] => [
      ...(reviewPoolItemVisibleOnDate(item, date) ? [{
        target: { kind: "review" as const, id: item.id }, title: item.chapter, detail: item.course, done: item.done,
      }] : []),
      ...(item.steps ?? []).filter((step) => reviewPoolStepVisibleOnDate(step, date)).map((step): WidgetTask => ({
        target: { kind: "review-step", id: item.id, stepId: step.id }, title: step.title,
        detail: `${item.course} · ${item.chapter}`, done: step.done,
      })),
    ]),
  ];
  return { rows, selected };
}

export function desktopWidgetView(data: Workspace | null, date: string, revision: number) {
  if (!data) return { date, revision, total: 0, completed: 0, tasks: [], deadlines: [] };
  const { rows, selected } = taskRows(data, date);
  rows.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "9999-12-31").localeCompare(b.due ?? "9999-12-31"));
  const deadlines = upcomingDeadlines(selected.tasks, selected.milestones, date)
    .slice(0, 6).map(({ title, date, time }) => ({ title, date, time }));
  return { date, revision, total: rows.length, completed: rows.filter((row) => row.done).length, tasks: rows.slice(0, 24), deadlines };
}

export function completeDesktopWidgetTask(data: Workspace, target: DesktopWidgetTarget, done: boolean, date: string, logId: string): Workspace | null {
  const { rows } = taskRows(data, date);
  const row = rows.find((entry) => entry.target.kind === target.kind && entry.target.id === target.id
    && (entry.target.kind !== "review-step" || (target.kind === "review-step" && entry.target.stepId === target.stepId)));
  if (!row) return null;
  if (row.done === done) return data;
  if (target.kind === "task") {
    return { ...data, tasks: data.tasks.map((task) => {
      if (task.id !== target.id) return task;
      const next = setTaskCompleted(task, done, date, logId);
      if (done) next.completedDate = date;
      else delete next.completedDate;
      return next;
    }) };
  }
  if (target.kind === "milestone") {
    return { ...data, milestones: data.milestones.map((node) => {
      if (node.id !== target.id) return node;
      const next = { ...node, done };
      if (done) next.completedDate = date;
      else delete next.completedDate;
      return next;
    }) };
  }
  if (target.kind === "review-step") {
    const item = data.reviewPool?.items.find((entry) => entry.id === target.id);
    const steps = item?.steps?.map((step) => step.id === target.stepId ? { ...step, done } : step);
    return updateReviewPoolItem(data, target.id, { steps }, date);
  }
  return updateReviewPoolItem(data, target.id, { done }, date);
}
