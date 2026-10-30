"use client";

import { useState } from "react";
import { Board } from "@/components/board/board";
import { Greeting, TodayDate } from "@/components/greeting";
import { Page } from "@/components/shell/page";
import type { Task } from "@/core/tasks";
import { sortTasks } from "@/lib/board";
import type { DashboardLayout, DashboardSort, DashboardView } from "@/lib/dashboard";
import { isProjectArea, type Area, type ProjectArea } from "@/lib/task-fields";
import type { CellProject } from "@/components/tasks/task-list";
import { DashboardControls } from "./controls";
import { LifeToday } from "./life-today";
import { WorkBoard, WorkToday } from "./work-today";

/**
 * The dashboard. Every area's tasks are here at once, so switching between
 * Aya, Work and Life, or Today and Board, changes the screen straight away;
 * the choice is saved behind it.
 */
export function DashboardScreen({
  view,
  area: startArea,
  tasks: allTasks,
  projects: allProjects,
  today,
  side,
}: {
  view: DashboardView;
  area: Area;
  tasks: Task[];
  projects: (CellProject & { area: ProjectArea })[];
  today: string;
  /** The cards beside the Today card (Scratch pad, Agents). */
  side: React.ReactNode;
}) {
  // Kept here rather than read from the page, so a switch shows at once and a
  // refresh that lands later can't flip it back.
  const [area, setArea] = useState(startArea);
  const [layout, setLayout] = useState<DashboardLayout>(view.layout);
  const [sort, setSort] = useState<DashboardSort>(view.sort);
  const board = layout === "board";
  const shown = { ...view, layout, sort };
  const tasks = allTasks.filter((t) => t.area === area);
  const projects = allProjects.filter((p) => p.area === area);
  const todays = tasks.filter((t) => t.bucket === "today");
  const canAdd = view.show.includes("todo");

  const controls = <DashboardControls view={shown} area={area} onArea={setArea} onLayout={setLayout} onSort={setSort} />;

  return (
    <Page
      title="Dashboard"
      eyebrow={<TodayDate />}
      heading={<Greeting />}
      addNew
      fill={board && "phone"}
      // Computers put the switches beside the greeting; phones keep them on their own row below it.
      actions={<div className="hidden md:block">{controls}</div>}
    >
      <div className="md:hidden">{controls}</div>
      {/* Computers draw the dashboard a step bigger than other pages (see .dashboard-type). */}
      <div className="dashboard-type contents">
        {board ? (
          isProjectArea(area) ? (
            <WorkBoard key={area} tasks={tasks} projects={projects} area={area} today={today} show={view.show} sort={sort} />
          ) : (
            <Board tasks={tasks} view="when" today={today} show={view.show} sort={sort} area={area} fill />
          )
        ) : isProjectArea(area) ? (
          // Aya and Work put their project chips above both columns, so the Today card lines up with the Scratch pad.
          <WorkToday
            key={area}
            tasks={sortTasks(todays, sort)}
            projects={projects}
            area={area}
            show={view.show}
            canAdd={canAdd}
            today={today}
            side={side}
          />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Life's Today is split into Morning, Day and Evening. */}
            <LifeToday tasks={todays} today={today} sort={sort} show={view.show} canAdd={canAdd} />
            {side}
          </div>
        )}
      </div>
    </Page>
  );
}
