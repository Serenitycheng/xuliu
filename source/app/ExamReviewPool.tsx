"use client";

import { useEffect, useId, useRef, useState } from "react";
import { examReviewSummary, isExamReviewCandidate, isExamReviewEvent, type ExamReviewData, type ExamReviewEvent } from "@/lib/exam-review-pool";
import { defaultTaskPlannedDate, taskDeadlineLabel, taskModeOf, taskProgressOf, taskStatusOf, taskVisibleToday, type TaskScheduleLike } from "@/lib/task-progress";
import "./course-review-pool.css";
import "./exam-review-pool.css";

export type ExamReviewTask = TaskScheduleLike & { id: string; title: string; done: boolean; examEventId?: string };

type ExamReviewTaskActions = {
  onCreateTask: (eventId: string) => void;
  onEditTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onPlanToday: (taskId: string) => void;
  onCancelToday: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
};

type ExamReviewProps = ExamReviewTaskActions & {
  events: ExamReviewEvent[];
  tasks: ExamReviewTask[];
  courses: { id: string; title: string }[];
  today: string;
  readOnly: boolean;
  onChange: (eventId: string, review: { note: string }) => void;
};

const reviewOf = (event: ExamReviewEvent): ExamReviewData => event.examReview ?? { note: "", steps: [] };
const courseOf = (event: ExamReviewEvent, courses: ExamReviewProps["courses"]) => event.linkedCourseId ? courses.find((course) => course.id === event.linkedCourseId)?.title ?? "课程已移除" : "";
const dateOf = (event: ExamReviewEvent) => event.date ? `${event.date}${event.time ? ` ${event.time}` : ""}` : "日期待定";

function poolSummary(event: ExamReviewEvent, tasks: ExamReviewTask[], today: string) {
  const legacy = examReviewSummary(event, today);
  const todayTasks = tasks.filter((task) => taskVisibleToday(task, today));
  return {
    total: tasks.length + legacy.total,
    completed: tasks.filter((task) => taskStatusOf(task) === "已完成").length + legacy.completed,
    todayTotal: todayTasks.length + legacy.todayTotal,
    todayCompleted: todayTasks.filter((task) => taskStatusOf(task) === "已完成").length + legacy.todayCompleted,
  };
}

function ExamTodaySummary({ summary: { todayTotal, todayCompleted } }: { summary: ReturnType<typeof poolSummary> }) {
  if (!todayTotal) return null;
  return <span className="reviewPoolStepSummary">{todayCompleted ? todayCompleted === todayTotal ? `今日完成 ${todayCompleted} 项` : `今日完成 ${todayCompleted}/${todayTotal} 项` : `今日复习 ${todayTotal} 项`}</span>;
}

function ExamReviewTasks({ event, tasks, today, readOnly, onCreateTask, onEditTask, onToggleTask, onPlanToday, onCancelToday, onDeleteTask }: Pick<ExamReviewProps, "tasks" | "today" | "readOnly"> & ExamReviewTaskActions & { event: ExamReviewEvent }) {
  const legacySteps = event.examReview?.steps ?? [];
  const summary = poolSummary(event, tasks, today);
  return <section className="reviewPoolSteps examReviewSteps" aria-label={`${event.title} 复习任务`}>
    <div className="reviewPoolStepsHead"><span>复习任务 · {summary.completed}/{summary.total}</span>
      <button type="button" className="textButton" disabled={readOnly} onClick={() => onCreateTask(event.id)}>＋ 复习任务</button></div>
    {tasks.length > 0 && <ul>{tasks.map((task) => {
      const done = taskStatusOf(task) === "已完成";
      const plannedToday = taskVisibleToday(task, today);
      const plannedDate = defaultTaskPlannedDate(task);
      const multi = taskModeOf(task) === "multi";
      const schedule = [multi ? "长期任务" : "短期任务", multi && !done ? `${taskStatusOf(task)} · ${taskProgressOf(task)}%` : "", plannedDate ? `${plannedDate} 推进` : "", task.due ? `截止 ${taskDeadlineLabel(task)}` : "未设截止"].filter(Boolean).join(" · ");
      return <li key={task.id}>
        <button type="button" role="checkbox" className="checkButton reviewPoolCheck" aria-checked={done}
          aria-label={`${done ? "重新打开复习任务" : "完成复习任务"}：${event.title} · ${task.title}`} disabled={readOnly}
          onClick={() => onToggleTask(task.id)}>{done ? "✓" : ""}</button>
        <div className="reviewPoolStepTitle examReviewTaskText"><button type="button" className={`taskTitleButton${done ? " reviewPoolStepDone" : ""}`} onClick={() => onEditTask(task.id)}>{task.title}</button><span className="examReviewTaskMeta">{schedule}</span></div>
        {!done && <button type="button" className="textButton reviewPoolStepChoose" disabled={readOnly}
          aria-label={`${plannedToday ? "取消今天复习" : "今天复习"}：${event.title} · ${task.title}`}
          onClick={() => plannedToday ? onCancelToday(task.id) : onPlanToday(task.id)}>{plannedToday ? "取消今天" : "今天做"}</button>}
        <button type="button" className="reviewPoolStepEdit" disabled={readOnly} aria-label={`修改复习任务：${task.title}`} onClick={() => onEditTask(task.id)}>修改</button>
        <button type="button" className="reviewPoolStepRemove" disabled={readOnly} aria-label={`删除复习任务：${task.title}`} onClick={() => onDeleteTask(task.id)}>删除</button>
      </li>;
    })}</ul>}
    {legacySteps.length > 0 && <div className="examReviewLegacyTasks"><p>以下旧复习任务已保留。任务数量达到上限时，腾出空间后刷新即可转换。</p><ul>{legacySteps.map((step) => <li key={step.id}><span aria-label={step.done ? "已完成" : "未完成"}>{step.done ? "✓" : "○"}</span><span className={`reviewPoolStepTitle${step.done ? " reviewPoolStepDone" : ""}`}>{step.title}</span></li>)}</ul></div>}
  </section>;
}

