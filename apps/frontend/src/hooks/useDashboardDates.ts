import { subDays } from 'date-fns';

export function getDashboardDates() {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDate = subDays(today, 6).toISOString().slice(0, 10);
  const prevEndDate = subDays(today, 7).toISOString().slice(0, 10);
  const prevStartDate = subDays(today, 13).toISOString().slice(0, 10);

  return { startDate, endDate, prevStartDate, prevEndDate };
}
