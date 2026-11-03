import { isValidLocalDate } from "./finance.ts";
import type { AssessmentType } from "./course-events.ts";

export type TaskMode = "single" | "multi";
export type TaskProgressStatus = "未开始" | "进行中" | "已暂停" | "已完成";

export type TaskScheduleLike = {
  id?: string;
  title?: string;
  assessmentType?: AssessmentType;
  due?: string;
  dueTime?: string;
  plannedDate?: string;
  progressedDates?: string[];
  dismissedTodayDate?: string;
  date?: string;
  courseId?: string;
  alsoTask?: boolean;
  automationKey?: string;
  today?: boolean;
  done?: boolean;
  completedDate?: string;
  mode?: TaskMode;
  startDate?: string;
  status?: TaskProgressStatus;
  progress?: number;
  progressLogs?: { date: string; progress: number }[];
};

export const taskStatusOptions: TaskProgressStatus[] = ["未开始", "进行中", "已暂停", "已完成"];

export function isTaskNode(node: Pick<TaskScheduleLike, "courseId" | "alsoTask">) {
  return Boolean(node.courseId || node.alsoTask);
}

export function isPreparationEventTask(task: TaskScheduleLike) {
  return Boolean(task.alsoTask && !task.courseId && !task.automationKey && (task.assessmentType === "presentation" || task.assessmentType === "paper"
    || task.assessmentType === "submission" && /论文|\b(?:essays?|papers?|thesis|theses|dissertations?)\b/i.test(task.title?.normalize("NFKC") ?? "")));
}

