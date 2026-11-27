import { isValidLocalDate } from "./finance.ts";
import { normalizeReviewChapter, reviewChapterKey } from "./review-chapter.ts";
import { type TaskScheduleLike } from "./task-progress.ts";

export type ReviewPoolSource = { kind: "task" | "milestone"; id: string };
export type ReviewPoolStep = { id: string; title: string; done: boolean; selectedDate?: string; completedDate?: string; archived?: true };
export type ReviewPoolItem = {
  id: string;
  course: string;
  chapter: string;
  progress: number;
  note: string;
  done: boolean;
  previousProgress?: number;
  selectedDate?: string;
  completedDate?: string;
  archived?: true;
  sources: ReviewPoolSource[];
  steps?: ReviewPoolStep[];
};
export type CourseReviewPool = { version: 1; items: ReviewPoolItem[]; removedSources?: ReviewPoolSource[] };
export type ReviewPoolDraft = Pick<ReviewPoolItem, "course" | "chapter" | "note">;
export type ReviewPoolTransferDraft = Pick<ReviewPoolDraft, "chapter" | "note"> & { completedToday?: boolean };

function validReviewPoolSteps(value: unknown): value is ReviewPoolStep[] {
  if (!Array.isArray(value) || value.length > 50) return false;
  const ids = new Set<string>();
  for (const step of value) {
    if (!step || typeof step !== "object" || typeof step.id !== "string" || !step.id || step.id.length > 120 || ids.has(step.id)
      || typeof step.title !== "string" || !step.title.trim() || step.title.length > 500 || typeof step.done !== "boolean" || step.archived !== undefined && step.archived !== true
      || step.selectedDate !== undefined && (typeof step.selectedDate !== "string" || !isValidLocalDate(step.selectedDate))
      || step.completedDate !== undefined && (!step.done || typeof step.completedDate !== "string" || !isValidLocalDate(step.completedDate))) return false;
    ids.add(step.id);
  }
  return true;
}

export function createReviewPoolStep(steps: ReviewPoolStep[], title: string, id: string): ReviewPoolStep {
  const step = { id, title: title.trim(), done: false };
  if (!step.title) throw new Error("请填写小任务内容");
  if (steps.length >= 50) throw new Error("每个复习项目最多添加 50 个小任务");
  if (!validReviewPoolSteps([...steps, step])) throw new Error("小任务内容最多 500 字，编号不能重复");
  return step;
}

export function editReviewPoolStep(steps: ReviewPoolStep[], id: string, title: string): ReviewPoolStep[] {
  if (!steps.some((step) => step.id === id)) throw new Error("这个小任务已不存在");
  const name = title.trim();
  if (!name) throw new Error("请填写小任务内容");
  const next = steps.map((step) => step.id === id ? { ...step, title: name } : step);
  if (!validReviewPoolSteps(next)) throw new Error("小任务内容最多 500 字");
  return next;
}

export function editReviewPoolItem(items: ReviewPoolItem[], id: string, draft: Pick<ReviewPoolDraft, "course" | "chapter">): ReviewPoolItem {
  const item = items.find((item) => item.id === id);
  if (!item) throw new Error("这个复习项目已不存在");
  const course = draft.course.trim();
  const chapter = normalizeReviewChapter(draft.chapter);
  if (!course || !chapter) throw new Error("请填写课程和复习项目");
  if (course.length > 500 || chapter.length > 500) throw new Error("课程或项目最多 500 字");
  const others = items.filter((current) => current.id !== id);
  if (others.some((current) => sameReviewCourse(current.course, course) && reviewChapterKey(current.chapter) === reviewChapterKey(chapter))) throw new Error("池中已有这个复习项目");
  return { ...item, course: others.find((current) => sameReviewCourse(current.course, course))?.course ?? course, chapter };
}

export function createReviewPoolItem(items: ReviewPoolItem[], draft: ReviewPoolDraft, id: string): ReviewPoolItem {
  const course = draft.course.trim();
  const chapter = normalizeReviewChapter(draft.chapter);
  const note = draft.note.trim();
  if (!course || !chapter) throw new Error("请填写课程和复习项目");
  if (course.length > 500 || chapter.length > 500 || note.length > 4000) throw new Error("课程或项目最多 500 字，备注最多 4000 字");
  if (items.length >= 500) throw new Error("复习池最多保存 500 个项目");
  if (items.some((item) => item.id === id || sameReviewCourse(item.course, course) && reviewChapterKey(item.chapter) === reviewChapterKey(chapter))) throw new Error("池中已有这个复习项目");
  const courseName = items.find((item) => sameReviewCourse(item.course, course))?.course ?? course;
  return { id, course: courseName, chapter, note, progress: 0, done: false, sources: [] };
}

