import test from 'node:test';
import assert from 'node:assert/strict';
import { examReviewSummary, examReviewTodayCounts, isExamReviewCandidate, isExamReviewEvent, setExamReviewExcluded, updateExamReview } from '../lib/exam-review-pool.ts';
import { createReviewPoolStep, editReviewPoolStep, reviewPoolReadProjection, withoutReviewPoolSources } from '../lib/course-review-pool.ts';
import { aiCourseContextFromWorkspace } from '../lib/ai-course-context.ts';
import { createEmptyWorkspaceState, workspaceStateSchema } from '../lib/workspace-state-schema.ts';
import { manualCalendarItems } from '../lib/calendar-items.ts';
import { upcomingDeadlines } from '../lib/upcoming-deadlines.ts';

const today = '2026-11-03';
const tomorrow = '2026-11-04';
const event = (patch = {}) => ({ id: 'exam-1', title: '税务考试', date: '2026-11-17', time: '10:10', area: '课内', done: false, assessmentType: 'exam', location: '教室', requirements: '保留考试说明', ...patch });
const stateWith = (node) => ({ ...createEmptyWorkspaceState(), milestones: [node] });

test('考试与测验自动成为考试项目，报告提交和标题相似的普通事项不归入', () => {
  const exams = [event(), event({ id: 'quiz', assessmentType: 'quiz', area: '课外' }), event({ id: 'unknown-date', date: '', time: '' })];
  const other = ['presentation', 'submission', undefined].map((assessmentType) => event({ assessmentType }));
  other.push(event({ courseId: 'course-task' }));
  assert.deepEqual([...exams, ...other].filter(isExamReviewEvent), exams);
  assert.equal(exams[0].examReview, undefined);
});

test('新增复习任务只更新原考试的复习信息，不修改考试日期、完成状态或附件', () => {
  const original = event({ attachments: [{ id: 'attachment', fileName: '范围.pdf' }], blocks: [{ id: 'note', type: 'text', text: '原笔记' }] });
  const before = JSON.stringify(original);
  const step = createReviewPoolStep([], ' 复习第一章 ', 'step-1');
  const updated = updateExamReview(original, { note: '重点是税率', steps: [step] }, today);
  assert.deepEqual(updated, { ...original, examReview: { note: '重点是税率', steps: [{ id: 'step-1', title: '复习第一章', done: false }] } });
  assert.equal(updated.attachments, original.attachments);
  assert.equal(updated.blocks, original.blocks);
  assert.equal(JSON.stringify(original), before);
});

test('考试名称日期调整及考核类型改变保留同一个项目的复习历史', () => {
  const original = updateExamReview(event(), { note: '已有准备', steps: [{ id: 'one', title: '复习', done: true, completedDate: today }] }, today);
  const edited = { ...original, title: '税务期中测验', date: '2026-11-20', assessmentType: 'quiz' };
  assert.equal(edited.id, original.id);
  assert.equal(edited.examReview, original.examReview);
  assert.equal(isExamReviewEvent(edited), true);
  const converted = { ...edited, assessmentType: 'submission' };
  const saved = workspaceStateSchema.parse(JSON.parse(JSON.stringify(stateWith(converted))));
  assert.equal(isExamReviewEvent(saved.milestones[0]), false);
  assert.deepEqual(saved.milestones[0].examReview, original.examReview);
});

