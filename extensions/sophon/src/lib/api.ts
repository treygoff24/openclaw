import type {
  SophonDashboardSummary,
  SophonNote,
  SophonProject,
  SophonTask,
  SophonTaskStatusStats,
} from "./types.js";

type QueryValue = string | number | boolean | null;
type QueryObject = Record<string, QueryValue | undefined | null | Array<QueryValue>>;

type ApiPayload = Record<string, unknown>;
type BodyPayload = ApiPayload | undefined;

export type HttpMethod = "GET" | "POST" | "PATCH";

export type ApiClientConfig = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
};

export type ListTasksResponse = {
  tasks: SophonTask[];
};

export type GetTaskResponse = {
  task: SophonTask;
};

export type ListProjectsResponse = {
  projects: SophonProject[];
};

export type GetProjectResponse = {
  project: SophonProject & {
    task_stats?: SophonTaskStatusStats;
  };
};

export type ListNotesResponse = {
  notes: SophonNote[];
};

export type GetNoteResponse = {
  note: SophonNote;
};

export type DashboardResponse = SophonDashboardSummary;
export type SearchResponse = {
  tasks?: SophonTask[];
  projects?: SophonProject[];
  notes?: SophonNote[];
};

export type ListTasksParams = {
  status?: string;
  priority?: string;
  project_id?: string;
  category?: string;
  due_before?: string;
  due_after?: string;
  team_id?: string;
  limit?: number;
};

export type ListProjectsParams = {
  category?: string;
  priority?: string;
  include_completed?: boolean;
  team_id?: string;
  limit?: number;
};

export type ListNotesParams = {
  project_id?: string;
  task_id?: string;
  search?: string;
  team_id?: string;
  limit?: number;
};

export type SearchParams = {
  query: string;
  entity_types?: string[];
  limit?: number;
  team_id?: string;
};

export type CreateTaskInput = ApiPayload;
export type PatchTaskInput = ApiPayload;
export type CreateProjectInput = ApiPayload;
export type PatchProjectInput = ApiPayload;
export type CreateNoteInput = ApiPayload;
export type PatchNoteInput = ApiPayload;

const DEFAULT_TIMEOUT_MS = 20_000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map((segment) => Number.parseInt(segment, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const base = trimTrailingSlash(rawBaseUrl);
  if (base.includes("/api/v1") || base.includes("/api-v1")) {
    return base;
  }

  return `${trimTrailingSlash(base)}/functions/v1/api-v1/api/v1`;
}

function normalizeEndpoint(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized;
}

function buildUrl(baseUrl: string, path: string, query?: QueryObject): string {
  const base = normalizeBaseUrl(baseUrl);
  const endpoint = normalizeEndpoint(path);
  const trimmedEndpoint = trimLeadingSlash(endpoint);

  const url = new URL(`${base}/${trimmedEndpoint}`);
  if (query) {
    for (const [rawKey, rawValue] of Object.entries(query)) {
      if (rawValue === undefined || rawValue === null) {
        continue;
      }

      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          url.searchParams.append(rawKey, String(item));
        }
      } else {
        url.searchParams.set(rawKey, String(rawValue));
      }
    }
  }

  return url.toString();
}

function hasErrorPayload(payload: unknown): payload is {
  error?: {
    code?: string;
    message?: string;
  };
} {
  return typeof payload === "object" && payload !== null && "error" in payload;
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!hasErrorPayload(payload)) {
    return fallback;
  }

  const maybeCode = payload.error?.code;
  const maybeMessage = payload.error?.message;

  if (!maybeMessage || typeof maybeMessage !== "string") {
    return fallback;
  }

  return typeof maybeCode === "string" ? `${maybeCode}: ${maybeMessage}` : maybeMessage;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text);
}

export function resolveClientConfig(): ApiClientConfig {
  const rawBaseUrl =
    readOptionalEnv("SOPHON_API_URL") ??
    readOptionalEnv("SOPHON_API_BASE_URL") ??
    readOptionalEnv("SOPHON_SUPABASE_URL");

  if (!rawBaseUrl) {
    throw new Error("Missing SOPHON_API_URL environment variable.");
  }

  const token = readOptionalEnv("SOPHON_API_TOKEN") ?? readOptionalEnv("SOPHON_USER_TOKEN");
  if (!token) {
    throw new Error("Missing SOPHON_API_TOKEN environment variable.");
  }

  const rawTimeout = readOptionalEnv("SOPHON_API_TIMEOUT_MS");
  const parsedTimeout = Number(rawTimeout ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout >= 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;

  return {
    baseUrl: rawBaseUrl,
    token,
    timeoutMs,
  };
}

function sanitizeIncludeCompleted(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") {
    return undefined;
  }
  return value;
}

