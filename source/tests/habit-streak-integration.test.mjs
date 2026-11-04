import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { createInitialFinanceState, isValidLocalDate, isValidLocalTime, normalizeFinanceState } from '../lib/finance.ts';
import { normalizedHabit, setHabitCompletedForDate, toggledHabit } from '../lib/habit-streak.ts';
import { withWorkCompletionDates } from '../lib/task-progress.ts';
import { withPlannedTaskStages } from '../lib/task-stages.ts';
import { detachRemovedParents } from '../lib/task-time.ts';

const yesterday = '2026-11-03';
const today = '2026-11-04';
const habit = (patch = {}) => ({ id: 'reading', title: '阅读', schedule: '每天', streak: 5, today: true, lastCompletedDate: yesterday, ...patch });

function sourceAt(path, kind = ts.ScriptKind.TS) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

function findNodes(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function only(nodes, label) {
  assert.equal(nodes.length, 1, `应找到唯一的实际 ${label}`);
  return nodes[0];
}

function transpile(code) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

const dashboard = sourceAt('../app/DashboardClient.tsx', ts.ScriptKind.TSX);
const namedVariable = (name) => only(findNodes(dashboard, (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name), name);
const setDataNode = namedVariable('setData').initializer.arguments[0];
const rollDayNode = namedVariable('rollHabitsToCurrentDay').initializer;
const todayView = only(findNodes(dashboard, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'TodayView'), 'TodayView');
const toggleNode = only(findNodes(todayView, (node) => ts.isJsxAttribute(node) && node.name.text === 'onClick'
  && findNodes(node, (child) => ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'toggledHabit').length > 0), '习惯勾选回调').initializer.expression;
const callback = (node, context) => runInNewContext(transpile(`(${node.getText(dashboard)})`), context, { filename: 'DashboardClient.habit-callback.ts' });

// Execute the application's callbacks, including its full setData pipeline. The
// empty task collections avoid unrelated stage creation without replacing it.
function dashboardHarness(initialHabit, { readOnly = false } = {}) {
  let currentDate = yesterday;
  let state = { tasks: [], milestones: [], habits: [structuredClone(initialHabit)], note: '保留其它内容' };
  const notices = [];
  const context = {
    readOnly,
    preview: true,
    dirtyRef: { current: false },
    editVersionRef: { current: 0 },
    habitDayRef: { current: yesterday },
    habit: { id: initialHabit.id },
    dateKey: () => currentDate,
    uid: randomUUID,
    normalizedHabit: (value, date = currentDate) => normalizedHabit(value, date),
    toggledHabit: (value, date = currentDate) => toggledHabit(value, date),
    withWorkCompletionDates,
    withPlannedTaskStages,
    detachRemovedParents,
    setPopup: (value) => notices.push(value),
    setSync: () => {},
    setStoredData: (action) => { state = typeof action === 'function' ? action(state) : action; },
  };
  context.setData = callback(setDataNode, context);
  const rollDay = callback(rollDayNode, context);
  const toggle = callback(toggleNode, context);
  return {
    get state() { return structuredClone(state); },
    get notices() { return notices; },
    onDate(date) { currentDate = date; rollDay(); },
    toggle,
    update: context.setData,
  };
}

test('Dashboard 实际跨日回调经过 setData 保留昨日记录，今日点击由连续 5 天变 6 天', () => {
  const app = dashboardHarness(habit());
  app.onDate(today);
  assert.deepEqual(app.state.habits[0], habit({ today: false }));
  app.onDate(today);
  app.update((current) => ({ ...current, note: '修改其它内容' }));
  assert.deepEqual(app.state.habits[0], habit({ today: false }));
  app.toggle();
  assert.deepEqual(app.state.habits[0], habit({ streak: 6, lastCompletedDate: today }));
  assert.equal(app.state.note, '修改其它内容');
});

test('Dashboard 实际勾选和取消回调反复执行只在 5 与 6 之间切换', () => {
  const app = dashboardHarness(habit());
  app.onDate(today);
  for (let repetition = 0; repetition < 3; repetition += 1) {
    app.toggle();
    assert.deepEqual(app.state.habits[0], habit({ streak: 6, lastCompletedDate: today }));
    app.toggle();
    assert.deepEqual(app.state.habits[0], habit({ today: false }));
  }
});

test('Dashboard 间断一天后归零，重新打卡从 1 开始并可正常取消', () => {
  const app = dashboardHarness(habit());
  app.onDate('2026-11-05');
  assert.deepEqual(app.state.habits[0], habit({ today: false, streak: 0 }));
  app.toggle();
  assert.deepEqual(app.state.habits[0], habit({ streak: 1, lastCompletedDate: '2026-11-05' }));
  app.toggle();
  assert.equal(app.state.habits[0].streak, 0);
  assert.equal(app.state.habits[0].today, false);
  assert.equal(app.state.habits[0].lastCompletedDate, undefined);
  app.toggle();
  assert.equal(app.state.habits[0].streak, 1);
});

test('Dashboard 只读 setData 拒绝打卡和其它更新', () => {
  const original = habit();
  const app = dashboardHarness(original, { readOnly: true });
  app.toggle();
  app.update((current) => ({ ...current, habits: [] }));
  assert.deepEqual(app.state.habits, [original]);
  assert.equal(app.notices.length, 2);
});

const aiReducer = sourceAt('../lib/ai-action-reducer.ts');
// Omit module imports (including server-only), then execute the actual reducer
// functions and validation with their real dependencies in an isolated context.
const aiCode = transpile(aiReducer.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(aiReducer)).join('\n'));

function aiHarness(initialHabits = []) {
  let currentDate = today;
  const state = { habits: structuredClone(initialHabits) };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [`${currentDate}T04:00:00.000Z`])); }
    static now() { return new Date(`${currentDate}T04:00:00.000Z`).getTime(); }
  }
  const context = {
    exports: {}, z, Date: ClockDate, crypto: { randomUUID },
    createInitialFinanceState, isValidLocalDate, isValidLocalTime, normalizeFinanceState,
    normalizedHabit, setHabitCompletedForDate,
  };
  const { createEntity, updateEntity } = runInNewContext(`${aiCode}\n;({ createEntity, updateEntity });`, context, { filename: 'ai-action-reducer.habit.ts' });
  return {
    get habits() { return structuredClone(state.habits); },
    onDate(date) { currentDate = date; },
    create(values) { return createEntity(state, 'habit', undefined, values); },
    update(id, values) { updateEntity(state, 'habit', id, undefined, values); },
  };
}

