# Sophon Plugin

Sophon adds task, project, and note tools backed by the hosted Sophon API.

## Setup

Configure these env vars in `~/.openclaw/openclaw.json` under `env.vars`:

- `SOPHON_API_URL` (required): base URL for the Sophon API endpoint, for example `https://project.supabase.co/functions/v1/api-v1`.
- `SOPHON_API_TOKEN` (required): API bearer token for Sophon.
- Optional: `SOPHON_API_TIMEOUT_MS` (milliseconds, defaults to `20000`) and `SOPHON_API_BASE_URL`/`SOPHON_SUPABASE_URL` compatibility fallbacks.

## Tools

- Tasks: `sophon_list_tasks`, `sophon_get_task`, `sophon_create_task`, `sophon_update_task`, `sophon_complete_task`, `sophon_archive_task`
- Projects: `sophon_list_projects`, `sophon_get_project`, `sophon_create_project`, `sophon_update_project`, `sophon_archive_project`
- Notes: `sophon_list_notes`, `sophon_get_note`, `sophon_create_note`, `sophon_update_note`, `sophon_archive_note`
- Summary/search: `sophon_dashboard`, `sophon_search`

## Auth Notes

If `SOPHON_API_TOKEN` is unavailable, you can fallback to `SOPHON_USER_TOKEN`.