type SourceRecord = TaskScheduleLike & {
  id: string;
  title: string;
  courseId?: string;
  source?: string;
  requirements?: string;
  time?: string;
  location?: string;
  parentCandidate?: boolean;
  automationKey?: string;
  parentId?: string;
  parentMilestoneId?: string;
};
type PoolState = {
  tasks: SourceRecord[];
  milestones: SourceRecord[];
  courses?: { id: string; title: string }[];
  reviewPool?: CourseReviewPool;
};

const historicalCourseAliases = [
  ["大数据分析", "大数据"],
  ["概率论与数理统计", "概率论", "概率"],
  ["会计学基础", "会计基础"],
  ["经济学基础", "经济学"],
  ["税收理论与实务", "税收理论", "税务", "税法"],
  ["线性代数b", "线性代数", "线代"],
] as const;
const formalWork = /作业|提交|考试|测验|测试|论文|报告|交付|答辩|quiz|homework|assignment|exam|deadline|\bddl\b/i;
const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const sourceKey = (source: ReviewPoolSource) => `${source.kind}:${source.id}`;

function reviewCourseKey(title: string) {
  const name = compact(title);
  return historicalCourseAliases.find((aliases) => aliases.some((alias) => name.includes(alias)))?.[0] ?? name;
}

export function sameReviewCourse(left: string, right: string) {
  return reviewCourseKey(left) === reviewCourseKey(right);
}