test('AI 实际更新在昨日 today 标记尚未刷新时仍正常累计，同日重复完成幂等', () => {
  const ai = aiHarness([habit()]);
  ai.update('reading', { today: true });
  assert.deepEqual(ai.habits[0], habit({ streak: 6, lastCompletedDate: today }));
  ai.update('reading', { today: true });
  assert.equal(ai.habits[0].streak, 6);
  ai.update('reading', { today: false });
  assert.deepEqual(ai.habits[0], habit({ today: false }));
  ai.update('reading', { today: false });
  assert.deepEqual(ai.habits[0], habit({ today: false }));
  ai.update('reading', { today: true });
  assert.equal(ai.habits[0].streak, 6);
});

test('AI 实际创建、编辑名称与断日打卡共用日期规则，仍经过原字段校验', () => {
  const ai = aiHarness([habit()]);
  ai.update('reading', { title: '每日阅读' });
  assert.deepEqual(ai.habits[0], habit({ title: '每日阅读', today: false }));
  ai.update('reading', { today: false });
  assert.equal(ai.habits[0].streak, 5);
  ai.onDate('2026-11-05');
  ai.update('reading', { today: true });
  assert.deepEqual(ai.habits[0], habit({ title: '每日阅读', streak: 1, lastCompletedDate: '2026-11-05' }));
  ai.update('reading', { today: false });
  assert.equal(ai.habits[0].lastCompletedDate, undefined);
  assert.equal(ai.habits[0].streak, 0);
  const createdId = ai.create({ title: '新习惯', today: true });
  const created = ai.habits.find((item) => item.id === createdId);
  assert.deepEqual(created, { id: createdId, title: '新习惯', schedule: '每天', streak: 1, today: true, lastCompletedDate: '2026-11-05' });
  ai.update(createdId, { today: true });
  assert.equal(ai.habits.find((item) => item.id === createdId).streak, 1);
  assert.throws(() => ai.update(createdId, { today: 'true' }));
  assert.throws(() => ai.update(createdId, { streak: 999 }));
});
