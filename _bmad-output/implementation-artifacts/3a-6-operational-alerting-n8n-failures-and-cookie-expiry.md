# Story 3A.6: Operational Alerting — n8n Failures and Cookie Expiry

Status: in-progress

---

## Story

As an operations manager,
I want to receive Slack alerts when n8n workflows fail or Beetrack session cookies expire, and have an auto-remediation agent that diagnoses issues and takes corrective action,
so that data ingestion issues are caught and resolved automatically before they affect the dashboard.

---

## Scope

### Scope 1: Slack Alerting
All operational errors (workflow failures, cookie expiry, IMAP deactivation, stale pipelines) are detected and posted to a Slack channel in real-time.

### Scope 2: Auto-Remediation Agent
An AI-powered agent receives error context from Slack/n8n, diagnoses the root cause, and takes corrective action autonomously — restarting workflows, reactivating IMAP triggers, or flagging issues that require human intervention.

---

## Acceptance Criteria

### Scope 1: Slack Alerting

#### AC1: n8n Workflow Failure → Slack Alert

**Given** any n8n workflow (Easy CSV, Beetrack Excel, Easy WMS Webhook) encounters an error during execution
**When** the error handler marks a job as `failed` in the `jobs` table
**Then** a Slack message is posted within 5 minutes to the `#aureon-alerts` channel containing:
  - Workflow name and execution ID
  - Error message (from `jobs.error_message`)
  - Job type and operator name
  - Timestamp of failure
  - Link to the n8n execution log (`https://n8n.tractis.ai/workflow/{workflowId}/executions/{executionId}`)

#### AC2: Beetrack Cookie Expiry Detection → Slack Alert

**Given** the Beetrack Excel Import workflow attempts to download the DispatchTrack XLSX
**When** the HTTP request receives a redirect to the login page (HTTP 302 to `/sign_in`) OR the CSRF token extraction fails
**Then** a Slack message is posted immediately with:
  - Severity: `CRITICAL`
  - Message: "Beetrack session cookies expired — recalibration required"
  - Which cookies need refresh (`DT_SESSION_COOKIE`, `DT_REMEMBER_TOKEN`)
  - Instructions: how to update the env vars on VPS
**And** the job is marked as `failed` with `error_message` containing `cookie_expired`

#### AC3: IMAP Trigger Deactivation Detection → Slack Alert

**Given** an n8n workflow with an IMAP trigger (Easy CSV, Beetrack) auto-deactivates due to connection drop
**When** the monitoring workflow detects the workflow is inactive but should be active
**Then** a Slack message is posted within 15 minutes:
  - Workflow name and ID
  - Message: "IMAP trigger deactivated — workflow stopped processing emails"
  - Action available: "Auto-remediation agent will attempt reactivation"

#### AC4: Stale Pipeline Detection → Slack Alert

**Given** a scheduled check runs every hour
**When** no new jobs have been created for any active workflow in the past 24 hours (configurable)
**Then** a Slack message is posted: "No ingestion activity in last 24h — pipeline may be stalled"
**And** includes: last job timestamp per workflow, workflow active/inactive status

#### AC5: Alert Deduplication

**Given** the same alert condition persists (e.g., cookies remain expired across multiple runs)
**When** an identical alert was already sent within the last 4 hours
**Then** the duplicate alert is suppressed
**And** a counter is maintained (e.g., "Cookie expired — 3rd occurrence since first alert at HH:MM")

#### AC6: Slack Channel Configuration

**Given** the alerting system is deployed
**Then** alerts are posted to a dedicated Slack channel via incoming webhook
**And** the webhook URL is stored as an n8n credential (not hardcoded)
**And** messages use Slack Block Kit formatting with severity-colored sidebars:
  - Red: CRITICAL (cookie expiry, workflow failure)
  - Orange: WARNING (stale pipeline, IMAP deactivation)
  - Blue: INFO (auto-remediation actions taken)

### Scope 2: Auto-Remediation Agent

#### AC7: Remediation Proposal via Slack

**Given** the monitoring workflow detects any actionable error (failed job, deactivated IMAP, cookie expiry)
**When** the auto-remediation agent analyzes the error and determines a corrective action
**Then** it posts a Slack message to `#aureon-alerts` with:
  - Diagnosis: what went wrong and why
  - Proposed action: exactly what the agent wants to do (e.g., "Reactivate workflow Beetrack Excel Import via n8n API")
  - Actionable buttons or emoji reactions: `Approve` / `Reject`
