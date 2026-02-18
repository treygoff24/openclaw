export type SophonTaskStatus = "backlog" | "in_progress" | "completed" | "blocked" | "waiting";

export type SophonPriority = "p1" | "p2" | "p3" | "p4" | "p5";

export type SophonTask = {
  id: string;
  title: string;
  description: string | null;
  desired_outcome: string | null;
  status_label: SophonTaskStatus;
  priority_level: SophonPriority;
  top_level_category: string;
  project_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  is_recurring: boolean;
  team_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SophonProject = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priority_level: SophonPriority;
  due_date: string | null;
  desired_outcome: string | null;
  visible_to_managers: boolean;
  completed_at: string | null;
  team_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SophonNote = {
  id: string;
  title: string;
  content: string | null;
  task_id: string | null;
  project_id: string | null;
  team_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SophonDashboardTaskSummary = {
  backlog: number;
  in_progress: number;
  completed: number;
  blocked: number;
  waiting: number;
  overdue: number;
  total: number;
};

export type SophonDashboardProjectSummary = {
  active: number;
  completed: number;
  total: number;
};

export type SophonUpcomingDeadline = {
  id: string;
  title: string;
  due_date: string | null;
  priority_level: SophonPriority;
  status_label: SophonTaskStatus;
  project_id: string | null;
};

export type SophonDashboardSummary = {
  tasks: SophonDashboardTaskSummary;
  projects: SophonDashboardProjectSummary;
  upcoming_deadlines: SophonUpcomingDeadline[];
};

export type SophonTaskStatusStats = Record<string, number>;