export function ExamReviewPoolEntry({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="panel reviewPoolEntry examReviewPoolEntry" aria-haspopup="dialog" onClick={onOpen}>
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4H5v17h14V4h-3M8 3h8v4H8V3Zm0 9h8m-8 4h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span>考试复习池</span><span className="reviewPoolEntryArrow" aria-hidden="true">↗</span>
  </button>;
}

export function ExamReviewPoolDialog({ events, tasks, courses, today, readOnly, initialEventId, onClose, onChange, onCreateExam, onEditExam, onToggleExam, onExcludeExam, onCreateTask, onEditTask, onToggleTask, onPlanToday, onCancelToday, onDeleteTask }: ExamReviewProps & {
  initialEventId?: string;
  onClose: () => void;
  onCreateExam: () => void;
  onEditExam: (eventId: string) => void;
  onToggleExam: (eventId: string) => void;
  onExcludeExam: (eventId: string, excluded: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const initialRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"active" | "finished" | "excluded">(() => {
    const initial = events.find((event) => event.id === initialEventId);
    return initial?.examReview?.excluded ? "excluded" : initial?.done ? "finished" : "active";
  });
  const [expanded, setExpanded] = useState(() => new Set(initialEventId ? [initialEventId] : []));
  const [removed, setRemoved] = useState<{ id: string; title: string } | null>(null);
  const [focusEvent, setFocusEvent] = useState<string | null>(null);
  const exams = events.filter(isExamReviewEvent);
  const excluded = events.filter((event) => isExamReviewCandidate(event) && event.examReview?.excluded);
  const tasksByExam = new Map<string, ExamReviewTask[]>();
  for (const task of tasks) {
    if (!task.examEventId) continue;
    const related = tasksByExam.get(task.examEventId);
    if (related) related.push(task);
    else tasksByExam.set(task.examEventId, [task]);
  }
  const search = query.trim().normalize("NFKC").toLocaleLowerCase();
  const visible = (scope === "excluded" ? excluded : exams.filter((event) => event.done === (scope === "finished")))
    .filter((event) => !search || `${event.title} ${courseOf(event, courses)}`.normalize("NFKC").toLocaleLowerCase().includes(search))
    .sort((left, right) => (left.date || "9999").localeCompare(right.date || "9999") || left.time.localeCompare(right.time));
  const restoreExam = (event: ExamReviewEvent) => {
    if (readOnly) return;
    onExcludeExam(event.id, false);
    setRemoved(null);
    setQuery("");
    setScope(event.done ? "finished" : "active");
    setExpanded((current) => new Set([...current, event.id]));
    setFocusEvent(event.id);
  };
  useEffect(() => { if (removed) undoRef.current?.focus(); }, [removed]);
  useEffect(() => { if (focusEvent) { initialRef.current?.focus(); setFocusEvent(null); } }, [focusEvent]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    (initialRef.current ?? closeRef.current)?.focus();
    initialRef.current?.scrollIntoView({ block: "center" });
    return () => { dialog?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialogRef} className="reviewPoolDialog examReviewPoolDialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="reviewPoolHead"><h2 id={titleId}>考试复习池</h2><div className="reviewPoolHeadActions">
      <button type="button" className="softButton reviewPoolAddButton" disabled={readOnly} onClick={onCreateExam}>＋ 新增考试</button>
      <button type="button" ref={closeRef} className="reviewPoolClose" aria-label="关闭考试复习池" onClick={onClose}>×</button>
    </div></header>
    <div className="reviewPoolContents">
      <div className="examReviewFilters"><div className="examReviewScope" aria-label="考试状态"><button type="button" aria-pressed={scope === "active"} onClick={() => setScope("active")}>未结束 <span>{exams.filter((event) => !event.done).length}</span></button><button type="button" aria-pressed={scope === "finished"} onClick={() => setScope("finished")}>已结束 <span>{exams.filter((event) => event.done).length}</span></button>{(excluded.length > 0 || scope === "excluded") && <button type="button" aria-pressed={scope === "excluded"} onClick={() => setScope("excluded")}>已移出 <span>{excluded.length}</span></button>}</div>
        <input type="search" aria-label="搜索考试" placeholder="搜索考试或课程" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {removed && !readOnly && <div className="reviewPoolStepUndo"><span role="status">已移出 {removed.title}，原事项保留</span><button type="button" ref={undoRef} className="textButton" onClick={() => { const event = events.find((item) => item.id === removed.id); if (event && isExamReviewCandidate(event)) restoreExam(event); else setRemoved(null); }}>撤销</button></div>}
      {scope === "excluded" && <p className="examReviewExcludedHint">原事项和复习内容均保留，可随时恢复。</p>}
      {!visible.length && <p className="examReviewEmpty">{search ? "没有匹配的考试" : scope === "excluded" ? "暂无移出的考试" : scope === "finished" ? "暂无已结束考试" : "暂无考试"}</p>}
      <ul className="reviewPoolList examReviewExamList">{visible.map((event) => {
        const open = expanded.has(event.id);
        const review = reviewOf(event);
        const relatedTasks = tasksByExam.get(event.id) ?? [];
        const summary = poolSummary(event, relatedTasks, today);
        const course = courseOf(event, courses);
        if (scope === "excluded") return <li key={event.id} className="examReviewExam examReviewExcludedRow">
          <div className="examReviewExamTitle"><strong>{event.title}</strong><span className="examReviewExamMeta">{course ? `${course} · ` : ""}{dateOf(event)}</span></div>
          <button type="button" className="textButton" disabled={readOnly} aria-label={`恢复到考试复习池：${event.title}`} onClick={() => restoreExam(event)}>恢复到复习池</button>
        </li>;
        return <li key={event.id} className="examReviewExam">
          <button type="button" ref={(focusEvent ?? initialEventId) === event.id ? initialRef : undefined} className="examReviewExamToggle" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}考试复习：${event.title}`} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(event.id)) next.delete(event.id); else next.add(event.id); return next; })}>
            <span className="examReviewExamTitle"><strong>{event.title}</strong><span className="examReviewExamMeta">{event.assessmentType === "quiz" ? "测验" : "考试"}{course ? ` · ${course}` : ""} · {dateOf(event)}</span><ExamTodaySummary summary={summary} /></span>
            <span className="examReviewExamCount">{summary.completed}/{summary.total}</span><span className={`reviewPoolDisclosure${open ? " reviewPoolDisclosureOpen" : ""}`} aria-hidden="true">›</span>
          </button>
          {open && <div className="reviewPoolDetails examReviewExamDetails">
            <div className="reviewPoolItemActions"><button type="button" className="textButton" disabled={readOnly} onClick={() => onEditExam(event.id)}>修改考试</button><button type="button" className="textButton" disabled={readOnly} onClick={() => onToggleExam(event.id)}>{event.done ? "重新打开考试" : "标记考试结束"}</button><button type="button" className="textButton" disabled={readOnly} aria-label={`移出考试复习池：${event.title}`} title="仅移出复习池，保留原事项和复习内容" onClick={() => { onExcludeExam(event.id, true); setRemoved({ id: event.id, title: event.title }); }}>移出复习池</button></div>
            <ExamReviewTasks event={event} tasks={relatedTasks} today={today} readOnly={readOnly} onCreateTask={onCreateTask} onEditTask={onEditTask} onToggleTask={onToggleTask} onPlanToday={onPlanToday} onCancelToday={onCancelToday} onDeleteTask={onDeleteTask} />
            <label className="reviewPoolNote"><span>进度与备注</span><textarea aria-label={`${event.title} 复习进度与备注`} rows={3} maxLength={4000} value={review.note} disabled={readOnly} onChange={(change) => onChange(event.id, { note: change.target.value })} /></label>
          </div>}
        </li>;
      })}</ul>
    </div>
  </dialog>;
}
