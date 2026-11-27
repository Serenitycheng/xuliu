import { isValidLocalDate } from "../../lib/finance.ts";
import { taskCompletionDate, taskProgressOf, taskStatusOf, type TaskScheduleLike } from "../../lib/task-progress.ts";
import type { CourseReviewPool, ReviewPoolItem, ReviewPoolSource } from "../../lib/course-review-pool.ts";

type SourceRecord = TaskScheduleLike & { id: string; title: string; courseId?: string; source?: string; requirements?: string; automationKey?: string; parentId?: string; parentMilestoneId?: string };
type PoolState = { tasks: SourceRecord[]; milestones: SourceRecord[]; courses?: { id: string; title: string }[]; reviewPool?: CourseReviewPool };
const formalWork = /作业|提交|考试|测验|测试|论文|报告|交付|答辩|quiz|homework|assignment|exam|deadline|\bddl\b/i;
const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const sourceKey = (source: ReviewPoolSource) => `${source.kind}:${source.id}`;
const isFormalWork = (record: SourceRecord) => formalWork.test(record.title) || formalWork.test(record.requirements ?? "");

// Reproduce historical persisted data for regression tests.
const courses = [
  { key: "big-data", title: "大数据分析", aliases: ["大数据分析", "大数据"], chapters: ["L2", "L3", "L4"] },
  { key: "probability", title: "概率论", aliases: ["概率论与数理统计", "概率论", "概率"], chapters: ["第1章", "第2章"] },
  { key: "accounting", title: "会计学基础", aliases: ["会计学基础", "会计基础"], chapters: ["L1", "L2", "L3"] },
  { key: "economics", title: "经济学基础", aliases: ["经济学基础", "经济学"], chapters: ["L1", "L2", "L3", "L4"] },
  { key: "tax", title: "税收理论与实务", aliases: ["税收理论与实务", "税收理论", "税务", "税法"], chapters: ["第1章", "第2章", "第3章"] },
  { key: "linear-algebra", title: "线性代数", aliases: ["线性代数b", "线性代数", "线代"], chapters: ["第1章", "第2章"] },
] as const;

function matchReview(record: SourceRecord, state: PoolState): string | undefined {
  if (record.automationKey || record.id.startsWith("stage:") || isFormalWork(record)) return;
  const title = compact(record.title);
  const context = [title, compact(record.source ?? ""), compact(state.courses?.find((course) => course.id === record.courseId)?.title ?? "")];
  const candidates = courses.filter((course) => course.aliases.some((alias) => context.some((value) => value.includes(alias))));
  if (candidates.length !== 1) return;
  const course = candidates[0];
  const chapterMatches = [...title.matchAll(/(?:lecture|lec|l)([1-9]\d*)|第([一二三四五六七八九十\d]+)章|(?:chapter|ch)([1-9]\d*)/g)];
  if (chapterMatches.length !== 1) return;
  const match = chapterMatches[0];
  const numeral = match[1] ?? match[2] ?? match[3];
  const number = /^\d+$/.test(numeral) ? Number(numeral) : "一二三四五六七八九十".indexOf(numeral) + 1;
  if (!number) return;
  const chapter = course.chapters.find((value) => Number(value.match(/\d+/)?.[0]) === number);
  if (!chapter) return;
  let remainder = title.replace(match[0], "");
  for (const alias of course.aliases) remainder = remainder.replace(alias, "");
  remainder = remainder.replace(/\((?:全英文|英文|中文)\)/g, "");
  const explicitReview = /rev(?:iew)?|复习|自学|学习/.test(remainder);
  const onlyCourseAndChapter = remainder.replace(/[·:：/\\_\-—()（）]/g, "") === "";
  if (!explicitReview && !onlyCourseAndChapter) return;
  // Keep mixed or ambiguous work outside the pool rather than absorbing it by a keyword alone.
  remainder = remainder.replace(/review|rev|复习|自学|学习/g, "").replace(/[·:：/\\_\-—()（）]/g, "");
  if (remainder) return;
  return `review:${course.key}:${chapter.startsWith("L") ? chapter : number}`;
}

export function initializeCourseReviewPool<T extends PoolState>(state: T, selectedDate = "2026-10-23"): T & { reviewPool: CourseReviewPool } {
  if (state.reviewPool) return state as T & { reviewPool: CourseReviewPool };
  if (!isValidLocalDate(selectedDate)) throw new Error("请选择有效日期");
  const originals = [
    ...state.tasks.map((record) => ({ kind: "task" as const, record })),
    ...state.milestones.map((record) => ({ kind: "milestone" as const, record })),
  ];
  const matches = originals.map((source) => ({ ...source, itemId: matchReview(source.record, state) }));
  const items: ReviewPoolItem[] = courses.flatMap((course) => course.chapters.map((chapter): ReviewPoolItem => {
    const id = `review:${course.key}:${chapter.startsWith("L") ? chapter : Number(chapter.match(/\d+/)?.[0])}`;
    const matching = matches.filter((source) => source.itemId === id);
    const done = matching.some(({ record }) => taskStatusOf(record) === "已完成" || record.progress === 100);
    const progress = done ? 100 : Math.max(0, ...matching.map(({ record }) => taskProgressOf(record)));
    const completedDate = matching.filter(({ record }) => taskStatusOf(record) === "已完成" || record.progress === 100)
      .map(({ record }) => taskCompletionDate(record)).filter((date): date is string => Boolean(date)).sort().at(-1);
    const sources: ReviewPoolSource[] = matching.map(({ kind, record }) => ({ kind, id: record.id }));
    const keys = new Set(sources.map(sourceKey));
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of state.tasks) {
        if (!task.id.startsWith("stage:") || isFormalWork(task) || keys.has(`task:${task.id}`)) continue;
        if (task.parentId && keys.has(`task:${task.parentId}`) || task.parentMilestoneId && keys.has(`milestone:${task.parentMilestoneId}`)) {
          sources.push({ kind: "task", id: task.id });
          keys.add(`task:${task.id}`);
          changed = true;
        }
      }
    }
    return { id, course: course.title, chapter, progress, note: "", done, sources,
      ...(!done && id === "review:economics:L1" ? { selectedDate } : {}),
      ...(done && completedDate ? { completedDate } : {}),
    };
  }));
  return { ...state, reviewPool: { version: 1, items } };
}

