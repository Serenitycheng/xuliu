"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createReviewPoolStep, editReviewPoolStep, reviewPoolStepVisibleOnDate, type ReviewPoolStep } from "@/lib/course-review-pool";
import { examReviewSummary, isExamReviewEvent, type ExamReviewData, type ExamReviewEvent } from "@/lib/exam-review-pool";
import { submitFormOnEnter } from "./form-keyboard";
import "./course-review-pool.css";
import "./exam-review-pool.css";

type ExamReviewProps = {
  events: ExamReviewEvent[];
  courses: { id: string; title: string }[];
  today: string;
  readOnly: boolean;
  onChange: (eventId: string, review: ExamReviewData) => void;
};

const reviewOf = (event: ExamReviewEvent): ExamReviewData => event.examReview ?? { note: "", steps: [] };
const courseOf = (event: ExamReviewEvent, courses: ExamReviewProps["courses"]) => event.linkedCourseId ? courses.find((course) => course.id === event.linkedCourseId)?.title ?? "课程已移除" : "";
const dateOf = (event: ExamReviewEvent) => event.date ? `${event.date}${event.time ? ` ${event.time}` : ""}` : "日期待定";

function ExamTodaySummary({ event, today }: { event: ExamReviewEvent; today: string }) {
  const { todayTotal, todayCompleted } = examReviewSummary(event, today);
  if (!todayTotal) return null;
  return <span className="reviewPoolStepSummary">{todayCompleted ? todayCompleted === todayTotal ? `今日完成 ${todayCompleted} 项` : `今日完成 ${todayCompleted}/${todayTotal} 项` : `今日复习 ${todayTotal} 项`}</span>;
}

function ExamStepCheck({ event, step, readOnly, onChange }: Pick<ExamReviewProps, "readOnly" | "onChange"> & { event: ExamReviewEvent; step: ReviewPoolStep }) {
  const review = reviewOf(event);
  return <button type="button" role="checkbox" className="checkButton reviewPoolCheck" aria-checked={step.done}
    aria-label={`${step.done ? "重新打开复习任务" : "完成复习任务"}：${event.title} · ${step.title}`} disabled={readOnly}
    onClick={() => onChange(event.id, { ...review, steps: review.steps.map((current) => current.id === step.id ? { ...current, done: !current.done, completedDate: undefined } : current) })}>{step.done ? "✓" : ""}</button>;
}

