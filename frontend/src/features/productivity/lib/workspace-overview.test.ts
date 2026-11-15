import { describe, expect, it } from "vitest";
import type { Activity, Area, Project, ProjectTask } from "@/types/entities";
import {
  areaSummaries,
  projectHealth,
  runningProjectHealth,
  upcomingWork,
  weeklyCompletions,
} from "./workspace-overview";

const today = new Date(2026, 10, 15); // Minggu, 15 Nov 2026
const task = (id: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id,
  projectId: "p1",
  title: id,
  ...extra,
});

describe("projectHealth", () => {
  it("late when deadline passed and not done", () => {
    const p: Project = { id: "p1", title: "A", startDate: "2026-10-01", deadline: "2026-11-10" };
    expect(projectHealth(p, [task("t1")], today).state).toBe("late");
  });
  it("risk when time runs ahead of progress", () => {
    const p: Project = { id: "p1", title: "A", startDate: "2026-11-01", deadline: "2026-11-17" };
    expect(projectHealth(p, [task("t1"), task("t2", { completed: true })], today).state).toBe("risk");
  });
  it("on-track and no-date", () => {
    const p: Project = { id: "p1", title: "A", startDate: "2026-11-14", deadline: "2026-12-31" };
    expect(projectHealth(p, [task("t1", { completed: true })], today).state).toBe("on-track");
    expect(projectHealth({ id: "p1", title: "B" }, [], today).state).toBe("no-date");
  });
  it("running list skips stopped projects and sorts late first", () => {
    const list = runningProjectHealth(
      [
        { id: "a", title: "OK", startDate: "2026-11-14", deadline: "2026-12-31" },
        { id: "b", title: "Done", status: "completed", deadline: "2026-11-01" },
        { id: "c", title: "Late", startDate: "2026-10-01", deadline: "2026-11-01" },
      ],
      [],
      today,
    );
    expect(list.map((h) => h.project.id)).toEqual(["c", "a"]);
  });
});

describe("upcomingWork", () => {
  it("splits overdue and next 7 days, ignores done", () => {
    const { overdue, upcoming } = upcomingWork(
      [
        task("old", { dueDate: "2026-11-10" }),
        task("done", { dueDate: "2026-11-11", completed: true }),
        task("today", { dueDate: "2026-11-15" }),
        task("week", { dueDate: "2026-11-22" }),
        task("later", { dueDate: "2026-11-23" }),
        task("nodate"),
      ],
      today,
    );
    expect(overdue.map((t) => t.id)).toEqual(["old"]);
    expect(upcoming.map((t) => t.id)).toEqual(["today", "week"]);
  });
});

describe("weeklyCompletions", () => {
  it("counts per Monday week", () => {
    const weeks = weeklyCompletions(
      [
        task("a", { completed: true, completedAt: new Date(2026, 10, 9, 10).toISOString() }),
        task("b", { completed: true, completedAt: new Date(2026, 10, 15, 22).toISOString() }),
        task("c", { completed: true, dueDate: "2026-11-03" }),
        task("d", { completed: false, dueDate: "2026-11-12" }),
        task("e", { completed: true, dueDate: "2025-01-01" }),
      ],
      today,
      3,
    );
    expect(weeks).toEqual([
      { start: "2026-10-26", count: 0 },
      { start: "2026-11-02", count: 1 },
      { start: "2026-11-09", count: 2 },
    ]);
  });
});

describe("areaSummaries", () => {
  it("counts projects, items and tasks of the area", () => {
    const areas: Area[] = [{ id: "ar", title: "Area" } as Area, { id: "empty", title: "Kosong" } as Area];
    const projects: Project[] = [
      { id: "p1", title: "P", areaId: "ar" },
      { id: "p2", title: "Stop", areaId: "ar", status: "completed" },
    ];
    const activities = [{ id: "k1", title: "K", areaId: "ar" }] as Activity[];
    const tasks = [task("t1"), task("t2", { projectId: "k1", completed: true }), task("t3", { projectId: "p2" })];
    const [first, second] = areaSummaries(areas, projects, activities, tasks);
    expect(first).toMatchObject({ projects: 1, items: 1, openTasks: 1, totalTasks: 2, progress: 50 });
    expect(second.area.id).toBe("empty");
  });
});