export function groupReviewPoolItems(items: ReviewPoolItem[]) {
  const groups = new Map<string, { key: string; course: string; items: ReviewPoolItem[] }>();
  for (const item of items) {
    if (item.archived) continue;
    const key = reviewCourseKey(item.course);
    const group = groups.get(key) ?? { key, course: item.course, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function movePoolEntry<T extends { id: string; archived?: true }>(entries: T[], id: string, direction: -1 | 1, sameGroup: (left: T, right: T) => boolean = () => true) {
  const item = entries.find((entry) => entry.id === id && !entry.archived);
  if (!item) return entries;
  const siblings = entries.filter((entry) => !entry.archived && sameGroup(item, entry));
  const neighbour = siblings[siblings.indexOf(item) + direction];
  if (!neighbour) return entries;
  return entries.map((entry) => entry === item ? neighbour : entry === neighbour ? item : entry);
}

export function setPoolEntryArchived<T extends { id: string; archived?: true }>(entries: T[], id: string, archived: boolean): T[] {
  return entries.map((entry) => {
    if (entry.id !== id || Boolean(entry.archived) === archived) return entry;
    if (archived) return { ...entry, archived: true };
    const restored = { ...entry };
    delete restored.archived;
    return restored;
  });
}

export function reviewPoolCourseVisibility(courseList: readonly { title: string; ended?: boolean }[]) {
  const ended = new Set(courseList.filter((course) => course.ended).map((course) => reviewCourseKey(course.title)));
  for (const course of courseList) {
    if (!course.ended) ended.delete(reviewCourseKey(course.title));
  }
  return (title: string) => !ended.has(reviewCourseKey(title));
}

export function deferStudyToReviewPool<T extends PoolState>(state: T, sourceId: string, draft: ReviewPoolTransferDraft, id: string, currentDate?: string): T {
  const pool = state.reviewPool;
  const source = state.milestones.find((node) => node.id === sourceId);
  const course = state.courses?.find((course) => course.id === source?.courseId);
  if (!pool || !source || !course || source.done || !source.automationKey?.startsWith("study:") || reviewPoolSourceKeys(state).has(`milestone:${sourceId}`)) return state;
  if (draft.completedToday && (!currentDate || !isValidLocalDate(currentDate))) throw new Error("请选择有效的完成日期");
  const chapter = normalizeReviewChapter(draft.chapter);
  const existing = pool.items.find((item) => sameReviewCourse(item.course, course.title) && reviewChapterKey(item.chapter) === reviewChapterKey(chapter));
  if (existing?.archived) throw new Error("该学习阶段已归档，请先恢复");
  if (existing?.done) throw new Error("这个项目已完成，请先标记未完成");
  if (existing && existing.sources.length >= 2_000) throw new Error("此项目的关联记录已达上限");
  const note = draft.note.trim();
  const combinedNote = existing && note && !existing.note.split("\n\n").includes(note) ? [existing.note, note].filter(Boolean).join("\n\n") : existing?.note ?? note;
  const courseName = existing?.course ?? pool.items.find((item) => sameReviewCourse(item.course, course.title))?.course ?? course.title;
  const created = createReviewPoolItem(existing ? pool.items.filter((item) => item.id !== existing.id) : pool.items, { course: courseName, chapter, note: combinedNote }, existing?.id ?? id);
  const item: ReviewPoolItem = { ...(existing ?? created), note: combinedNote, sources: [...(existing?.sources ?? []), { kind: "milestone", id: sourceId }] };
  delete item.selectedDate;
  const next = { ...state, reviewPool: { ...pool, items: existing ? pool.items.map((current) => current.id === existing.id ? item : current) : [...pool.items, item] } };
  return draft.completedToday ? updateReviewPoolItem(next, item.id, { done: true, selectedDate: currentDate! }, currentDate!) : next;
}

export function editedStudyToReviewPool<T extends PoolState>(state: T, edited: SourceRecord, draft: ReviewPoolTransferDraft, id: string, currentDate?: string): T {
  const original = state.milestones.find((node) => node.id === edited.id);
  if (!original || !original.automationKey?.startsWith("study:") || original.done || reviewPoolSourceKeys(state).has(`milestone:${edited.id}`)) return state;
  const title = edited.title.trim();
  if (!title || title.length > 500 || (edited.requirements?.length ?? 0) > 4000) throw new Error("请填写有效的任务名称和具体要求");
  const node = { ...original, title, requirements: edited.requirements ?? original.requirements, date: edited.date ?? original.date, time: edited.time ?? original.time, location: edited.location ?? original.location };
  for (const key of ["mode", "parentCandidate", "plannedDate", "dismissedTodayDate"] as const) {
    if (edited[key] === undefined) delete node[key];
    else Object.assign(node, { [key]: edited[key] });
  }
  const withEdits = { ...state, milestones: state.milestones.map((current) => current.id === original.id ? node : current) };
  const result = deferStudyToReviewPool(withEdits, original.id, draft, id, currentDate);
  return result === withEdits ? state : result;
}

function isFormalWork(record: SourceRecord) {
  return formalWork.test(record.title) || formalWork.test(record.requirements ?? "");
}

export function reviewPoolSourceKeys(state: Pick<PoolState, "tasks" | "reviewPool">): Set<string> {
  const keys = new Set([
    ...(state.reviewPool?.items.flatMap((item) => item.sources.map(sourceKey)) ?? []),
    ...(state.reviewPool?.removedSources?.map(sourceKey) ?? []),
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of state.tasks) {
      if (!task.id.startsWith("stage:") || isFormalWork(task) || keys.has(`task:${task.id}`)) continue;
      if (task.parentId && keys.has(`task:${task.parentId}`) || task.parentMilestoneId && keys.has(`milestone:${task.parentMilestoneId}`)) {
        keys.add(`task:${task.id}`);
        changed = true;
      }
    }
  }
  return keys;
}

export function withoutReviewPoolSources<T extends Pick<PoolState, "tasks" | "milestones" | "reviewPool">>(state: T): T {
  if (!state.reviewPool) return state;
  const keys = reviewPoolSourceKeys(state);
  if (!keys.size) return state;
  return { ...state, tasks: state.tasks.filter((item) => !keys.has(`task:${item.id}`)), milestones: state.milestones.filter((item) => !keys.has(`milestone:${item.id}`)) };
}

export function initializeCourseReviewPool<T extends PoolState>(state: T): T & { reviewPool: CourseReviewPool } {
  if (state.reviewPool) return state as T & { reviewPool: CourseReviewPool };
  return { ...state, reviewPool: { version: 1, items: [] } };
}

export function reviewPoolItemVisibleOnDate(item: ReviewPoolItem, date: string) {
  return !item.archived && item.selectedDate === date && (!item.done || item.completedDate === date);
}

export function reviewPoolStepVisibleOnDate(step: ReviewPoolStep, date: string) {
  return !step.archived && step.selectedDate === date && (!step.done || step.completedDate === date);
}

export function reviewPoolStepTodayCounts(item: Pick<ReviewPoolItem, "steps">, date: string) {
  const steps = item.steps?.filter((step) => !step.archived && (reviewPoolStepVisibleOnDate(step, date) || step.done && step.completedDate === date)) ?? [];
  return { total: steps.length, completed: steps.filter((step) => step.done && step.completedDate === date).length };
}

export function reviewPoolTodayCounts(items: ReviewPoolItem[], date: string) {
  const selected = items.filter((item) => !item.archived).flatMap((item) => [
    ...(reviewPoolItemVisibleOnDate(item, date) ? [item] : []),
    ...(item.steps?.filter((step) => reviewPoolStepVisibleOnDate(step, date)) ?? []),
  ]);
  return { total: selected.length, completed: selected.filter((entry) => entry.done).length };
}

export function deleteReviewPoolItem<T extends { reviewPool?: CourseReviewPool }>(state: T, id: string): T {
  const pool = state.reviewPool;
  const item = pool?.items.find((item) => item.id === id);
  if (!pool || !item) return state;
  const removedSources = [...new Map([...(pool.removedSources ?? []), ...item.sources].map((source) => [sourceKey(source), source])).values()];
  return { ...state, reviewPool: { ...pool, items: pool.items.filter((item) => item.id !== id), ...(removedSources.length ? { removedSources } : {}) } };
}

export function restoreReviewPoolItem<T extends { reviewPool?: CourseReviewPool }>(state: T, item: ReviewPoolItem, index: number): T {
  const pool = state.reviewPool;
  if (!pool || pool.items.length >= 500 || pool.items.some((current) => current.id === item.id || sameReviewCourse(current.course, item.course) && reviewChapterKey(current.chapter) === reviewChapterKey(item.chapter))) return state;
  const keys = new Set(item.sources.map(sourceKey));
  const { removedSources: previousSources, ...rest } = pool;
  const removedSources = previousSources?.filter((source) => !keys.has(sourceKey(source)));
  const items = [...pool.items];
  items.splice(Math.max(0, Math.min(items.length, index)), 0, item);
  return { ...state, reviewPool: { ...rest, items, ...(removedSources?.length ? { removedSources } : {}) } };
}

export function updateReviewPoolItem<T extends { reviewPool?: CourseReviewPool }>(state: T, id: string, patch: Partial<Pick<ReviewPoolItem, "course" | "chapter" | "progress" | "note" | "done" | "selectedDate" | "steps">>, currentDate: string): T {
  if (!state.reviewPool) return state;
  if (!isValidLocalDate(currentDate) || patch.selectedDate !== undefined && !isValidLocalDate(patch.selectedDate)) throw new Error("请选择有效日期");
  if (patch.progress !== undefined && (!Number.isInteger(patch.progress) || patch.progress < 0 || patch.progress > 100)) throw new Error("进度应为 0–100");
  if (patch.note !== undefined && patch.note.length > 4000) throw new Error("备注最多 4000 字");
  if (patch.steps !== undefined && !validReviewPoolSteps(patch.steps)) throw new Error("每个复习项目最多 50 个小任务，内容最多 500 字，编号不能重复");
  const original = state.reviewPool.items.find((item) => item.id === id);
  const edited = original && (patch.course !== undefined || patch.chapter !== undefined)
    ? editReviewPoolItem(state.reviewPool.items, id, { course: patch.course ?? original.course, chapter: patch.chapter ?? original.chapter }) : undefined;
  return { ...state, reviewPool: { ...state.reviewPool, items: state.reviewPool.items.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...patch, ...(edited ? { course: edited.course, chapter: edited.chapter } : {}) };
    if (patch.steps) next.steps = patch.steps.map((step) => {
      if (step.done && step.completedDate === undefined && !item.steps?.find((current) => current.id === step.id)?.done) return { ...step, completedDate: currentDate };
      if (!step.done) { const { completedDate: _completedDate, ...rest } = step; return rest; }
      return step;
    });
    if (patch.progress !== undefined) next.done = patch.progress === 100;
    if (patch.done === true) { next.done = true; next.progress = 100; }
    if (patch.done === false) { next.done = false; if (next.progress === 100) next.progress = item.previousProgress ?? 0; }
    if (next.done && !item.done) { next.completedDate = currentDate; next.previousProgress = item.progress; }
    if (!next.done) { delete next.completedDate; delete next.previousProgress; }
    if (next.selectedDate === undefined) delete next.selectedDate;
    if (next.steps?.length === 0) delete next.steps;
    return next;
  }) } };
}

