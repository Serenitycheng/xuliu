import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceWorkForDate, cancelWorkForDate, courseNodeVisibleToday, defaultTaskPlannedDate, isPreparationEventTask, newTaskPlannedDate, planTaskForDate, taskAwaitingStart, taskModeOf, taskOverlapsRange, taskScheduledForDate, taskVisibleToday } from '../lib/task-progress.ts';
import { assessmentTypeLabel } from '../lib/course-events.ts';
import { createEmptyWorkspaceState, workspaceStateSchema } from '../lib/workspace-state-schema.ts';
import { withPlannedTaskStages } from '../lib/task-stages.ts';

const today = '2026-11-03';
const report = (patch = {}) => ({ id: 'report', title: '气候与社会 pre', area: '课内', alsoTask: true, assessmentType: 'presentation', date: '2026-11-19', time: '', done: false, location: '', requirements: '保留报告要求', ...patch });

test('报告和明确论文事项默认长期，普通作业及相似单词不误归类，显式选择优先', () => {
  for (const task of [report(), report({ assessmentType: 'paper' }), ...['经济学论文', 'Economics Essay 提交', 'Term PAPER', 'thesis', 'Dissertation'].map((title) => report({ assessmentType: 'submission', title }))]) {
    assert.equal(isPreparationEventTask(task), true);
    assert.equal(taskModeOf(task), 'multi');
    assert.equal(taskModeOf({ ...task, mode: 'single' }), 'single');
  }
  for (const task of [report({ alsoTask: false }), report({ courseId: 'course' }), report({ automationKey: 'study:one' }), ...['每周数学作业', 'newspaper reading', 'paperwork', '试卷整理'].map((title) => report({ assessmentType: 'submission', title }))]) {
    assert.equal(isPreparationEventTask(task), false);
    assert.equal(taskModeOf(task), 'single');
  }
  assert.equal(taskModeOf({ mode: 'multi' }), 'multi');
  assert.equal(assessmentTypeLabel('paper'), '论文提交');
});

test('默认推进提前七天支持跨年闰日，旧显式计划不迁移，手动短期仍提前两天', () => {
  assert.equal(defaultTaskPlannedDate(report()), '2026-11-12');
  assert.equal(defaultTaskPlannedDate(report({ date: '2027-01-03' })), '2026-12-27');
  assert.equal(defaultTaskPlannedDate(report({ date: '2028-03-01' })), '2028-02-23');
  assert.equal(defaultTaskPlannedDate(report({ plannedDate: '2026-11-17' })), '2026-11-17');
  assert.equal(defaultTaskPlannedDate(report({ mode: 'single' })), '2026-11-17');
  assert.equal(defaultTaskPlannedDate(report({ assessmentType: 'submission', title: '普通作业' })), '2026-11-17');
  assert.equal(defaultTaskPlannedDate(report({ date: '' })), undefined);
  assert.equal(defaultTaskPlannedDate(report({ date: '2026-02-30' })), undefined);
  assert.equal(newTaskPlannedDate(report({ date: '2026-11-05' }), today), today);
  assert.equal(newTaskPlannedDate(report({ date: '2026-11-05', plannedDate: '2026-10-30' }), today), '2026-10-30');
});

test('待推进只收尚未开始的未来事项任务，日期待定报告保留，其他任务不受影响', () => {
  const original = report();
  const before = JSON.stringify(original);
  assert.equal(taskAwaitingStart(original, today), true);
  assert.equal(taskAwaitingStart(report({ date: '', time: '' }), today), true);
  assert.equal(taskAwaitingStart(report({ assessmentType: 'submission', title: '作业', plannedDate: '2026-11-10' }), today), true);
  for (const task of [report({ alsoTask: false }), report({ courseId: 'course' }), report({ automationKey: 'study:one' }), report({ done: true }), report({ plannedDate: today }), report({ progressedDates: ['2026-11-02'], plannedDate: '2026-11-10' }), report({ status: '进行中' }), report({ status: '已暂停', progress: 25 }), report({ today: true }), report({ date: '', assessmentType: 'submission', title: '普通作业' })]) {
    assert.equal(taskAwaitingStart(task, today), false, JSON.stringify(task));
  }
  assert.equal(taskAwaitingStart(report({ plannedDate: '2026-11-22' }), '2026-11-19'), false);
  assert.equal(taskAwaitingStart(report({ plannedDate: '2026-11-22' }), '2026-11-20'), false);
  assert.equal(JSON.stringify(original), before);
});