export async function callSophonApi<T>(
  method: HttpMethod,
  path: string,
  options: {
    query?: QueryObject;
    body?: BodyPayload;
  } = {},
): Promise<T> {
  const config = resolveClientConfig();
  const controller = new AbortController();
  const timeoutMs = Math.max(0, config.timeoutMs);
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetch(buildUrl(config.baseUrl, path, options.query), {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    let payload: unknown;
    try {
      payload = await parseJsonBody(response);
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const reason = readErrorMessage(payload, `Request failed: ${response.statusText}`);
      throw new Error(`Sophon API error: ${reason}`);
    }

    if (typeof payload !== "object" || payload === null) {
      throw new Error("Sophon API error: Invalid API response format.");
    }

    if (hasErrorPayload(payload)) {
      const reason = readErrorMessage(payload, "Request failed.");
      throw new Error(`Sophon API error: ${reason}`);
    }

    return payload as T;
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      throw new Error("Sophon API error: Request timed out.");
    }
    if (error instanceof Error && error.name === "SyntaxError") {
      throw new Error("Sophon API error: Invalid API response format.");
    }
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(`Sophon API error: ${error.message}`);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function listTasks(params: ListTasksParams): Promise<ListTasksResponse> {
  return callSophonApi<ListTasksResponse>("GET", "/tasks", {
    query: params,
  });
}

export async function getTask(id: string): Promise<GetTaskResponse> {
  return callSophonApi<GetTaskResponse>("GET", `/tasks/${id}`);
}

export async function createTask(input: CreateTaskInput): Promise<GetTaskResponse> {
  return callSophonApi<GetTaskResponse>("POST", "/tasks", { body: input });
}

export async function patchTask(id: string, input: PatchTaskInput): Promise<GetTaskResponse> {
  return callSophonApi<GetTaskResponse>("PATCH", `/tasks/${id}`, { body: input });
}

export async function completeTask(id: string): Promise<GetTaskResponse> {
  return callSophonApi<GetTaskResponse>("POST", `/tasks/${id}/complete`);
}

export async function archiveTask(id: string): Promise<GetTaskResponse> {
  return callSophonApi<GetTaskResponse>("POST", `/tasks/${id}/archive`);
}

export async function listProjects(params: ListProjectsParams): Promise<ListProjectsResponse> {
  const query = {
    ...params,
    include_completed: sanitizeIncludeCompleted(params.include_completed),
  };
  return callSophonApi<ListProjectsResponse>("GET", "/projects", { query });
}

export async function getProject(id: string): Promise<GetProjectResponse> {
  return callSophonApi<GetProjectResponse>("GET", `/projects/${id}`);
}

export async function createProject(input: CreateProjectInput): Promise<GetProjectResponse> {
  return callSophonApi<GetProjectResponse>("POST", "/projects", { body: input });
}

export async function patchProject(
  id: string,
  input: PatchProjectInput,
): Promise<GetProjectResponse> {
  return callSophonApi<GetProjectResponse>("PATCH", `/projects/${id}`, { body: input });
}

export async function archiveProject(id: string): Promise<GetProjectResponse> {
  return callSophonApi<GetProjectResponse>("POST", `/projects/${id}/archive`);
}

export async function listNotes(params: ListNotesParams): Promise<ListNotesResponse> {
  return callSophonApi<ListNotesResponse>("GET", "/notes", {
    query: params,
  });
}

export async function getNote(id: string): Promise<GetNoteResponse> {
  return callSophonApi<GetNoteResponse>("GET", `/notes/${id}`);
}

export async function createNote(input: CreateNoteInput): Promise<GetNoteResponse> {
  return callSophonApi<GetNoteResponse>("POST", "/notes", { body: input });
}

export async function patchNote(id: string, input: PatchNoteInput): Promise<GetNoteResponse> {
  return callSophonApi<GetNoteResponse>("PATCH", `/notes/${id}`, { body: input });
}

export async function archiveNote(id: string): Promise<GetNoteResponse> {
  return callSophonApi<GetNoteResponse>("POST", `/notes/${id}/archive`);
}

export async function getDashboard(teamId?: string): Promise<DashboardResponse> {
  return callSophonApi<DashboardResponse>("GET", "/dashboard", {
    query: teamId ? { team_id: teamId } : undefined,
  });
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  return callSophonApi<SearchResponse>("GET", "/search", {
    query: {
      query: params.query,
      entity_types: params.entity_types ? params.entity_types.join(",") : undefined,
      limit: params.limit,
      team_id: params.team_id,
    },
  });
}