export function defaultTaskPlannedDate(task: TaskScheduleLike) {
  const deadline = task.due || (isTaskNode(task) ? task.date : undefined);
  const cancelledManualPlan = deadline && task.plannedDate === task.dismissedTodayDate && !task.automationKey && !task.id?.startsWith("stage:") && taskModeOf(task) === "single";
  if (task.plannedDate && !cancelledManualPlan) return task.plannedDate;
  const preparation = taskModeOf(task) === "multi" && isPreparationEventTask(task);
  if (taskModeOf(task) === "multi" && !preparation || task.automationKey) return undefined;
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return undefined;
  const [year, month, day] = deadline.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  date.setUTCDate(date.getUTCDate() - (preparation ? 7 : 2));
  if (date.getUTCFullYear() < 1) return undefined;
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function newTaskPlannedDate(task: TaskScheduleLike, currentDate: string) {
  const planned = defaultTaskPlannedDate(task);
  return planned && !task.plannedDate && planned < currentDate && isValidLocalDate(currentDate) ? currentDate : planned;
}

export function workDateChangeAllowed(value: string, currentDate: string, original?: string) {
  return !value || isValidLocalDate(value) && (value >= currentDate || value === original);
}

export function workDateInputMinimum(value: string, currentDate: string, original?: string) {
  return value && value === original && value < currentDate ? value : currentDate;
}

export function planTaskForDate<T extends TaskScheduleLike>(task: T, targetDate: string): T {
  if (task.done || task.status === "已完成") return task;
  const { dismissedTodayDate: _dismissedTodayDate, ...rest } = task;
  return { ...rest, plannedDate: targetDate } as T;
}

export function nextWorkDate(date: string) {
  if (!isValidLocalDate(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(0);
  next.setUTCFullYear(year, month - 1, day + 1);
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function workProgressedOn(task: TaskScheduleLike, date: string) {
  return task.progressedDates?.includes(date) ?? false;
}

export function advanceWorkForDate<T extends TaskScheduleLike>(task: T, date: string, nextDate = nextWorkDate(date)): T {
  if (taskStatusOf(task) === "已完成" || !isValidLocalDate(date) || !isValidLocalDate(nextDate) || nextDate <= date) return task;
  return {
    ...planTaskForDate(task, nextDate),
    progressedDates: workProgressedOn(task, date) ? task.progressedDates : [...(task.progressedDates ?? []), date],
  };
}

function continuationVisibleOn(task: TaskScheduleLike, date: string): boolean | undefined {
  if (!task.progressedDates?.length) return undefined;
  if (workProgressedOn(task, date) || task.plannedDate === date) return true;
  if (task.plannedDate && task.plannedDate > date) return false;
  return undefined;
}

export function cancelWorkForDate<T extends TaskScheduleLike>(task: T, targetDate: string): T {
  return task.dismissedTodayDate === targetDate ? task : { ...task, dismissedTodayDate: targetDate };
}

export function courseNodeVisibleToday(node: TaskScheduleLike & { date: string; done: boolean }, targetDate: string) {
  if (isTaskNode(node) && node.dismissedTodayDate === targetDate) return false;
  if (isTaskNode(node) && node.done) return node.completedDate === targetDate;
  if (isTaskNode(node)) {
    const continued = continuationVisibleOn(node, targetDate);
    if (continued !== undefined) return continued;
  }
  if (isTaskNode(node) && taskModeOf(node) === "multi") return isPreparationEventTask(node) ? preparationTaskInTodayWindow(node, targetDate) : longTaskInTodayWindow(node, targetDate);
  return node.date === targetDate || Boolean(isTaskNode(node) && defaultTaskPlannedDate(node) === targetDate);
}

function preparationTaskInTodayWindow(task: TaskScheduleLike, targetDate: string) {
  if (!isValidLocalDate(targetDate)) return false;
  const planned = defaultTaskPlannedDate(task);
  const deadline = task.due || task.date;
  return Boolean(planned && isValidLocalDate(planned) && planned <= targetDate
    || deadline && isValidLocalDate(deadline) && deadline <= targetDate);
}

export function taskAwaitingStart(task: TaskScheduleLike, targetDate: string) {
  if (!task.alsoTask || task.courseId || task.automationKey || !isValidLocalDate(targetDate) || taskStatusOf(task) === "已完成") return false;
  const deadline = task.due || task.date;
  if (deadline && isValidLocalDate(deadline) && deadline <= targetDate) return false;
  if (task.today || task.progressedDates?.length || taskStatusOf(task) === "进行中" || taskProgressOf(task) > 0 || task.progressLogs?.some((entry) => entry.progress > 0)) return false;
  const planned = defaultTaskPlannedDate(task);
  return planned ? isValidLocalDate(planned) && planned > targetDate : isPreparationEventTask(task);
}

function longTaskInTodayWindow(task: TaskScheduleLike, targetDate: string) {
  const deadline = task.due || (isTaskNode(task) ? task.date : undefined);
  return Boolean(deadline && isValidLocalDate(deadline) && isValidLocalDate(targetDate)
    && dayDifference(targetDate, deadline) <= 7
    && (task.plannedDate === targetDate || !task.startDate || task.startDate <= targetDate));
}

export function taskCompletionDate(task: TaskScheduleLike) {
  if (task.completedDate) return task.completedDate;
  return task.progressLogs?.findLast((entry) => entry.progress === 100)?.date;
}

export function withWorkCompletionDates<T extends TaskScheduleLike & { id: string }, M extends TaskScheduleLike & { id: string }, S extends { tasks: T[]; milestones: M[] }>(previous: S, next: S, date: string): S {
  const update = <I extends TaskScheduleLike & { id: string }>(before: I[], after: I[]) => {
    const originals = new Map(before.map((item) => [item.id, item]));
    return after.map((item) => {
      if (taskStatusOf(item) !== "已完成") {
        if (!item.completedDate) return item;
        const { completedDate: _completedDate, ...rest } = item;
        return rest as I;
      }
      const original = originals.get(item.id);
      if (!original || taskStatusOf(original) === "已完成") return item;
      return { ...item, completedDate: date };
    });
  };
  return { ...next, tasks: update(previous.tasks, next.tasks), milestones: update(previous.milestones, next.milestones) };
}

export function taskModeOf(task: TaskScheduleLike): TaskMode {
  return task.mode === "multi" || task.mode === "single" ? task.mode : isPreparationEventTask(task) ? "multi" : "single";
}

export function taskProgressOf(task: TaskScheduleLike) {
  if (task.done || task.status === "已完成") return 100;
  return Math.min(99, Math.max(0, Math.round(Number(task.progress) || 0)));
}

export function taskStatusOf(task: TaskScheduleLike): TaskProgressStatus {
  if (task.done || task.status === "已完成") return "已完成";
  if (task.status === "已暂停") return "已暂停";
  if (task.status === "进行中" || taskProgressOf(task) > 0) return "进行中";
  return "未开始";
}

export function taskScheduledForDate(task: TaskScheduleLike, targetDate: string): boolean {
  if (isPreparationEventTask(task) && taskModeOf(task) === "multi") return taskVisibleToday(task, targetDate);
  const deadline = task.due || (isTaskNode(task) ? task.date : undefined);
  if (defaultTaskPlannedDate(task) === targetDate) return true;
  if (taskModeOf(task) === "single") return deadline === targetDate
    || Boolean(task.progressLogs?.some((entry) => entry.date === targetDate));
  const start = task.startDate || deadline || targetDate;
  const due = deadline || "9999-12-31";
  return start <= targetDate && targetDate <= due
    || Boolean(task.progressLogs?.some((entry) => entry.date === targetDate));
}

export function taskVisibleToday(task: TaskScheduleLike, targetDate: string): boolean {
  if (task.dismissedTodayDate === targetDate) return false;
  if (taskStatusOf(task) === "已完成") return taskCompletionDate(task) === targetDate;
  const continued = continuationVisibleOn(task, targetDate);
  if (continued !== undefined) return continued;
  if (taskModeOf(task) === "multi") return isPreparationEventTask(task) ? preparationTaskInTodayWindow(task, targetDate) : longTaskInTodayWindow(task, targetDate);
  if (task.plannedDate === targetDate) return true;
  return taskScheduledForDate(task, targetDate) || (!task.due && !task.plannedDate && task.today === true);
}

export function taskOverlapsRange(task: TaskScheduleLike, rangeStart: string, rangeEnd: string) {
  if (isPreparationEventTask(task) && taskModeOf(task) === "multi") {
    return [rangeStart, rangeEnd, defaultTaskPlannedDate(task), task.date, task.due, taskCompletionDate(task), ...(task.progressedDates ?? [])]
      .some((date) => Boolean(date && date >= rangeStart && date <= rangeEnd && taskVisibleToday(task, date)));
  }
  const plannedDate = defaultTaskPlannedDate(task);
  const deadline = task.due || (isTaskNode(task) ? task.date : undefined);
  if (plannedDate && plannedDate >= rangeStart && plannedDate <= rangeEnd) return true;
  if (taskModeOf(task) === "single") return [deadline, plannedDate].some((date) => Boolean(date && date >= rangeStart && date <= rangeEnd));
  const start = task.startDate || deadline || rangeStart;
  const due = deadline || "9999-12-31";
  return start <= rangeEnd && due >= rangeStart;
}

function utcDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dayDifference(from: string, to: string) {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

export function taskScheduleSummary(task: TaskScheduleLike, targetDate: string) {
  const plannedDate = defaultTaskPlannedDate(task);
  if (taskModeOf(task) === "single") return `${plannedDate ? `${plannedDate} 计划推进 · ` : ""}${task.due ? `截止 ${taskDeadlineLabel(task)}` : "未设截止"}`;
  const start = task.startDate || task.due || targetDate;
  const due = task.due || "";
  if (start > targetDate) return `${dayDifference(targetDate, start)} 天后开始`;
  if (!due) return `第 ${dayDifference(start, targetDate) + 1} 天 · 未设截止`;
  if (due < targetDate) return `已逾期 ${dayDifference(due, targetDate)} 天`;
  return `第 ${dayDifference(start, targetDate) + 1} 天 · 剩 ${dayDifference(targetDate, due)} 天`;
}

export function taskDeadlineLabel(task: TaskScheduleLike) {
  return task.due ? `${task.due}${task.dueTime ? ` ${task.dueTime}` : ""}` : "未设截止";
}