test('选择今天、取消、完成与重开各自保留必要历史，复习全完成不完成考试', () => {
  let current = updateExamReview(event(), { steps: [{ id: 'one', title: '练习', done: false, selectedDate: today }] }, today);
  assert.deepEqual(examReviewTodayCounts([current], today), { total: 1, completed: 0 });
  assert.deepEqual(examReviewTodayCounts([current], tomorrow), { total: 0, completed: 0 });
  current = updateExamReview(current, { steps: current.examReview.steps.map((step) => ({ ...step, done: true })) }, today);
  assert.equal(current.examReview.steps[0].completedDate, today);
  assert.equal(current.done, false);
  assert.deepEqual(examReviewTodayCounts([current], today), { total: 1, completed: 1 });
  const unchanged = updateExamReview(current, { steps: editReviewPoolStep(current.examReview.steps, 'one', '练习及订正') }, tomorrow);
  assert.equal(unchanged.examReview.steps[0].completedDate, today);
  const cancelled = updateExamReview(current, { steps: current.examReview.steps.map((step) => ({ ...step, selectedDate: undefined })) }, today);
  assert.deepEqual(examReviewTodayCounts([cancelled], today), { total: 0, completed: 0 });
  assert.deepEqual(examReviewSummary(cancelled, today), { total: 1, completed: 1, todayTotal: 1, todayCompleted: 1 });
  const reopened = updateExamReview(current, { steps: current.examReview.steps.map((step) => ({ ...step, done: false })) }, tomorrow);
  assert.equal(reopened.examReview.steps[0].completedDate, undefined);
  assert.equal(reopened.examReview.steps[0].selectedDate, today);
  assert.deepEqual(examReviewTodayCounts([reopened], tomorrow), { total: 0, completed: 0 });
});

test('今日任务统计仅取今天明确选择，摘要额外包含直接今天完成并排除历史完成', () => {
  const item = event({ examReview: { note: '', steps: [
    { id: 'planned', title: '今天做', done: false, selectedDate: today },
    { id: 'completed', title: '今天完成', done: true, selectedDate: today, completedDate: today },
    { id: 'direct', title: '直接完成', done: true, completedDate: today },
    { id: 'old', title: '昨日完成', done: true, selectedDate: today, completedDate: '2026-11-02' },
    { id: 'unknown', title: '旧完成日期未知', done: true, selectedDate: today },
    { id: 'future', title: '明天', done: false, selectedDate: tomorrow },
  ] } });
  assert.deepEqual(examReviewSummary(item, today), { total: 6, completed: 4, todayTotal: 3, todayCompleted: 2 });
  assert.deepEqual(examReviewTodayCounts([item], today), { total: 2, completed: 1 });
  assert.deepEqual(examReviewTodayCounts([item], tomorrow), { total: 1, completed: 0 });
  assert.deepEqual(examReviewTodayCounts([{ ...item, done: true }, { ...item, assessmentType: 'presentation' }], today), { total: 0, completed: 0 });
});

test('旧事项无须迁移，旧复习完成日期未知时不补造今天', () => {
  const old = event();
  assert.deepEqual(examReviewSummary(old, today), { total: 0, completed: 0, todayTotal: 0, todayCompleted: 0 });
  assert.deepEqual(workspaceStateSchema.parse(stateWith(old)).milestones[0], old);
  const legacy = event({ examReview: { note: '', steps: [{ id: 'old', title: '已复习', done: true }] } });
  const changed = updateExamReview(legacy, { steps: editReviewPoolStep(legacy.examReview.steps, 'old', '已复习并订正') }, today);
  assert.equal(changed.examReview.steps[0].completedDate, undefined);
  assert.deepEqual(examReviewSummary(changed, today), { total: 1, completed: 1, todayTotal: 0, todayCompleted: 0 });
});

test('删除后撤销保留旧已完成任务的未知日期，新插入已完成任务也不补造完成历史', () => {
  const oldStep = { id: 'old', title: '已复习', done: true, selectedDate: today };
  const original = event({ examReview: { note: '保留历史', steps: [oldStep] } });
  const removed = updateExamReview(original, { steps: [] }, today);
  const restored = updateExamReview(removed, { steps: [oldStep] }, today);
  assert.deepEqual(restored, original);
  assert.deepEqual(examReviewTodayCounts([restored], today), { total: 0, completed: 0 });
  assert.deepEqual(examReviewSummary(restored, today), { total: 1, completed: 1, todayTotal: 0, todayCompleted: 0 });
  const inserted = updateExamReview(event(), { steps: [oldStep] }, today);
  assert.equal(inserted.examReview.steps[0].completedDate, undefined);
  const reopened = updateExamReview(inserted, { steps: [{ ...oldStep, done: false }] }, today);
  const completed = updateExamReview(reopened, { steps: [{ ...oldStep, done: true }] }, tomorrow);
  assert.equal(completed.examReview.steps[0].completedDate, tomorrow);
});