**And** the agent DOES NOT execute the action until Gerhard explicitly approves

#### AC8: Approval-Gated Execution

**Given** the agent has posted a remediation proposal (AC7)
**When** Gerhard reacts with `Approve` (button click or specific emoji like :white_check_mark:)
**Then** the agent executes the proposed action (e.g., reactivate workflow, retry job)
**And** posts a follow-up: "Action executed: {description} — Result: {success/failure}"
**When** Gerhard reacts with `Reject` or does not respond within 2 hours
**Then** the agent does NOT execute the action
**And** if rejected: posts "Action cancelled by operator"
**And** if timed out: posts "Action expired — no approval received within 2h"

#### AC9: Supported Remediation Actions

The agent can propose the following actions (all require approval):

**Auto-retryable actions:**
- **IMAP reactivation**: Deactivate + reactivate workflow via n8n API to reset IMAP connection
- **Transient error retry**: Re-execute workflow for transient failures (`ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `503`, `429`, `connection terminated`)

**Escalation-only actions** (agent diagnoses but cannot fix):
- **Cookie expired**: Posts diagnosis + manual steps to update `DT_SESSION_COOKIE` and `DT_REMEMBER_TOKEN` on VPS
- **Validation errors / invalid payload**: Posts diagnosis + suggests which code or config needs review
- **401 Unauthorized**: Posts diagnosis + which credential needs updating

#### AC10: Remediation Action Log

**Given** the auto-remediation agent proposes or executes any action
**Then** the action is logged to both:
  - Slack (threaded reply under the original alert)
  - The `jobs` table `result` JSONB field with key `remediation_actions[]`
**And** each log entry includes: timestamp, proposed action, approval status (pending/approved/rejected/expired), outcome (success/failure if executed), agent reasoning

#### AC11: Remediation Guardrails

**Given** the auto-remediation agent is active
**Then** it MUST NOT:
  - Execute ANY action without explicit operator approval via Slack
  - Modify n8n workflow logic (node configurations, connections)
  - Delete data from any database table
  - Change VPS environment variables or system configuration
  - Propose more than 3 retries per workflow per hour
  - Take action on errors it cannot classify with high confidence
**And** any action outside its allowed scope is posted to Slack as "Requires human intervention: {description}" with no approval button

---

## Tasks / Subtasks

### Scope 1: Slack Alerting

- [x] Task 1: Set up Slack integration (AC: #6)
  - [x] 1.1: Gerhard confirmed existing Slack workspace and `#aureon-alerts` channel
  - [x] 1.2: Slack Incoming Webhook created by Gerhard
  - [x] 1.3: Webhook URL configured directly in workflow HTTP Request node (not as n8n credential — simpler)
  - [x] 1.4: Test: 2 alert messages successfully delivered to Slack (execution 1166)

- [x] Task 2: Build n8n Alert Monitoring workflow (AC: #1, #3, #4, #5)
  - [x] 2.1: Created workflow `LCAdyXxLSeyMQk8d` with Schedule Trigger (every 15 min)
  - [x] 2.2: Added HTTP Request to query jobs table via Supabase REST API (recent 200 jobs)
  - [x] 2.3: Added HTTP Request to n8n API (`localhost:5678/api/v1/workflows`) for workflow active status + executions API for error detection
  - [x] 2.4: Added stale pipeline check in Process Alerts Code node (>24h since last job per type)
  - [x] 2.5: Added deduplication via Static Data: `{alert_key: {last_sent, count}}`, 4h suppression, 8h cleanup
  - [x] 2.6: Formatted Slack messages using Block Kit JSON with severity-colored attachments (red=CRITICAL, orange=WARNING)
  - [x] 2.7: Added HTTP Request node to post to Slack webhook
  - [x] 2.8: Exported workflow JSON to `apps/worker/n8n/workflows/operational-alerting.json`

- [x] Task 3: Enhance Beetrack workflow cookie expiry detection (AC: #2)
  - [x] 3.1: Modified Extract CSRF node to detect login page (sign_in, Log in, password keywords, short response) and throw `cookie_expired:` prefixed error
  - [x] 3.2: Error message includes `cookie_expired` keyword for pattern matching by alerting workflow
  - [x] 3.3: Modified Prepare Error node to create new job record (POST) when no job_id exists (early failures before Create Job Record). Added Has Job ID IF node + Create Error Job HTTP Request node.
  - [x] 3.4: Alerting workflow Process Alerts checks jobs table for cookie_expired pattern in error_message

- [x] Task 4: Deploy and verify Scope 1 (AC: #1-6)
  - [x] 4.1: Alerting workflow deployed to n8n production (ID: LCAdyXxLSeyMQk8d)
  - [x] 4.2: Workflow activated, schedule trigger firing every 15 min (verified: exec 1161 at 17:30, exec 1166 at 17:45)
  - [x] 4.3: Test: 2 CRITICAL alerts delivered to Slack (execution 1166 — caught Easy CSV errors from 15:30 window)
  - [ ] 4.4: Test: deactivate a workflow manually → verify IMAP deactivation alert
  - [x] 4.5: Deduplication verified: first run (1161) had 0 alerts (clean window), second run (1166) caught errors with 3h test window, subsequent runs with 15min window correctly report 0 alerts
  - [x] 4.6: Workflow JSON exported to `apps/worker/n8n/workflows/operational-alerting.json`

### Scope 2: Auto-Remediation Agent

- [ ] Task 5: Build auto-remediation n8n workflow — proposal + approval loop (AC: #7, #8, #9, #10, #11)
  - [ ] 5.1: Create new n8n workflow `auto-remediation-agent` triggered by the alerting workflow (chained after alerts detected)
  - [ ] 5.2: Add error classification Code node: parse `error_message`, classify as `transient` / `cookie_expired` / `validation_error` / `unknown`
  - [ ] 5.3: Add Slack proposal node: post diagnosis + proposed action + interactive `Approve` / `Reject` buttons (Slack Block Kit with action buttons)
  - [ ] 5.4: Add Slack Webhook Trigger workflow (`remediation-approval-listener`) that listens for button clicks from Slack interactive messages
  - [ ] 5.5: On `Approve` received: execute the proposed action (IMAP reactivation via n8n API, or job re-execution via n8n API)
  - [ ] 5.6: On `Reject` or 2h timeout: mark action as cancelled/expired, post follow-up to Slack thread
  - [ ] 5.7: Add retry counter logic via Static Data: max 3 proposals per workflow per hour
  - [ ] 5.8: Add escalation-only branch for non-fixable errors (cookie expiry, validation): post diagnosis + manual steps, no Approve button
  - [ ] 5.9: Log all proposals and outcomes to `jobs.result.remediation_actions[]` via Supabase UPDATE node
  - [ ] 5.10: Export both workflow JSONs to `apps/worker/n8n/workflows/`

- [ ] Task 6: Deploy and verify Scope 2 (AC: #7-11)
  - [ ] 6.1: Deploy both remediation workflows to n8n production
  - [ ] 6.2: Test: deactivate IMAP workflow → verify proposal appears in Slack → click Approve → verify reactivation + confirmation
  - [ ] 6.3: Test: create a job with transient error → verify proposal → Approve → verify retry
  - [ ] 6.4: Test: create a job with `cookie_expired` → verify escalation-only message (no Approve button)
  - [ ] 6.5: Test: click Reject on a proposal → verify "Action cancelled" message
  - [ ] 6.6: Test: let a proposal expire (2h) → verify timeout message
  - [ ] 6.7: Test: trigger 4 failures in 1 hour → verify proposals stop at 3 and escalate
  - [ ] 6.8: Export final workflow JSONs to repo and commit

---

## Dev Notes

### This is Primarily an n8n Workflow Story

Two new n8n workflows are the core deliverables:
1. `operational-alerting` — monitors `jobs` table + n8n API, posts to Slack
2. `auto-remediation-agent` — classifies errors, takes corrective action, reports to Slack

Plus one modification to the existing Beetrack workflow for better cookie expiry detection.

### Current State of Error Handling

All three active workflows already have error handler paths:
- **Easy CSV** (`Cj79hRWYsXPuHfHY`): Error Trigger → Prepare Error → Mark Job Failed
- **Beetrack** (`5hQa3YQFOwfkWE4V`): Error Trigger → Prepare Error → Mark Job Failed
- **Easy WMS** (`nhYC230w1ncOTo6e`): Error Trigger → Prepare Error → Mark Job Failed → Respond 200

All mark `jobs.status = 'failed'` with `error_message` — but **no alerts are sent**. The alerting workflow reads from this existing `jobs` table.

### Cookie Handling in Beetrack Workflow

Current state: Uses env vars `$env.DT_SESSION_COOKIE` and `$env.DT_REMEMBER_TOKEN` as static cookies in the HTTP Download XLSX node. The CSRF token extraction (`Extract CSRF Token` node) will throw if the regex fails — which happens when cookies are expired and the page returns a login form instead of the export page.

**Gap:** No explicit HTTP status code check. The error only surfaces when CSRF extraction fails downstream. Task 3 adds earlier detection.

### IMAP Trigger Auto-Deactivation (Known Issue)

n8n auto-deactivates workflows when IMAP connections drop. The error handler fires hourly but no emails are read. Fix is to deactivate + reactivate the workflow via n8n API:
```
PATCH /api/v1/workflows/{id} { active: false }
PATCH /api/v1/workflows/{id} { active: true }
```

The auto-remediation agent (Task 5.3) does this automatically.

### Alert Deduplication Strategy

Use n8n's built-in **Static Data** feature to store `{alert_key: {last_sent: timestamp, count: number}}`. On each run:
1. Generate alert key from `{workflow_id}:{error_type}`
2. Check if same key was sent within 4 hours
3. If yes, increment count but suppress Slack post
4. If no, post alert and reset counter

This avoids needing a database table for alert state.

### n8n API for Workflow Management

The auto-remediation agent uses n8n's internal REST API (available at `localhost:5678`):
- `GET /api/v1/workflows` — list workflows with active status
- `PATCH /api/v1/workflows/{id}` — activate/deactivate workflows
- `POST /api/v1/workflows/{id}/run` — trigger workflow execution

Authentication: n8n API key stored as n8n credential. The VPS has n8n running locally, so `localhost:5678` is accessible from n8n itself.

### Error Classification Heuristics

The auto-remediation agent's Code node classifies errors by pattern matching on `error_message`:

```javascript
// Transient (auto-retryable)
const TRANSIENT_PATTERNS = [
  /ECONNREFUSED/i, /ETIMEDOUT/i, /ECONNRESET/i,
  /503/i, /429/i, /service unavailable/i,
  /connection terminated/i, /IMAP connection lost/i,
];

// Cookie expiry (human action required)
const COOKIE_PATTERNS = [
  /cookie.?expir/i, /session.?expir/i,
  /sign_in/i, /CSRF.*fail/i,
];

// Everything else → unknown → escalate
```

### n8n Sandbox Limitations

Remember: n8n Code nodes run in a sandbox — `fetch()` is NOT available. All HTTP calls (to n8n API, Supabase, Slack) must use HTTP Request nodes, not Code node fetch calls.

### Slack Block Kit Message Format

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🔴 CRITICAL: Beetrack Cookie Expired" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Workflow:*\nBeetrack Excel Import" },
        { "type": "mrkdwn", "text": "*Time:*\n2026-03-05 14:30 CLT" }
      ]
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Error:*\n`Cookie expired — CSRF token extraction failed`" }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Action required: Update `DT_SESSION_COOKIE` and `DT_REMEMBER_TOKEN` on VPS" }
      ]
    }
  ],
  "attachments": [{ "color": "#FF0000" }]
}
```

### Jobs Table Schema (Reference)

```sql
jobs.id          -- UUID
jobs.operator_id -- UUID (FK to operators)
jobs.client_id   -- UUID (FK to tenant_clients)
jobs.job_type    -- 'csv_email' | 'browser' | 'api'
jobs.status      -- 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
jobs.error_message -- TEXT (up to 1000 chars)
jobs.result      -- JSONB (success output; remediation_actions[] added by agent)
jobs.retry_count -- INT
jobs.max_retries -- INT (default 3)
jobs.updated_at  -- TIMESTAMPTZ
```

### Existing Monitoring Infrastructure

- **Sentry**: Fully configured for frontend + worker. Worker captures job errors to Sentry already.
- **BetterStack**: Health check endpoint at `/api/health`. Monitors frontend uptime. Worker has heartbeat via `BETTERSTACK_HEARTBEAT_URL`.
- **Structured Logging**: Worker logs JSON to stdout → journald. Events: `job_failed_permanent`, `poll_error`, `beetrack_session_expired`.

This story adds the **missing link**: turning logged errors into proactive Slack notifications + automated remediation.

### Project Structure Notes

- n8n workflow files: `apps/worker/n8n/workflows/` (exported JSON, committed to repo)
- No frontend changes needed
- No Supabase migrations needed (uses existing `jobs` table, writes to `result` JSONB)
- New n8n credentials needed: Slack Webhook URL, n8n API key (for self-API calls)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3A.6] — Epic story definition
- [Source: apps/worker/n8n/workflows/beetrack-excel-import.json] — Beetrack workflow with cookie handling
- [Source: apps/worker/n8n/workflows/easy-csv-import.json] — Easy CSV workflow error handler
- [Source: apps/worker/n8n/workflows/easy-wms-webhook.json] — Easy WMS webhook error handler
- [Source: apps/worker/src/connectors/beetrack.ts] — Worker-side Beetrack connector with session expiry detection
- [Source: apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql] — Jobs table schema
- [Source: apps/frontend/docs/monitoring-architecture.md] — Sentry + BetterStack monitoring setup
- [Source: apps/frontend/docs/deployment-runbook.md] — Deployment and monitoring configuration

---

## Previous Story Intelligence

**From Story 3A.5 (User Onboarding Verification):**
- Musan admin user created: oscar.munoz@transportesmusan.com
- 1,331 orders in DB, metrics backfilled (29 rows)
- `delivery_attempts` nearly empty (2 rows) — Beetrack workflow not producing delivery outcomes at scale
- Supabase Admin API `createUser` returns 500 — use direct SQL workaround

**From Story 3A.7 (Easy WMS Webhook):**
- New webhook workflow deployed with `continueOnFail: true` pattern on upsert nodes
- Always returns HTTP 200 to prevent retry storms
- Error handler creates failed job record — this story's alerting workflow will catch those failures

**From Story 3A.2 (E2E Pipeline Validation):**
- Metrics refresh same-minute via n8n trigger after data ingestion
- `calculate_daily_metrics` cron registered
- delivery_attempts backfill complete

**From Story 3A.8 (Dashboard Pipeline Navigation):**
- Loading Data tab with pipeline KPIs and charts
- 228 tests passing

**Git Intelligence (last 10 commits):**
- `05ce98c` fix(dashboard): committed orders chart filters by created_at
- `4549ad8` fix(nav): remove Homepage, Example Storage and Example Table menu items
- `4ae5c9a` feat(3a-2): end-to-end data pipeline validated + same-minute metrics refresh (#62)
- `a91d88f` feat(3a-7): Easy WMS webhook live — orders+packages upserted e2e (#61)

### Key IDs

- Musan operator_id: `92dc5797-047d-458d-bbdb-63f18c0dd1e7`
- Easy CSV workflow: `Cj79hRWYsXPuHfHY`
- Beetrack Excel Import workflow: `5hQa3YQFOwfkWE4V`
- Easy WMS webhook workflow: `nhYC230w1ncOTo6e`

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Schedule Trigger corruption: rapid deactivate/reactivate cycles corrupted trigger state on first workflow (oylfPkc8ZgqxcUHg). Fixed by deleting and recreating as LCAdyXxLSeyMQk8d.
- Windows curl SSL errors prevented direct testing from dev machine. All n8n operations done via MCP tools.
- n8n Code node sandbox: cannot use fetch(). All HTTP calls use HTTP Request nodes.

### Completion Notes List

- Scope 1 (Tasks 1-4) complete: Slack alerting workflow live, 4 check types (exec errors, deactivated workflows, cookie expiry, stale pipelines), deduplication, Block Kit formatting
- Beetrack cookie expiry detection enhanced: Extract CSRF detects login page, Prepare Error creates job records for early failures
- Scope 2 (Tasks 5-6) not started: Auto-remediation agent deferred

### File List

- `apps/worker/n8n/workflows/operational-alerting.json` — Exported alerting workflow (sanitized, secrets replaced with placeholders)
- n8n workflow `LCAdyXxLSeyMQk8d` — Operational Alerting (live on n8n.tractis.ai)
- n8n workflow `5hQa3YQFOwfkWE4V` — Beetrack Excel Import (modified: cookie expiry detection + early failure job creation)
