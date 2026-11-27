"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createReviewPoolItem, createReviewPoolStep, editReviewPoolItem, editReviewPoolStep, groupReviewPoolItems, movePoolEntry, setPoolEntryArchived, reviewPoolItemVisibleOnDate, reviewPoolStepVisibleOnDate, reviewPoolStepTodayCounts, sameReviewCourse, type ReviewPoolItem, type ReviewPoolStep, type ReviewPoolTransferDraft } from "../lib/course-review-pool";
import { reviewChapterKey } from "../lib/review-chapter";
import { submitFormOnEnter } from "./form-keyboard";
import "./course-review-pool.css";

type ReviewPoolChange = (id: string, patch: Partial<Pick<ReviewPoolItem, "course" | "chapter" | "note" | "done" | "selectedDate" | "steps">>) => void;

type ReviewPoolProps = {
  items: ReviewPoolItem[];
  today: string;
  readOnly: boolean;
  onChange: ReviewPoolChange;
};

const courseSearchKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

function ReviewPoolPicker({ options, value, onChange, label, placeholder, listLabel, expandLabel, searchKey = courseSearchKey }: {
  options: string[]; value: string; onChange: (value: string) => void;
  label: string; placeholder: string; listLabel: string; expandLabel: string;
  searchKey?: (value: string) => string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = searchKey(value);
  const choices = [...new Set(options)].filter((name) => {
    if (showAll || !query) return true;
    let index = 0;
    for (const letter of searchKey(name)) if (letter === query[index]) index++;
    return index === query.length;
  });
  const active = Math.min(activeIndex, choices.length - 1);
  useEffect(() => {
    if (open) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, active, query, showAll]);
  const choose = (name: string) => { onChange(name); setOpen(false); setShowAll(false); };
  return <div className="reviewPoolCoursePicker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <div className="reviewPoolCourseInput"><input ref={inputRef} autoFocus role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      required maxLength={500} value={value} placeholder={placeholder} onFocus={() => setOpen(true)}
      onChange={(event) => { onChange(event.target.value); setShowAll(false); setActiveIndex(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation();
          if (!open) { setOpen(true); setActiveIndex(0); }
          else if (choices.length) setActiveIndex((active + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
        } else if (event.key === "Enter" && open && active >= 0) {
          event.preventDefault(); event.stopPropagation(); choose(choices[active]);
        } else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }} />
      <button type="button" className="reviewPoolAllCourses" aria-label={expandLabel} aria-expanded={open && showAll} aria-controls={open ? listId : undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { inputRef.current?.focus(); setShowAll(true); setActiveIndex(0); setOpen(!(open && showAll)); }}>⌄</button>
    </div>
    {open && <div className="reviewPoolCourseOptions" id={listId} role="listbox" aria-label={listLabel}>{choices.map((name, index) => <button type="button" role="option" tabIndex={-1} ref={index === active ? activeOptionRef : undefined} id={`${listId}-${index}`} key={name} aria-selected={index === active}
      onMouseDown={(event) => event.preventDefault()} onClick={() => choose(name)}>{name}</button>)}{!choices.length && <span>无匹配项，可直接填写</span>}</div>}
  </div>;
}

export function DeferStudyDialog({ course, items, onSave, onClose, title = "以后再学", initialDraft }: {
  course: string; items: ReviewPoolItem[]; onSave: (draft: ReviewPoolTransferDraft) => void; onClose: () => void;
  title?: string; initialDraft?: ReviewPoolTransferDraft;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<ReviewPoolTransferDraft>(() => ({ chapter: "", note: "", completedToday: false, ...initialDraft }));
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector("input")?.focus();
    return () => { dialog?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialogRef} className="reviewPoolDialog reviewPoolDeferDialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="reviewPoolHead"><h2 id={titleId}>{title}</h2><button type="button" className="reviewPoolClose" aria-label={`关闭${title}`} onClick={onClose}>×</button></header>
    <div className="reviewPoolContents"><form className="reviewPoolAddForm" onKeyDown={submitFormOnEnter} onSubmit={(event) => {
      event.preventDefault();
      try { onSave(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法放入知识学习池"); }
    }}>
      <div className="reviewPoolCourseField"><span>课程</span><strong className="reviewPoolDeferCourse">{course}</strong></div>
      <div className="reviewPoolCourseField"><span>学习阶段</span><ReviewPoolPicker options={items.filter((item) => !item.done && sameReviewCourse(item.course, course)).map((item) => item.chapter)} value={draft.chapter}
        label="以后再学的章节" placeholder="选择或填写章节" listLabel="已有学习阶段" expandLabel="展开已有学习阶段" searchKey={reviewChapterKey} onChange={(chapter) => { setDraft({ ...draft, chapter }); setError(""); }} /></div>
      <label className="reviewPoolAddNote"><span>备注（可选）</span><textarea aria-label="以后再学备注" rows={2} maxLength={4000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      <label className="reviewPoolCompleteToday"><input type="checkbox" checked={Boolean(draft.completedToday)} onChange={(event) => setDraft({ ...draft, completedToday: event.target.checked })} /><span>今日完成</span></label>
      {error && <p role="alert">{error}</p>}
      <div className="reviewPoolAddActions"><button type="button" className="textButton" onClick={onClose}>取消</button><button type="submit" className="primaryButton">放入知识学习池</button></div>
    </form></div>
  </dialog>;
}

export function ReviewPoolEntry({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="panel reviewPoolEntry" onClick={onOpen} aria-haspopup="dialog">
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5.5C9 3.5 5.5 3.5 3 4.5v14c2.5-1 6-1 9 1 3-2 6.5-2 9-1v-14c-2.5-1-6-1-9 1Zm0 0v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>知识学习池</span>
    <span className="reviewPoolEntryArrow" aria-hidden="true">↗</span>
  </button>;
}

function ReviewPoolCheck({ item, readOnly, onChange }: { item: ReviewPoolItem; readOnly: boolean; onChange: ReviewPoolChange }) {
  return <button type="button" role="checkbox" aria-checked={item.done}
    aria-label={`${item.done ? "标记未完成" : "标记完成"}：${item.course} ${item.chapter}`}
    className="checkButton reviewPoolCheck" disabled={readOnly}
    onClick={() => onChange(item.id, { done: !item.done })}>{item.done ? "✓" : ""}</button>;
}

function ReviewPoolStepCheck({ item, step, readOnly, onChange }: { item: ReviewPoolItem; step: ReviewPoolStep; readOnly: boolean; onChange: ReviewPoolChange }) {
  return <button type="button" role="checkbox" className="checkButton reviewPoolCheck" aria-checked={step.done}
    aria-label={`${step.done ? "标记小任务未完成" : "标记小任务完成"}：${item.course} ${item.chapter} ${step.title}`} disabled={readOnly}
    onClick={() => onChange(item.id, { steps: item.steps?.map((current) => current.id === step.id ? { ...current, done: !current.done, completedDate: undefined } : current) })}>{step.done ? "✓" : ""}</button>;
}

function ReviewPoolSteps({ item, today, readOnly, onChange }: Omit<ReviewPoolProps, "items"> & { item: ReviewPoolItem }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focusStep) { editRef.current?.focus(); setFocusStep(null); } }, [focusStep]);
  const steps = item.steps ?? [];
  const activeSteps = steps.filter((step) => !step.archived);
  const archivedSteps = steps.filter((step) => step.archived);
  return <section className="reviewPoolSteps" aria-label={`${item.course} ${item.chapter} 小任务`}>
    <div className="reviewPoolStepsHead">{activeSteps.length > 0 && <span>小任务 · {activeSteps.filter((step) => step.done).length}/{activeSteps.length}</span>}
      {!readOnly && !adding && <button type="button" className="textButton" disabled={steps.length >= 50} onClick={() => { setEditing(null); setError(""); setAdding(true); }}>＋ 小任务</button>}</div>
    {activeSteps.length > 0 && <ul>{activeSteps.map((step, index) => <li key={step.id}>
      {editing?.id === step.id && !readOnly ? <form className="reviewPoolStepForm reviewPoolStepEditForm" aria-label={`修改小任务：${step.title}`} onKeyDown={submitFormOnEnter} onSubmit={(event) => {
        event.preventDefault();
        try { onChange(item.id, { steps: editReviewPoolStep(steps, step.id, editing.title) }); setEditing(null); setFocusStep(step.id); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法修改小任务"); }
      }}><input autoFocus aria-label="修改小任务内容" required maxLength={500} value={editing.title} onChange={(event) => { setEditing({ ...editing, title: event.target.value }); setError(""); }} /><button type="submit" className="textButton">保存</button><button type="button" className="textButton" onClick={() => { setEditing(null); setFocusStep(step.id); setError(""); }}>取消</button></form> : <>
      <ReviewPoolStepCheck item={item} step={step} readOnly={readOnly} onChange={onChange} /><span className={`reviewPoolStepTitle${step.done ? " reviewPoolStepDone" : ""}`}>{step.title}</span>
      {(step.selectedDate === today || !step.done) && <button type="button" className="textButton reviewPoolStepChoose" disabled={readOnly}
        aria-label={`${step.selectedDate === today ? "取消今天的小任务" : "今天做小任务"}：${item.course} ${item.chapter} ${step.title}`}
        onClick={() => onChange(item.id, { steps: steps.map((current) => current.id === step.id ? { ...current, selectedDate: step.selectedDate === today ? undefined : today } : current) })}>{step.selectedDate === today ? "取消今天" : "今天做"}</button>}
      {!readOnly && <><button type="button" ref={focusStep === step.id ? editRef : undefined} className="reviewPoolStepEdit" aria-label={`修改小任务：${step.title}`} onClick={() => { setAdding(false); setEditing({ id: step.id, title: step.title }); setError(""); }}>修改</button><PoolOrderControls label={step.title} index={index} total={activeSteps.length} onMove={(direction) => onChange(item.id, { steps: movePoolEntry(steps, step.id, direction) })} /><button type="button" className="reviewPoolStepRemove" aria-label={`归档小任务：${step.title}`} onClick={() => onChange(item.id, { steps: setPoolEntryArchived(steps, step.id, true) })}>归档</button></>}
      </>}
    </li>)}</ul>}
    {archivedSteps.length > 0 && <details className="reviewPoolArchive"><summary>已归档小任务（{archivedSteps.length}）</summary>
      <ul>{archivedSteps.map((step) => <li key={step.id}><span className="reviewPoolStepTitle">{step.done ? "✓ " : ""}{step.title}</span>{!readOnly && <button type="button" className="textButton" onClick={() => onChange(item.id, { steps: setPoolEntryArchived(steps, step.id, false) })}>恢复</button>}</li>)}</ul>
    </details>}
    {adding && !readOnly && <form className="reviewPoolStepForm" onKeyDown={submitFormOnEnter} onSubmit={(event) => {
      event.preventDefault();
      try { const step = createReviewPoolStep(steps, draft, crypto.randomUUID()); onChange(item.id, { steps: [...steps, step] }); setDraft(""); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法添加小任务"); }
    }}><input autoFocus aria-label="小任务内容" required maxLength={500} value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} /><button type="submit" className="textButton">添加</button><button type="button" className="textButton" onClick={() => { setAdding(false); setDraft(""); setError(""); }}>收起</button></form>}
    {error && <p className="reviewPoolStepError" role="alert">{error}</p>}
  </section>;
}

function PoolOrderControls({ label, index, total, onMove }: { label: string; index: number; total: number; onMove: (direction: -1 | 1) => void }) {
  if (total < 2) return null;
  return <span className="reviewPoolOrder">
    <button type="button" className="reviewPoolStepEdit" aria-label={`上移：${label}`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
    <button type="button" className="reviewPoolStepEdit" aria-label={`下移：${label}`} disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
  </span>;
}

function ReviewPoolItemEditor({ item, items, courseNames, onSave, onCancel }: {
  item: ReviewPoolItem; items: ReviewPoolItem[]; courseNames: string[];
  onSave: (names: Pick<ReviewPoolItem, "course" | "chapter">) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ course: item.course, chapter: item.chapter });
  const [error, setError] = useState("");
  return <form className="reviewPoolAddForm reviewPoolEditForm" aria-label="修改学习阶段" onKeyDown={submitFormOnEnter} onSubmit={(event) => {
    event.preventDefault();
    try { const edited = editReviewPoolItem(items, item.id, draft); onSave({ course: edited.course, chapter: edited.chapter }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法修改学习阶段"); }
  }}>
    <div className="reviewPoolCourseField"><span>课程</span><ReviewPoolPicker options={courseNames} value={draft.course} label="修改复习课程" placeholder="选择或输入课程" listLabel="可选课程" expandLabel="展开全部课程" onChange={(course) => { setDraft({ ...draft, course }); setError(""); }} /></div>
    <label><span>学习阶段</span><input aria-label="修改学习阶段" required maxLength={500} value={draft.chapter} onChange={(event) => { setDraft({ ...draft, chapter: event.target.value }); setError(""); }} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="reviewPoolAddActions"><button type="button" className="textButton" onClick={onCancel}>取消</button><button type="submit" className="primaryButton">保存</button></div>
  </form>;
}

function ReviewPoolStepSummary({ item, today, id }: { item: ReviewPoolItem; today: string; id?: string }) {
  const { total, completed } = reviewPoolStepTodayCounts(item, today);
  if (!total) return null;
  const text = completed === total ? `今日完成 ${completed} 项` : completed ? `今日完成 ${completed}/${total} 项` : `今日小任务 ${total} 项`;
  return <span id={id} className="reviewPoolStepSummary">{text}</span>;
}

function ReviewPoolRow({ item, today, readOnly, onChange, onArchive, ordering, onEdit, editForm, expanded, onToggle, initialFocusRef, renderSources }: {
  item: ReviewPoolItem;
  today: string;
  readOnly: boolean;
  onChange: ReviewPoolChange;
  onArchive: () => void;
  ordering?: ReactNode;
  onEdit: () => void;
  editForm?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  initialFocusRef?: RefObject<HTMLButtonElement | null>;
  renderSources?: (item: ReviewPoolItem) => ReactNode;
}) {
  const detailId = useId();
  const selectedToday = item.selectedDate === today;
  return <li className={`reviewPoolItem${item.done ? " reviewPoolDone" : ""}`}>
    <div className="reviewPoolRow">
      <ReviewPoolCheck item={item} readOnly={readOnly} onChange={onChange} />
      <button type="button" className="reviewPoolChapter" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
        aria-label={`${item.course} ${item.chapter}，${expanded ? "收起" : "展开"}详情`} aria-describedby={reviewPoolStepTodayCounts(item, today).total ? `${detailId}-steps-today` : undefined} ref={initialFocusRef} onClick={onToggle}>
        <span>{item.chapter}</span>
        {item.done && <span className="reviewPoolProgressLabel">已完成</span>}
        <ReviewPoolStepSummary item={item} today={today} id={`${detailId}-steps-today`} />
        <span className={`reviewPoolDisclosure${expanded ? " reviewPoolDisclosureOpen" : ""}`} aria-hidden="true">›</span>
      </button>
      {selectedToday ? <button type="button" className="softButton reviewPoolChoose reviewPoolSelected" disabled={readOnly}
        aria-label={`取消今天学习：${item.course} ${item.chapter}`} onClick={() => onChange(item.id, { selectedDate: undefined })}>取消今天</button>
        : !item.done ? <button type="button" className="softButton reviewPoolChoose" disabled={readOnly}
          aria-label={`今天学：${item.course} ${item.chapter}`} onClick={() => onChange(item.id, { selectedDate: today })}>今天学</button> : null}
    </div>
    {expanded && <div className="reviewPoolDetails" id={detailId}>
      {!readOnly && !editForm && <div className="reviewPoolItemActions"><button type="button" className="textButton" aria-label={`修改学习阶段：${item.course} ${item.chapter}`} onClick={onEdit}>修改阶段</button>{ordering}<button type="button" className="reviewPoolDelete" aria-label={`归档学习阶段：${item.course} ${item.chapter}`} onClick={onArchive}>归档阶段</button></div>}
      {editForm}
      <ReviewPoolSteps item={item} today={today} readOnly={readOnly} onChange={onChange} />
      <label className="reviewPoolNote"><span>进度与备注</span>
        <textarea value={item.note} readOnly={readOnly} maxLength={4000} rows={3}
          aria-label={`${item.course} ${item.chapter} 进度与备注`} onChange={(event) => onChange(item.id, { note: event.target.value })} />
      </label>
      {item.sources.length > 0 && renderSources && <div className="reviewPoolSources"><h4>原有记录</h4>{renderSources(item)}</div>}
    </div>}
  </li>;
}

export function CourseReviewPoolDialog({ items, today, readOnly, onChange, onCreate, onArchive, onMove, courseNames, isCourseVisible, onClose, renderSources, initialItemId }: ReviewPoolProps & {
  onCreate: (item: ReviewPoolItem) => void;
  onArchive: (id: string, archived: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  courseNames: string[];
  isCourseVisible: (course: string) => boolean;
  onClose: () => void;
  renderSources?: (item: ReviewPoolItem) => ReactNode;
  initialItemId?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const createButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ course: "", chapter: "", note: "" });
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(() => new Set(initialItemId ? [initialItemId] : []));
  const courses = groupReviewPoolItems(items.filter((item) => isCourseVisible(item.course)));
  const archivedItems = items.filter((item) => item.archived);
  const [archivedOpen, setArchivedOpen] = useState(false);

  useEffect(() => { if (focusItemId) { initialFocusRef.current?.focus(); setFocusItemId(null); } }, [focusItemId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    initialFocusRef.current?.focus();
    initialFocusRef.current?.scrollIntoView({ block: "center" });
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog className="reviewPoolDialog" ref={dialogRef} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="reviewPoolHead"><h2 id={titleId}>知识学习池</h2><div className="reviewPoolHeadActions">
      {!readOnly && <button type="button" ref={createButton} className="softButton reviewPoolAddButton" disabled={items.length >= 500} aria-expanded={adding} onClick={() => { setEditingId(null); setAdding(!adding); setError(""); }}>＋ 学习阶段</button>}
      <button type="button" className="reviewPoolClose" aria-label="关闭知识学习池" onClick={onClose}>×</button></div>
    </header>
    <div className="reviewPoolContents">
      {adding && !readOnly && <form className="reviewPoolAddForm" onKeyDown={submitFormOnEnter} onSubmit={(event) => {
        event.preventDefault();
        try {
          if (!isCourseVisible(draft.course)) throw new Error("该课程已结课");
          const item = createReviewPoolItem(items, draft, crypto.randomUUID());
          onCreate(item);
          setDraft({ course: item.course, chapter: "", note: "" });
          setAdding(false);
          setError("");
          createButton.current?.focus();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法添加"); }
      }}>
        <div className="reviewPoolCourseField"><span>课程</span><ReviewPoolPicker options={courseNames} value={draft.course} label="复习课程" placeholder="选择或输入课程" listLabel="可选课程" expandLabel="展开全部课程" onChange={(course) => { setDraft({ ...draft, course }); setError(""); }} /></div>
        <label><span>学习阶段</span><input aria-label="学习阶段" required maxLength={500} placeholder="章节或学习内容" value={draft.chapter} onChange={(event) => { setDraft({ ...draft, chapter: event.target.value }); setError(""); }} /></label>
        <label className="reviewPoolAddNote"><span>备注（可选）</span><textarea aria-label="新学习阶段备注" rows={2} maxLength={4000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="reviewPoolAddActions"><button type="button" className="textButton" onClick={() => { setAdding(false); createButton.current?.focus(); }}>取消</button><button type="submit" className="primaryButton">加入知识学习池</button></div>
      </form>}
      {courses.map(({ key, course, items: courseItems }) => <details open className="reviewPoolCourse" key={key} aria-label={course}>
        <summary className="poolCourseHeader"><strong>{course}</strong><span>{courseItems.filter((item) => item.done).length}/{courseItems.length} 阶段完成</span></summary>
        <ul className="reviewPoolList">{courseItems.map((item, index) => <ReviewPoolRow key={item.id} item={item} today={today} readOnly={readOnly} onChange={onChange}
          onEdit={() => { setAdding(false); setEditingId(item.id); }}
          editForm={editingId === item.id && !readOnly ? <ReviewPoolItemEditor item={item} items={items} courseNames={courseNames} onCancel={() => { setEditingId(null); setFocusItemId(item.id); }} onSave={(names) => {
            if (!isCourseVisible(names.course)) throw new Error("该课程已结课");
            onChange(item.id, names); setEditingId(null); setFocusItemId(item.id);
          }} /> : undefined}
          onArchive={() => { onArchive(item.id, true); setArchivedOpen(true); }} ordering={<PoolOrderControls label={item.chapter} index={index} total={courseItems.length} onMove={(direction) => onMove(item.id, direction)} />}
          expanded={expanded.has(item.id)} initialFocusRef={(focusItemId ?? initialItemId) === item.id ? initialFocusRef : undefined} renderSources={renderSources}
          onToggle={() => setExpanded((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />)}</ul>
      </details>)}
      {courses.length === 0 && !adding && <p className="reviewPoolStepSummary">暂无学习阶段</p>}
      {archivedItems.length > 0 && <details className="reviewPoolArchive" open={archivedOpen} onToggle={(event) => setArchivedOpen(event.currentTarget.open)}>
        <summary>已归档学习阶段（{archivedItems.length}）</summary>
        <ul className="reviewPoolList">{archivedItems.map((item) => <li key={item.id}><span>{item.course} · {item.chapter}{item.done ? "（已完成）" : ""}</span>{!readOnly && <button type="button" className="textButton" onClick={() => onArchive(item.id, false)}>恢复</button>}</li>)}</ul>
      </details>}
    </div>
  </dialog>;
}

export function ReviewPoolToday({ items, today, readOnly, onChange, onOpenItem }: ReviewPoolProps & { onOpenItem: (id: string) => void }) {
  const selected = items.filter((item) => !item.archived && (reviewPoolItemVisibleOnDate(item, today) || item.steps?.some((step) => reviewPoolStepVisibleOnDate(step, today))));
  if (!selected.length) return null;
  return <section className="panel reviewPoolToday" aria-label="今日学习">
    <h2>今日学习</h2>
    <ul className="reviewPoolList">{selected.map((item) => <li className="reviewPoolTodayGroup" key={item.id}>
      {reviewPoolItemVisibleOnDate(item, today) ? <div className={`reviewPoolTodayRow${item.done ? " reviewPoolDone" : ""}`}>
        <ReviewPoolCheck item={item} readOnly={readOnly} onChange={onChange} />
        <button type="button" className="reviewPoolTodayTitle" aria-haspopup="dialog" onClick={() => onOpenItem(item.id)}>
          <span>{item.course} · {item.chapter}</span>{item.done && <span className="reviewPoolProgressLabel">已完成</span>}<ReviewPoolStepSummary item={item} today={today} />
        </button>
        <button type="button" className="reviewPoolTodayCancel" disabled={readOnly} aria-label={`取消今天学习：${item.course} ${item.chapter}`}
          onClick={() => onChange(item.id, { selectedDate: undefined })}>取消今天</button>
      </div> : <button type="button" className="reviewPoolTodayCourse" aria-haspopup="dialog" onClick={() => onOpenItem(item.id)}>{item.course} · {item.chapter}<ReviewPoolStepSummary item={item} today={today} /></button>}
      <ul className="reviewPoolTodaySteps">{item.steps?.filter((step) => reviewPoolStepVisibleOnDate(step, today)).map((step) => <li className="reviewPoolTodayRow" key={step.id}>
        <ReviewPoolStepCheck item={item} step={step} readOnly={readOnly} onChange={onChange} />
        <button type="button" className={`reviewPoolTodayTitle reviewPoolTodayStepTitle${step.done ? " reviewPoolStepDone" : ""}`} aria-haspopup="dialog" onClick={() => onOpenItem(item.id)}>{item.course} · {item.chapter} · {step.title}</button>
        <button type="button" className="reviewPoolTodayCancel" disabled={readOnly} aria-label={`取消今天的小任务：${item.course} ${item.chapter} ${step.title}`}
          onClick={() => onChange(item.id, { steps: item.steps?.map((current) => current.id === step.id ? { ...current, selectedDate: undefined } : current) })}>取消今天</button>
      </li>)}</ul>
    </li>)}</ul>
  </section>;
}