export function chooseReviewPoolItem<T extends { reviewPool?: CourseReviewPool }>(state: T, id: string, date: string): T {
  const item = state.reviewPool?.items.find((item) => item.id === id);
  if (!item || item.done || item.archived) return state;
  return updateReviewPoolItem(state, id, { selectedDate: date }, date);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readablePool(value: unknown): value is CourseReviewPool {
  const pool = recordOf(value);
  if (pool?.version !== 1 || !Array.isArray(pool.items) || pool.items.length > 500) return false;
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const value of pool.items) {
    const item = recordOf(value);
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 120 || ids.has(item.id)
      || typeof item.course !== "string" || !item.course || item.course.length > 500
      || typeof item.chapter !== "string" || !item.chapter || item.chapter.length > 500 || typeof item.note !== "string" || item.note.length > 4000
      || typeof item.done !== "boolean" || typeof item.progress !== "number" || !Number.isInteger(item.progress)
      || item.progress < 0 || item.progress > 100 || item.done !== (item.progress === 100)
      || !Array.isArray(item.sources) || item.sources.length > 2000 || item.archived !== undefined && item.archived !== true
      || item.steps !== undefined && !validReviewPoolSteps(item.steps)
      || item.selectedDate !== undefined && (typeof item.selectedDate !== "string" || !isValidLocalDate(item.selectedDate))
      || item.completedDate !== undefined && (!item.done || typeof item.completedDate !== "string" || !isValidLocalDate(item.completedDate))
      || item.previousProgress !== undefined && (!item.done || typeof item.previousProgress !== "number" || !Number.isInteger(item.previousProgress) || item.previousProgress < 0 || item.previousProgress > 99)) return false;
    ids.add(item.id);
    for (const value of item.sources) {
      const source = recordOf(value);
      if (!source || source.kind !== "task" && source.kind !== "milestone" || typeof source.id !== "string" || !source.id || source.id.length > 120) return false;
      const key = `${source.kind}:${source.id}`;
      if (sources.has(key)) return false;
      sources.add(key);
    }
  }
  if (pool.removedSources !== undefined) {
    if (!Array.isArray(pool.removedSources) || pool.removedSources.length > 30_000) return false;
    for (const value of pool.removedSources) {
      const source = recordOf(value);
      if (!source || source.kind !== "task" && source.kind !== "milestone" || typeof source.id !== "string" || !source.id || source.id.length > 120) return false;
      const key = `${source.kind}:${source.id}`;
      if (sources.has(key)) return false;
      sources.add(key);
    }
  }
  return true;
}

