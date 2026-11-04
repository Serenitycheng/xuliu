import { isValidLocalDate, localDateKey } from "./finance.ts";

export type HabitStreakLike = { streak: number; today: boolean; lastCompletedDate?: string };

function previousDateKey(currentDate: string) {
  const [year, month, day] = currentDate.split("-").map(Number);
  const previous = new Date(0);
  previous.setUTCFullYear(year, month - 1, day - 1);
  return `${String(previous.getUTCFullYear()).padStart(4, "0")}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`;
}

/** A stored date proves completion; an old today flag cannot establish a missing date. */
export function normalizedHabit<T extends HabitStreakLike>(habit: T, currentDate = localDateKey()): T {
  if (!isValidLocalDate(currentDate)) throw new Error("请选择有效的打卡日期");
  const lastDate = habit.lastCompletedDate && isValidLocalDate(habit.lastCompletedDate) ? habit.lastCompletedDate : undefined;
  const today = lastDate === currentDate;
  const streak = lastDate && lastDate < previousDateKey(currentDate) ? 0 : habit.streak;
  return habit.today === today && habit.streak === streak ? habit : { ...habit, today, streak };
}

export function setHabitCompletedForDate<T extends HabitStreakLike>(habit: T, completed: boolean, currentDate = localDateKey()): T {
  const current = normalizedHabit(habit, currentDate);
  if (current.today === completed) return current;
  const previousDate = previousDateKey(currentDate);
  if (completed) {
    const streak = current.lastCompletedDate === previousDate ? current.streak + 1 : 1;
    return { ...current, today: true, streak, lastCompletedDate: currentDate };
  }
  const streak = Math.max(0, current.streak - 1);
  if (streak > 0) return { ...current, today: false, streak, lastCompletedDate: previousDate };
  const { lastCompletedDate: _lastCompletedDate, ...rest } = current;
  return { ...rest, today: false, streak } as T;
}

export function toggledHabit<T extends HabitStreakLike>(habit: T, currentDate = localDateKey()): T {
  const current = normalizedHabit(habit, currentDate);
  return setHabitCompletedForDate(current, !current.today, currentDate);
}
