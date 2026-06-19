import type { CalendarSourceProvider, NormalizedRange, RawEvent, SourceResult } from "../types";
import { findWorkflowTasksInRange, type WorkflowRow } from "../repositories";
import { allDayHalfOpen } from "../time";

const KEY = "workflowTask";

function toRawEvent(w: WorkflowRow): RawEvent {
  const { start, end } = allDayHalfOpen(w.scheduledAt, w.scheduledAt);
  return {
    id: `workflow:${w.id}`,
    kind: "WORKFLOW_TASK",
    title: w.title,
    description: null,
    start,
    end,
    allDay: true,
    userId: null,
    sourceKey: KEY,
    externalId: null,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
    tentative: false,
  };
}

export const workflowTaskProvider: CalendarSourceProvider = {
  key: KEY,
  async fetchEvents(range: NormalizedRange): Promise<SourceResult> {
    try {
      const rows = await findWorkflowTasksInRange(range);
      return { events: rows.map(toRawEvent), statuses: [{ key: KEY, state: "ok", lastFetchedAt: null, error: null }] };
    } catch (e) {
      return { events: [], statuses: [{ key: KEY, state: "failed", lastFetchedAt: null, error: e instanceof Error ? e.message : String(e) }] };
    }
  },
};
