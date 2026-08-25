import { parseTask } from "@technoqueue/core";
import { all, one } from "@/lib/db";

export type PublicStats = {
  offices: number;
  workers: number;
  tasks: number;
  completed: number;
};

type CountRow = { count: number };
type TaskRow = { raw_value: string };

export function getPublicStats(): PublicStats {
  const offices = one<CountRow>("SELECT COUNT(*) AS count FROM workspaces")?.count ?? 0;
  const workers = one<CountRow>("SELECT COUNT(*) AS count FROM hosted_agents WHERE archived_at IS NULL")?.count ?? 0;
  const taskRows = all<TaskRow>("SELECT raw_value FROM trusted_technocore_records WHERE kind = 'task'");
  let completed = 0;

  for (const row of taskRows) {
    try {
      if (parseTask(row.raw_value).status === "done") completed += 1;
    } catch {
      // Ignore malformed or legacy records in the public aggregate.
    }
  }

  return { offices, workers, tasks: taskRows.length, completed };
}