function ExamReviewSteps({ event, today, readOnly, onChange }: Pick<ExamReviewProps, "today" | "readOnly" | "onChange"> & { event: ExamReviewEvent }) {
  const review = reviewOf(event);
  const steps = review.steps;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<{ step: ReviewPoolStep; index: number } | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  useEffect(() => { if (removed) undoRef.current?.focus(); }, [removed]);
  useEffect(() => { if (focusStep) { editRef.current?.focus(); setFocusStep(null); } }, [focusStep]);
  const saveSteps = (next: ReviewPoolStep[]) => onChange(event.id, { ...review, steps: next });
  return <section className="reviewPoolSteps examReviewSteps" aria-label={`${event.title} 复习任务`}>
    <div className="reviewPoolStepsHead"><span>复习任务 · {steps.filter((step) => step.done).length}/{steps.length}</span>
      {!readOnly && !adding && <button type="button" className="textButton" disabled={steps.length >= 50} onClick={() => { setEditing(null); setError(""); setAdding(true); }}>＋ 复习任务</button>}</div>
    {steps.length > 0 && <ul>{steps.map((step) => <li key={step.id}>
      {editing?.id === step.id && !readOnly ? <form className="reviewPoolStepForm reviewPoolStepEditForm" aria-label={`修改复习任务：${step.title}`} onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setEditing(null); setFocusStep(step.id); setError(""); }
        else submitFormOnEnter(event);
      }} onSubmit={(submit) => {
        submit.preventDefault();
        try { saveSteps(editReviewPoolStep(steps, step.id, editing.title)); setEditing(null); setFocusStep(step.id); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法修改复习任务"); }
      }}><input autoFocus aria-label="修改复习任务内容" required maxLength={500} value={editing.title} onChange={(change) => { setEditing({ ...editing, title: change.target.value }); setError(""); }} /><button type="submit" className="textButton">保存</button><button type="button" className="textButton" onClick={() => { setEditing(null); setFocusStep(step.id); setError(""); }}>取消</button></form> : <>
        <ExamStepCheck event={event} step={step} readOnly={readOnly} onChange={onChange} />
        <span className={`reviewPoolStepTitle${step.done ? " reviewPoolStepDone" : ""}`}>{step.title}</span>
        {!event.done && (step.selectedDate === today || !step.done) && <button type="button" className="textButton reviewPoolStepChoose" disabled={readOnly}
          aria-label={`${step.selectedDate === today ? "取消今天复习" : "今天复习"}：${event.title} · ${step.title}`}
          onClick={() => saveSteps(steps.map((current) => current.id === step.id ? { ...current, selectedDate: step.selectedDate === today ? undefined : today } : current))}>{step.selectedDate === today ? "取消今天" : "今天做"}</button>}
        {!readOnly && <><button ref={focusStep === step.id ? editRef : undefined} type="button" className="reviewPoolStepEdit" aria-label={`修改复习任务：${step.title}`} onClick={() => { setAdding(false); setEditing({ id: step.id, title: step.title }); setError(""); }}>修改</button>
          <button type="button" className="reviewPoolStepRemove" aria-label={`删除复习任务：${step.title}`} onClick={() => { setRemoved({ step, index: steps.findIndex((current) => current.id === step.id) }); setError(""); saveSteps(steps.filter((current) => current.id !== step.id)); }}>删除</button></>}
      </>}
    </li>)}</ul>}
    {removed && !readOnly && <div className="reviewPoolStepUndo"><span role="status">已删除 {removed.step.title}</span><button type="button" ref={undoRef} className="textButton" onClick={() => {
      try { createReviewPoolStep(steps, removed.step.title, removed.step.id); const restored = [...steps]; restored.splice(Math.min(removed.index, restored.length), 0, removed.step); saveSteps(restored); setRemoved(null); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法恢复复习任务"); }
    }}>撤销</button></div>}
    {adding && !readOnly && <form className="reviewPoolStepForm" onKeyDown={submitFormOnEnter} onSubmit={(submit) => {
      submit.preventDefault();
      try { saveSteps([...steps, createReviewPoolStep(steps, draft, crypto.randomUUID())]); setDraft(""); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法添加复习任务"); }
    }}><input autoFocus aria-label={`${event.title} 新复习任务`} required maxLength={500} value={draft} onChange={(change) => { setDraft(change.target.value); setError(""); }} /><button type="submit" className="textButton">添加</button><button type="button" className="textButton" onClick={() => { setAdding(false); setDraft(""); setError(""); }}>收起</button></form>}
    {error && <p className="reviewPoolStepError" role="alert">{error}</p>}
  </section>;
}

export function ExamReviewPoolEntry({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="panel reviewPoolEntry examReviewPoolEntry" aria-haspopup="dialog" onClick={onOpen}>
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4H5v17h14V4h-3M8 3h8v4H8V3Zm0 9h8m-8 4h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span>考试复习池</span><span className="reviewPoolEntryArrow" aria-hidden="true">↗</span>
  </button>;
}

export function ExamReviewPoolDialog({ events, courses, today, readOnly, initialEventId, onClose, onChange, onCreateExam, onEditExam, onToggleExam }: ExamReviewProps & {
  initialEventId?: string;
  onClose: () => void;
  onCreateExam: () => void;
  onEditExam: (eventId: string) => void;
  onToggleExam: (eventId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const initialRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [finished, setFinished] = useState(() => Boolean(events.find((event) => event.id === initialEventId)?.done));
  const [expanded, setExpanded] = useState(() => new Set(initialEventId ? [initialEventId] : []));
  const exams = events.filter(isExamReviewEvent);
  const search = query.trim().normalize("NFKC").toLocaleLowerCase();
  const visible = exams.filter((event) => event.done === finished && (!search || `${event.title} ${courseOf(event, courses)}`.normalize("NFKC").toLocaleLowerCase().includes(search)))
    .sort((left, right) => (left.date || "9999").localeCompare(right.date || "9999") || left.time.localeCompare(right.time));
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
      <div className="examReviewFilters"><div className="examReviewScope" aria-label="考试状态"><button type="button" aria-pressed={!finished} onClick={() => setFinished(false)}>未结束 <span>{exams.filter((event) => !event.done).length}</span></button><button type="button" aria-pressed={finished} onClick={() => setFinished(true)}>已结束 <span>{exams.filter((event) => event.done).length}</span></button></div>
        <input type="search" aria-label="搜索考试" placeholder="搜索考试或课程" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {!visible.length && <p className="examReviewEmpty">{search ? "没有匹配的考试" : finished ? "暂无已结束考试" : "暂无考试"}</p>}
      <ul className="reviewPoolList examReviewExamList">{visible.map((event) => {
        const open = expanded.has(event.id);
        const review = reviewOf(event);
        const summary = examReviewSummary(event, today);
        const course = courseOf(event, courses);
        return <li key={event.id} className="examReviewExam">
          <button type="button" ref={initialEventId === event.id ? initialRef : undefined} className="examReviewExamToggle" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}考试复习：${event.title}`} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(event.id)) next.delete(event.id); else next.add(event.id); return next; })}>
            <span className="examReviewExamTitle"><strong>{event.title}</strong><span className="examReviewExamMeta">{event.assessmentType === "quiz" ? "测验" : "考试"}{course ? ` · ${course}` : ""} · {dateOf(event)}</span><ExamTodaySummary event={event} today={today} /></span>
            <span className="examReviewExamCount">{summary.completed}/{summary.total}</span><span className={`reviewPoolDisclosure${open ? " reviewPoolDisclosureOpen" : ""}`} aria-hidden="true">›</span>
          </button>
          {open && <div className="reviewPoolDetails examReviewExamDetails">
            <div className="reviewPoolItemActions"><button type="button" className="textButton" disabled={readOnly} onClick={() => onEditExam(event.id)}>修改考试</button><button type="button" className="textButton" disabled={readOnly} onClick={() => onToggleExam(event.id)}>{event.done ? "重新打开考试" : "标记考试结束"}</button></div>
            <ExamReviewSteps event={event} today={today} readOnly={readOnly} onChange={onChange} />
            <label className="reviewPoolNote"><span>进度与备注</span><textarea aria-label={`${event.title} 复习进度与备注`} rows={3} maxLength={4000} value={review.note} disabled={readOnly} onChange={(change) => onChange(event.id, { ...review, note: change.target.value })} /></label>
          </div>}
        </li>;
      })}</ul>
    </div>
  </dialog>;
}

export function ExamReviewToday({ events, courses, today, readOnly, onChange, onOpenEvent }: ExamReviewProps & { onOpenEvent: (eventId: string) => void }) {
  const selected = events.filter((event) => isExamReviewEvent(event) && !event.done && event.examReview?.steps.some((step) => reviewPoolStepVisibleOnDate(step, today)));
  if (!selected.length) return null;
  return <section className="reviewPoolToday examReviewToday" aria-label="今日考试复习"><h2>考试复习</h2>{selected.map((event) => {
    const review = reviewOf(event);
    const course = courseOf(event, courses);
    const steps = review.steps.filter((step) => reviewPoolStepVisibleOnDate(step, today));
    return <div className="reviewPoolTodayGroup" key={event.id}>
      <button type="button" className="reviewPoolTodayCourse examReviewTodayExam" onClick={() => onOpenEvent(event.id)}><span>{event.title}</span><ExamTodaySummary event={event} today={today} /><small>{course ? `${course} · ` : ""}{dateOf(event)}</small></button>
      <ul className="reviewPoolTodaySteps">{steps.map((step) => <li className={`reviewPoolTodayRow${step.done ? " reviewPoolDone" : ""}`} key={step.id}>
        <ExamStepCheck event={event} step={step} readOnly={readOnly} onChange={onChange} />
        <button type="button" className="reviewPoolTodayTitle reviewPoolTodayStepTitle" onClick={() => onOpenEvent(event.id)}><span>{step.title}</span></button>
        <button type="button" className="reviewPoolTodayCancel" disabled={readOnly} aria-label={`取消今天复习：${event.title} · ${step.title}`} onClick={() => onChange(event.id, { ...review, steps: review.steps.map((current) => current.id === step.id ? { ...current, selectedDate: undefined } : current) })}>取消今天</button>
      </li>)}</ul>
    </div>;
  })}</section>;
}