test('严格保存合同拒绝重复任务ID、错误日期、完成矛盾、未知字段与超额内容', () => {
  const step = { id: 'one', title: '练习', done: false };
  const invalid = [
    { note: '', steps: [step, step] },
    { note: '', steps: [{ ...step, selectedDate: '2026-02-30' }] },
    { note: '', steps: [{ ...step, completedDate: today }] },
    { note: '', steps: [{ ...step, done: true, completedDate: 'bad' }] },
    { note: '', steps: [{ ...step, extra: 'unknown' }] },
    { note: '', steps: [{ ...step, title: '   ' }] },
    { note: '字'.repeat(4001), steps: [] },
    { note: '', steps: Array.from({ length: 51 }, (_, index) => ({ ...step, id: String(index) })) },
  ];
  for (const examReview of invalid) assert.equal(workspaceStateSchema.safeParse(stateWith(event({ examReview }))).success, false);
  for (const patch of [{ steps: [step, step] }, { note: '字'.repeat(4001) }, { steps: [{ ...step, selectedDate: 'bad' }] }]) assert.throws(() => updateExamReview(event(), patch, today));
  assert.throws(() => updateExamReview(event({ assessmentType: 'presentation' }), { note: '' }, today));
  assert.throws(() => updateExamReview(event(), { note: '' }, 'bad'));
});