test('报告从计划日开始持续显示，未完成逾期仍可见，取消及完成保持原语义', () => {
  for (const [date, expected] of [['2026-11-11', false], ['2026-11-12', true], ['2026-11-13', true], ['2026-11-19', true], ['2026-11-20', true]]) {
    assert.equal(courseNodeVisibleToday(report(), date), expected, date);
    assert.equal(taskVisibleToday(report(), date), expected, date);
    assert.equal(taskScheduledForDate(report(), date), expected, date);
  }
  assert.equal(courseNodeVisibleToday(cancelWorkForDate(report(), '2026-11-12'), '2026-11-12'), false);
  assert.equal(courseNodeVisibleToday(cancelWorkForDate(report(), '2026-11-12'), '2026-11-13'), true);
  assert.equal(courseNodeVisibleToday(report({ done: true, completedDate: '2026-11-12' }), '2026-11-12'), true);
  assert.equal(courseNodeVisibleToday(report({ done: true, completedDate: '2026-11-12' }), '2026-11-19'), false);
  assert.equal(courseNodeVisibleToday(report({ date: '' }), today), false);
});

test('手动提前今天立即开始，既有计划保持，未来计划不能隐藏已到期事项', () => {
  const early = planTaskForDate(report(), today);
  assert.equal(early.date, '2026-11-19');
  assert.equal(taskAwaitingStart(early, today), false);
  assert.equal(courseNodeVisibleToday(early, today), true);
  assert.equal(courseNodeVisibleToday(early, '2026-11-04'), true);
  const existing = report({ plannedDate: '2026-11-17' });
  assert.equal(courseNodeVisibleToday(existing, '2026-11-12'), false);
  assert.equal(courseNodeVisibleToday(existing, '2026-11-17'), true);
  assert.equal(courseNodeVisibleToday(report({ plannedDate: '2026-11-22' }), '2026-11-19'), true);
  assert.equal(courseNodeVisibleToday(planTaskForDate(report({ date: '' }), today), today), true);
});

test('今天推进后继续日期保留，间隔日不显示，项目不重新回到待推进', () => {
  const continued = advanceWorkForDate(report(), today, '2026-11-06');
  assert.deepEqual(continued.progressedDates, [today]);
  assert.equal(taskAwaitingStart(continued, today), false);
  assert.equal(taskAwaitingStart(continued, '2026-11-04'), false);
  assert.equal(courseNodeVisibleToday(continued, today), true);
  assert.equal(courseNodeVisibleToday(continued, '2026-11-04'), false);
  assert.equal(courseNodeVisibleToday(continued, '2026-11-06'), true);
  assert.equal(courseNodeVisibleToday(continued, '2026-11-07'), true);
  assert.equal(taskOverlapsRange(continued, '2026-11-04', '2026-11-05'), false);
  assert.equal(taskOverlapsRange(continued, '2026-11-04', '2026-11-07'), true);
});

test('本周范围采用完整事项的连续推进区间，普通事项任务也保留实际截止日期', () => {
  assert.equal(taskOverlapsRange(report(), '2026-11-03', '2026-11-10'), false);
  assert.equal(taskOverlapsRange(report(), '2026-11-10', '2026-11-13'), true);
  assert.equal(taskOverlapsRange(report(), '2026-11-13', '2026-11-15'), true);
  assert.equal(taskOverlapsRange(report(), '2026-11-20', '2026-11-22'), true);
  assert.equal(taskOverlapsRange(report({ date: '' }), '2026-11-03', '2026-11-10'), false);
  const done = report({ done: true, completedDate: '2026-11-12' });
  assert.equal(taskOverlapsRange(done, '2026-11-12', '2026-11-12'), true);
  assert.equal(taskOverlapsRange(done, '2026-11-13', '2026-11-19'), false);
  assert.equal(taskOverlapsRange(report({ assessmentType: 'submission', title: '数学作业' }), '2026-11-19', '2026-11-19'), true);
});

test('论文保存往返保持原事项及复习历史，长期推导不自动创建阶段或迁移旧字段', () => {
  const node = report({ assessmentType: 'paper', title: '课程论文', plannedDate: today, examReview: { note: '保留原考试转论文后的复习历史', steps: [] }, blocks: [{ id: 'note', type: 'text', text: '原笔记' }] });
  const state = { ...createEmptyWorkspaceState(), milestones: [node] };
  const snapshot = JSON.stringify(state);
  const staged = withPlannedTaskStages(state, today, () => 'unexpected');
  assert.equal(staged.tasks.length, 0);
  assert.deepEqual(workspaceStateSchema.parse(JSON.parse(snapshot)).milestones[0], node);
  assert.equal(taskModeOf(node), 'multi');
  assert.equal(node.mode, undefined);
  assert.equal(JSON.stringify(state), snapshot);
});
