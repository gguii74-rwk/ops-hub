import type { CalendarSourceProvider } from "./types";
import { internalLeaveProvider } from "./sources/internalLeave";
import { workflowTaskProvider } from "./sources/workflowTask";
import { manualProvider } from "./sources/manual";
import { createGoogleProvider } from "./sources/google";
import { createHolidayProvider } from "./sources/holiday";

export function createCalendarProviders(opts: { forceRefresh?: boolean } = {}): Record<string, CalendarSourceProvider> {
  return {
    internalLeave: internalLeaveProvider,
    workflowTask: workflowTaskProvider,
    manual: manualProvider,
    google: createGoogleProvider({ forceRefresh: opts.forceRefresh }),
    holiday: createHolidayProvider({ forceRefresh: opts.forceRefresh }),
  };
}
