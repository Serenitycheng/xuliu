import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedHabit, setHabitCompletedForDate, toggledHabit } from '../lib/habit-streak.ts';
import { createEmptyWorkspaceState, workspaceStateSchema } from '../lib/workspace-state-schema.ts';

const today = '2026-11-04';
const yesterday = '2026-11-03';
const habit = (patch = {}) => ({ id: 'reading', title: '阅读', streak: 5, today: true, schedule: '每天', lastCompletedDate: yesterday, ...patch });

test('跨午夜归一化保留昨日连续记录，反复归一化后次日打卡仍累加', () => {
  const original = habit();
  const normalized = normalizedHabit(original, today);
  assert.deepEqual(normalized, { ...original, today: false });
  assert.equal(normalizedHabit(normalized, today), normalized);
  const checked = toggledHabit(normalized, today);
  assert.deepEqual(checked, { ...original, today: true, streak: 6, lastCompletedDate: today });
  const tomorrow = normalizedHabit(checked, '2026-11-05');
  assert.deepEqual(tomorrow, { ...checked, today: false });
  assert.equal(setHabitCompletedForDate(tomorrow, true, '2026-11-05').streak, 7);
});

test('漏掉完整一天后连续数归零，旧最后打卡日保留，再打卡从一天开始', () => {
  const missed = normalizedHabit(habit(), '2026-11-05');
  assert.deepEqual(missed, { ...habit(), today: false, streak: 0 });
  const later = normalizedHabit(missed, '2026-11-08');
  assert.equal(later.lastCompletedDate, yesterday);
  assert.equal(later.streak, 0);
  assert.equal(setHabitCompletedForDate(later, false, '2026-11-08'), later);
  assert.deepEqual(toggledHabit(later, '2026-11-08'), { ...habit(), today: true, streak: 1, lastCompletedDate: '2026-11-08' });
});

test('显式打卡和取消幂等，不把旧today标记误认成今天或取消昨天记录', () => {
  const stale = habit();
  const cancelled = setHabitCompletedForDate(stale, false, today);
  assert.deepEqual(cancelled, { ...stale, today: false });
  assert.equal(setHabitCompletedForDate(cancelled, false, today), cancelled);
  const checked = setHabitCompletedForDate(stale, true, today);
  assert.equal(checked.streak, 6);
  assert.equal(checked.lastCompletedDate, today);
  assert.equal(setHabitCompletedForDate(checked, true, today), checked);
});

test('当天取消退回昨日连续数，反复取消不再扣减，重新打卡恢复原数', () => {
  const checked = habit({ streak: 6, lastCompletedDate: today });
  const cancelled = setHabitCompletedForDate(checked, false, today);
  assert.deepEqual(cancelled, { ...checked, streak: 5, today: false, lastCompletedDate: yesterday });
  assert.equal(setHabitCompletedForDate(cancelled, false, today), cancelled);
  assert.deepEqual(setHabitCompletedForDate(cancelled, true, today), checked);
  assert.deepEqual(toggledHabit(toggledHabit(checked, today), today), checked);
  const firstDay = habit({ streak: 1, lastCompletedDate: today });
  const empty = toggledHabit(firstDay, today);
  assert.equal(empty.streak, 0);
  assert.equal(empty.today, false);
  assert.equal(Object.hasOwn(empty, 'lastCompletedDate'), false);
  assert.equal(setHabitCompletedForDate(empty, false, today), empty);
  assert.equal(toggledHabit(empty, today).streak, 1);
});

test('缺失最后打卡日的旧记录保留原数字但不补造日期，新明确打卡从一天起', () => {
  for (const oldToday of [true, false]) {
    const old = { id: 'old', title: '旧习惯', streak: 12, today: oldToday, schedule: '每天' };
    const normalized = normalizedHabit(old, today);
    assert.deepEqual(normalized, { ...old, today: false });
    assert.equal(Object.hasOwn(normalized, 'lastCompletedDate'), false);
    assert.deepEqual(setHabitCompletedForDate(old, false, today), normalized);
    assert.deepEqual(setHabitCompletedForDate(old, true, today), { ...old, today: true, streak: 1, lastCompletedDate: today });
  }
});

test('有效最后打卡日期优先于旧today布尔值，同日重复打卡不增加数字', () => {
  const dated = habit({ today: false, streak: 6, lastCompletedDate: today });
  assert.deepEqual(normalizedHabit(dated, today), { ...dated, today: true });
  assert.deepEqual(setHabitCompletedForDate(dated, true, today), { ...dated, today: true });
  assert.deepEqual(toggledHabit(dated, today), { ...dated, streak: 5, today: false, lastCompletedDate: yesterday });
});

test('日历日期推进覆盖跨年、闰日、非闰年和换月，不依赖固定小时差', () => {
  for (const [previousDate, currentDate] of [['2026-12-31', '2027-01-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01'], ['2027-02-28', '2027-03-01'], ['2026-11-30', '2026-12-01']]) {
    const original = habit({ lastCompletedDate: previousDate });
    const checked = setHabitCompletedForDate(original, true, currentDate);
    assert.equal(checked.streak, 6, currentDate);
    assert.equal(checked.lastCompletedDate, currentDate);
    assert.deepEqual(setHabitCompletedForDate(checked, false, currentDate), { ...original, today: false });
  }
  assert.equal(normalizedHabit(habit({ lastCompletedDate: '2028-02-28' }), '2028-03-01').streak, 0);
  assert.throws(() => normalizedHabit(habit(), '2027-02-29'));
  assert.throws(() => setHabitCompletedForDate(habit(), true, 'not-a-date'));
});

test('更新不可变且保留名称频率及其余字段，历史与最新状态均能保存导出往返', () => {
  const original = Object.freeze(habit());
  const before = JSON.stringify(original);
  const snapshots = [original, normalizedHabit(original, today), toggledHabit(original, today), normalizedHabit(original, '2026-11-07')];
  for (const snapshot of snapshots) {
    const state = { ...createEmptyWorkspaceState(), habits: [snapshot] };
    assert.deepEqual(workspaceStateSchema.parse(JSON.parse(JSON.stringify(state))).habits[0], snapshot);
  }
  assert.equal(JSON.stringify(original), before);
  const metadata = Object.freeze({ personal: '附加内容' });
  const withMetadata = Object.freeze({ ...original, metadata });
  assert.equal(toggledHabit(withMetadata, today).metadata, metadata);
  assert.deepEqual(toggledHabit({ streak: 0, today: false }, today), { streak: 1, today: true, lastCompletedDate: today });
});