test('保存导出往返和AI读取投影保留考试及复习数据，不转入课程池或隐藏事项', () => {
  const original = updateExamReview(event({ linkedCourseId: 'course' }), { note: '考试复习范围', steps: [{ id: 'one', title: '做题', done: false, selectedDate: today }] }, today);
  const state = { ...stateWith(original), reviewPool: { version: 1, items: [] }, courses: [{ id: 'course', title: '税收理论与实务', term: '2026秋', teacher: '', location: '', progress: 0, requirements: '', schedule: [], blocks: [] }] };
  const decoded = workspaceStateSchema.parse(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(decoded, state);
  assert.deepEqual(reviewPoolReadProjection(decoded).milestones, [original]);
  assert.deepEqual(withoutReviewPoolSources(decoded).milestones, [original]);
  const context = aiCourseContextFromWorkspace(decoded, 'course');
  assert.equal(context.upcomingMilestones.length, 1);
  assert.equal(context.upcomingMilestones[0].kind, 'event');
  assert.equal(context.upcomingMilestones[0].title, original.title);
  assert.equal(decoded.tasks.length, 0);
  assert.equal(decoded.reviewPool.items.length, 0);
});

test('移出考试复习池仅改变入池标记，今日计数排除而原事项和日期完整保留', () => {
  const original = event({ title: '体测 1800 米', date: '2026-11-10', examReview: { note: '保留复习笔记', steps: [
    { id: 'selected', title: '已选今天', done: false, selectedDate: today },
    { id: 'completed', title: '已完成', done: true, selectedDate: today, completedDate: today },
  ] }, blocks: [{ id: 'note', type: 'text', text: '原说明' }], attachments: [] });
  const before = JSON.stringify(original);
  assert.deepEqual(examReviewTodayCounts([original], today), { total: 2, completed: 1 });
  const excluded = setExamReviewExcluded(original, true);
  assert.equal(isExamReviewCandidate(excluded), true);
  assert.equal(isExamReviewEvent(excluded), false);
  assert.deepEqual(excluded, { ...original, examReview: { ...original.examReview, excluded: true } });
  assert.equal(excluded.examReview.steps, original.examReview.steps);
  assert.equal(excluded.blocks, original.blocks);
  assert.equal(excluded.attachments, original.attachments);
  assert.deepEqual(examReviewTodayCounts([excluded], today), { total: 0, completed: 0 });
  assert.equal(manualCalendarItems({ tasks: [], milestones: [excluded] })[0].item, excluded);
  assert.deepEqual(upcomingDeadlines([], [excluded], today), upcomingDeadlines([], [original], today));
  assert.equal(upcomingDeadlines([], [excluded], today).length, 1);
  assert.equal(JSON.stringify(original), before);
});

test('恢复考试保留选中日、旧完成日期与笔记，移出后修改原事项也不回滚', () => {
  const original = event({ examReview: { note: '原备注', steps: [
    { id: 'one', title: '旧复习', done: true, selectedDate: '2026-11-01', completedDate: '2026-11-01' },
    { id: 'two', title: '今日复习', done: false, selectedDate: today },
    { id: 'unknown', title: '未知完成日期', done: true },
  ] } });
  const excluded = setExamReviewExcluded(original, true);
  assert.equal(setExamReviewExcluded(excluded, true), excluded);
  const restored = setExamReviewExcluded(excluded, false);
  assert.deepEqual(restored, original);
  assert.equal(Object.hasOwn(restored.examReview, 'excluded'), false);
  assert.deepEqual(examReviewTodayCounts([restored], today), { total: 1, completed: 0 });
  const changed = { ...excluded, title: '改名后的测验', date: '2026-11-20', assessmentType: 'quiz', done: true };
  assert.deepEqual(setExamReviewExcluded(changed, false), { ...original, title: changed.title, date: changed.date, assessmentType: 'quiz', done: true });
  assert.equal(setExamReviewExcluded(restored, false), restored);
});

test('旧考试默认入池，未有复习数据也可移出恢复，非考试不可设置入池标记', () => {
  const old = event();
  assert.equal(isExamReviewCandidate(old), true);
  assert.equal(isExamReviewEvent(old), true);
  assert.equal(setExamReviewExcluded(old, false), old);
  const excluded = setExamReviewExcluded(old, true);
  assert.deepEqual(excluded.examReview, { note: '', steps: [], excluded: true });
  const restored = setExamReviewExcluded(excluded, false);
  assert.equal(isExamReviewEvent(restored), true);
  assert.deepEqual(restored.examReview, { note: '', steps: [] });
  assert.equal(old.examReview, undefined);
  for (const item of [event({ assessmentType: 'paper' }), event({ assessmentType: 'submission' }), event({ courseId: 'course-task' })]) {
    assert.equal(isExamReviewCandidate(item), false);
    assert.throws(() => setExamReviewExcluded(item, true));
  }
});

test('普通复习编辑保留已有状态且不能修改入池标记，移出后须先恢复再编辑', () => {
  const included = event({ examReview: { note: '原备注', steps: [], excluded: false } });
  const updated = updateExamReview(included, { note: '新备注', excluded: true }, today);
  assert.equal(updated.examReview.excluded, false);
  assert.equal(updated.examReview.note, '新备注');
  const excluded = setExamReviewExcluded(updated, true);
  assert.throws(() => updateExamReview(excluded, { note: '不能更新', excluded: false }, today));
  assert.equal(excluded.examReview.note, '新备注');
});

test('排除状态通过严格保存导出合同并保留AI原事项读取，非法标记被拒绝', () => {
  const node = setExamReviewExcluded(event({ examReview: { note: '完整保留', steps: [{ id: 'old', title: '原任务', done: true }] } }), true);
  const state = { ...stateWith(node), reviewPool: { version: 1, items: [] } };
  const saved = workspaceStateSchema.parse(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(saved, state);
  assert.deepEqual(reviewPoolReadProjection(saved).milestones, [node]);
  assert.deepEqual(withoutReviewPoolSources(saved).milestones, [node]);
  assert.equal(isExamReviewEvent(saved.milestones[0]), false);
  assert.equal(isExamReviewEvent(setExamReviewExcluded(saved.milestones[0], false)), true);
  for (const excluded of ['true', 1, null]) assert.equal(workspaceStateSchema.safeParse(stateWith(event({ examReview: { note: '', steps: [], excluded } }))).success, false);
  assert.equal(workspaceStateSchema.safeParse(stateWith(event({ examReview: { note: '', steps: [], excluded: false } }))).success, true);
});