/** A read projection only: unknown legacy fields and stored source records are never rewritten. */
export function reviewPoolReadProjection(raw: unknown): Record<string, unknown> {
  const state = recordOf(raw) ?? {};
  if (!readablePool(state.reviewPool)) return state;
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).flatMap((value): SourceRecord[] => {
    const task = recordOf(value);
    if (!task || typeof task.id !== "string" || typeof task.title !== "string") return [];
    return [{ id: task.id, title: task.title,
      ...(typeof task.requirements === "string" ? { requirements: task.requirements } : {}),
      ...(typeof task.parentId === "string" ? { parentId: task.parentId } : {}),
      ...(typeof task.parentMilestoneId === "string" ? { parentMilestoneId: task.parentMilestoneId } : {}),
    }];
  });
  const keys = reviewPoolSourceKeys({ tasks, reviewPool: state.reviewPool });
  const visible = (kind: ReviewPoolSource["kind"], value: unknown) => {
    const record = recordOf(value);
    return !record || typeof record.id !== "string" || !keys.has(`${kind}:${record.id}`);
  };
  return { ...state,
    ...(Array.isArray(state.tasks) ? { tasks: state.tasks.filter((value) => visible("task", value)) } : {}),
    ...(Array.isArray(state.milestones) ? { milestones: state.milestones.filter((value) => visible("milestone", value)) } : {}),
  };
}
