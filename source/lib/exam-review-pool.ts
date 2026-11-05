import type { AssessmentType } from "./course-events.ts";
import { reviewPoolStepTodayCounts, reviewPoolStepVisibleOnDate, type ReviewPoolStep } from "./course-review-pool.ts";
import { isValidLocalDate } from "./finance.ts";

export type ExamReviewData = { note: string; steps: ReviewPoolStep[]; excluded?: boolean };
export type ExamReviewEvent = {
  id: string; title: string; date: string; time: string; done: boolean;
  area: "课内" | "课外" | "工作" | "生活" | "思考";
  courseId?: string; linkedCourseId?: string; assessmentType?: AssessmentType;
  examReview?: ExamReviewData;
};

export type ExamReviewTask = {
  id: string; title: string; done: boolean; area: ExamReviewEvent["area"];
  source: string; today: boolean; elapsed: number;
  examEventId?: string; courseId?: string; mode?: "single" | "multi";
  plannedDate?: string; completedDate?: string; showOnCalendar?: boolean;
};

/** Move legacy steps once; an ordinary task is then the only editable record. */
export function migrateExamReviewTasks<S extends { tasks: ExamReviewTask[]; milestones: ExamReviewEvent[] }>(state: S): S {
  if (state.tasks.length >= 10_000 || !state.milestones.some((event) => event.examReview?.steps.length)) return state;
  const usedIds = new Set([...state.tasks, ...state.milestones].map((item) => item.id));
  // A collision suffix must not take the original ID of a later legacy step.
  const reservedStepIds = new Set(state.milestones.flatMap((event) => event.examReview?.steps.map((step) => step.id) ?? []));
  const tasks = [...state.tasks];
  const milestones = state.milestones.map((event) => {
    const review = event.examReview;
    if (!review?.steps.length || tasks.length >= 10_000) return event;
    const remaining: ReviewPoolStep[] = [];
    for (const step of review.steps) {
      if (tasks.length >= 10_000 || !validSteps([step])) { remaining.push(step); continue; }
      let taskId = step.id;
      for (let index = 1; usedIds.has(taskId) || taskId !== step.id && reservedStepIds.has(taskId); index += 1) {
        const suffix = `-exam-review-${index}`;
        taskId = `${step.id.slice(0, 120 - suffix.length)}${suffix}`;
      }
      usedIds.add(taskId);
      const courseId = event.linkedCourseId ?? event.courseId;
      tasks.push({
        id: taskId, title: step.title, done: step.done, area: event.area, source: event.title,
        examEventId: event.id, ...(courseId ? { courseId } : {}),
        mode: "single", today: false, elapsed: 0, showOnCalendar: false,
        ...(step.selectedDate !== undefined ? { plannedDate: step.selectedDate } : {}),
        ...(step.completedDate !== undefined ? { completedDate: step.completedDate } : {}),
      });
    }
    return remaining.length === review.steps.length ? event : { ...event, examReview: { ...review, steps: remaining } };
  });
  return tasks.length === state.tasks.length ? state : { ...state, tasks, milestones };
}

export function isExamReviewCandidate(event: Pick<ExamReviewEvent, "courseId" | "assessmentType">) {
  return !event.courseId && (event.assessmentType === "exam" || event.assessmentType === "quiz");
}

export function isExamReviewEvent(event: Pick<ExamReviewEvent, "courseId" | "assessmentType" | "examReview">) {
  return isExamReviewCandidate(event) && event.examReview?.excluded !== true;
}

export function setExamReviewExcluded<T extends ExamReviewEvent>(event: T, excluded: boolean): T {
  if (!isExamReviewCandidate(event)) throw new Error("仅考试和测验事项可设置是否进入考试复习池");
  if (typeof excluded !== "boolean") throw new Error("请选择有效的复习池状态");
  const current = event.examReview;
  if (excluded) {
    return current?.excluded === true ? event : { ...event, examReview: { ...(current ?? { note: "", steps: [] }), excluded: true } };
  }
  if (current?.excluded === undefined) return event;
  const { excluded: _excluded, ...review } = current;
  return { ...event, examReview: review };
}

export function examReviewSummary(event: Pick<ExamReviewEvent, "examReview">, today: string) {
  const steps = event.examReview?.steps ?? [];
  const current = reviewPoolStepTodayCounts({ steps }, today);
  return { total: steps.length, completed: steps.filter((step) => step.done).length, todayTotal: current.total, todayCompleted: current.completed };
}

export function examReviewTodayCounts(events: ExamReviewEvent[], today: string) {
  const steps = events.filter((event) => isExamReviewEvent(event) && !event.done)
    .flatMap((event) => event.examReview?.steps.filter((step) => reviewPoolStepVisibleOnDate(step, today)) ?? []);
  return { total: steps.length, completed: steps.filter((step) => step.done).length };
}

function validSteps(steps: ReviewPoolStep[]) {
  if (!Array.isArray(steps) || steps.length > 50) return false;
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step.id !== "string" || !step.id || step.id.length > 120 || ids.has(step.id)
      || typeof step.title !== "string" || !step.title.trim() || step.title.length > 500 || typeof step.done !== "boolean"
      || step.selectedDate !== undefined && (typeof step.selectedDate !== "string" || !isValidLocalDate(step.selectedDate))
      || step.completedDate !== undefined && (!step.done || typeof step.completedDate !== "string" || !isValidLocalDate(step.completedDate))) return false;
    ids.add(step.id);
  }
  return true;
}

/** Keep review preparation on the original event without changing its schedule or completion. */
export function updateExamReview<T extends ExamReviewEvent>(event: T, patch: Partial<Pick<ExamReviewData, "note" | "steps">>, today: string): T {
  if (!isExamReviewEvent(event)) throw new Error("仅考试和测验事项可编辑考试复习任务");
  if (!isValidLocalDate(today)) throw new Error("请选择有效日期");
  const current = event.examReview ?? { note: "", steps: [] };
  const note = patch.note ?? current.note;
  if (typeof note !== "string" || note.length > 4000) throw new Error("复习备注最多 4000 字");
  if (patch.steps !== undefined && !Array.isArray(patch.steps)) throw new Error("请选择有效的复习任务");
  const steps = patch.steps === undefined ? current.steps : patch.steps.map((step) => {
    if (!step || typeof step.done !== "boolean") return step;
    const previous = current.steps.find((item) => item.id === step.id);
    const next = { ...step };
    if (next.done && next.completedDate === undefined && previous?.done === false) next.completedDate = today;
    if (!next.done) delete next.completedDate;
    if (next.selectedDate === undefined) delete next.selectedDate;
    return next;
  });
  if (!validSteps(steps)) throw new Error("每个考试最多 50 个复习任务，内容最多 500 字，编号不能重复且日期须有效");
  return { ...event, examReview: { ...current, note, steps } };
}
