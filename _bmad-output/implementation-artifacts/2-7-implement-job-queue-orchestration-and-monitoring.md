# Story 2.7: Implement Job Queue Orchestration and Monitoring

**Epic:** 2 - Order Data Ingestion & Automation Worker
**Story ID:** 2.7
**Status:** in-progress
**Created:** 2026-02-23

---

## Story

**As an** Aureon DevOps engineer,
**I want** a reliable job orchestration system with monitoring and alerting,
**So that** connectors run on schedule, failures are retried, and the team is notified of issues.

---

## Acceptance Criteria

### AC1: Job Polling Loop
```gherkin
Given the worker process is running as a systemd service
When the poll interval elapses (every 30 seconds)
Then the worker executes:
  SELECT id, job_type, client_id, operator_id, retry_count, max_retries, priority, scheduled_at
  FROM jobs
  WHERE status IN ('pending', 'retrying')
    AND (scheduled_at IS NULL OR scheduled_at <= now())
  ORDER BY priority DESC, scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
And if a job is found: status → 'running', started_at → now()
And if no job is found: sleep WORKER_POLL_INTERVAL_MS and poll again
```

### AC2: Job Execution Dispatch
```gherkin
Given a job has been claimed (status = 'running')
When the worker dispatches execution
Then it routes by job_type:
  - 'browser' → executes browser connector (Story 2.6 interface — stub in this story)
  - 'csv_email' → status tracking only (n8n handles actual execution independently)
  - unknown job_type → log warning, mark job as 'failed' with error_message = 'Unknown job_type: <type>'
And on success: status → 'completed', completed_at → now(), result JSONB updated
And on failure: retry_count++, if retry_count < max_retries → status → 'retrying' (with exponential backoff in scheduled_at), else → status → 'failed', error_message populated
```

### AC3: Scheduled Job Creation (Cron)
```gherkin
Given the worker process starts
When the clock reaches 06:00 CLT (America/Santiago)
Then a daily cron within the worker creates one 'pending' job per active browser connector client:
  SELECT id, operator_id FROM tenant_clients WHERE is_active = true AND connector_type = 'browser'
And for each result: INSERT INTO jobs (id, operator_id, client_id, job_type, status, priority, scheduled_at)
  VALUES (gen_random_uuid(), <operator_id>, <client_id>, 'browser', 'pending', 5, NOW())
  ON CONFLICT DO NOTHING
And duplicate job prevention: do not create a job if a job for that client_id already exists today with status IN ('pending', 'running', 'retrying', 'completed')
```

### AC4: Retry Logic with Exponential Backoff
```gherkin
Given a job execution fails
When retry_count < max_retries
Then status → 'retrying'
And scheduled_at → NOW() + interval (2^retry_count * 60 seconds)
  - retry 1: +60s, retry 2: +120s, retry 3: +240s
And retry_count is incremented
When retry_count >= max_retries
Then status → 'failed', error_message set
And alert triggered (see AC6)
```

### AC5: Systemd Watchdog and Process Health
```gherkin
Given the worker is running as aureon-worker.service
When the process exits for any reason (crash, OOM, unhandled exception)
Then systemd auto-restarts the process (Restart=always, RestartSec=5)
And the worker logs the restart event via journald
When two workers attempt to pick the same job simultaneously
Then FOR UPDATE SKIP LOCKED ensures only one worker claims the job (no double-processing)
```

### AC6: Alerting via n8n
```gherkin
Given monitoring conditions are checked by an n8n monitoring workflow
When a job reaches status = 'failed' with retry_count >= max_retries
Then an alert notification is sent (Slack/email) via n8n
When no jobs with status = 'completed' exist in the last expected window for a connector
Then a warning notification is sent (configurable threshold per connector_type)
When VPS disk usage exceeds 80%
Then a disk alert notification is sent
When VPS disk usage exceeds 90%
Then old journald logs are vacuumed: journalctl --vacuum-size=500M
```

### AC7: Sentry Error Capture
```gherkin
Given the worker encounters an unhandled exception or job execution error
When Sentry is initialized with SENTRY_DSN
Then the error is captured with job context:
  - job.id, job.job_type, job.client_id, job.operator_id, job.retry_count
And stack trace is included
And the Sentry event is tagged with environment = NODE_ENV
```

### AC8: Structured Logging
```gherkin
Given the worker is running
When any significant event occurs (poll cycle, job claimed, job completed, job failed, startup, shutdown)
Then structured JSON is written to stdout, captured by journald:
  {"level":"info","ts":"<ISO8601>","event":"<event_name>","jobId":"<uuid>","jobType":"<type>","durationMs":<n>}
And log levels: debug (poll no-op), info (job lifecycle), warn (unknown job_type, retry), error (failure, exception)
And journald captures output automatically via systemd service configuration
```

### AC9: Supabase Connection Resilience
```gherkin
Given the worker starts or loses DB connectivity
When Supabase is unreachable
Then the worker retries the DB connection with exponential backoff (max 5 attempts, then log fatal + exit for systemd restart)
And in-flight job status is not corrupted — the poll query uses a transaction; on connection loss mid-poll the lock is released automatically by PostgreSQL
```

### AC10: Deployment via GitHub Actions
```gherkin
Given a push to main includes changes under apps/worker/
When the deploy-worker job in deploy.yml runs
Then the self-hosted runner (VPS, user aureon) executes: bash ~/aureon-last-mile/apps/worker/scripts/deploy.sh
And deploy.sh handles: git pull, npm ci, npm run build, systemctl restart aureon-worker
And the deploy workflow already exists at .github/workflows/deploy.yml — NO changes needed to that file
```

---

## Edge Cases

- **Worker crash mid-job:** The FOR UPDATE lock is released when the connection closes. PostgreSQL returns the row to 'running' but the lock is gone. The next poll will NOT pick it up (status = 'running' is not polled). A watchdog check (separate loop or n8n) must detect jobs stuck in 'running' for > N minutes and reset them.
- **Double job creation (cron race):** ON CONFLICT DO NOTHING + today-scoped deduplication check prevents duplicate daily jobs if cron fires twice.
- **Long-running browser job:** No hard timeout by default. Log `durationMs` on completion. Add configurable soft timeout as a future enhancement.
- **VPS disk at 90%:** deploy.sh already checks disk > 90% and aborts. The worker's auto-cleanup (journalctl --vacuum-size=500M) triggers via n8n alert at > 90% to prevent this.
- **Supabase unreachable at startup:** Worker uses exponential backoff (attempts: 1,2,4,8,16s). After max attempts, process exits → systemd restarts → retries. Never enters poll loop without a healthy DB connection.
- **csv_email job in queue:** Worker claims it, sets status = 'running', then immediately marks it 'completed' (n8n is the actual executor). This ensures the jobs table is accurate for monitoring without the worker duplicating n8n's work.
- **Unknown job_type:** Log warning with structured JSON, mark job 'failed', do not retry (it will always fail). Prevents infinite retry loop.

---

## Tasks / Subtasks

### Task 1: Add Dependencies to package.json (AC: #1, #7, #8, #9)
- [x] Add runtime dependencies:
  - `pg` — PostgreSQL client for direct DB polling (FOR UPDATE SKIP LOCKED)
  - `@sentry/node` — error capture with job context
  - `node-cron` — cron scheduling for 06:00 CLT daily job creation
- [x] Add type dependencies:
  - `@types/pg`
  - `@types/node-cron`
- [x] Run `npm install` and commit updated `package.json` + `package-lock.json`
- [x] Verify `npm audit --omit=dev --audit-level=moderate` passes (1 upstream minimatch vuln in @sentry/node — transitive, not actionable)

### Task 2: Create Worker Entry Point — src/index.ts (AC: #1, #5, #8, #9)
- [x] Replace the placeholder `src/index.ts` with the real worker bootstrap:
  ```typescript
  // src/index.ts
  import * as Sentry from '@sentry/node';
  import { initDb } from './db';
  import { startPollLoop } from './poller';
  import { startCron } from './cron';
  import { log } from './logger';

  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });

  async function main() {
    log('info', 'worker_start', { version: '0.2.0' });
    await initDb(); // connect with backoff, exit on failure
    startCron();    // register 06:00 CLT cron
    startPollLoop().catch((err) => { // surface unexpected loop exits
      Sentry.captureException(err);
      log('error', 'poll_loop_fatal', { error: String(err) });
      process.exit(1);
    });
  }

  main().catch((err) => {
    Sentry.captureException(err);
    log('error', 'worker_fatal', { error: String(err) });
    process.exit(1);
  });
  ```
- [x] Handle SIGTERM/SIGINT for graceful shutdown: log 'worker_stop', close DB pool, exit 0

### Task 3: Create DB Module — src/db.ts (AC: #1, #9)
- [x] Use `pg.Pool` configured from `SUPABASE_DB_*` environment variables:
  ```typescript
  // src/db.ts
  import { Pool } from 'pg';

  export let pool: Pool;

  export async function initDb(): Promise<void> {
    pool = new Pool({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
      database: process.env.SUPABASE_DB_NAME,
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }, // Supabase requires SSL
      max: 5,
      idleTimeoutMillis: 30000,
    });
    // Exponential backoff: 1,2,4,8,16s — then exit
    let attempt = 0;
    while (attempt < 5) {
      try {
        await pool.query('SELECT 1');
        log('info', 'db_connected');
        return;
      } catch (err) {
        attempt++;
        const delay = Math.pow(2, attempt - 1) * 1000;
        log('warn', 'db_connect_retry', { attempt, delayMs: delay });
        await sleep(delay);
      }
    }
    throw new Error('DB connection failed after 5 attempts');
  }
  ```
- [x] Export `pool` for use by poller and cron modules
- [x] Add `ssl: { rejectUnauthorized: false }` — required for Supabase pooler

### Task 4: Create Logger Module — src/logger.ts (AC: #8)
- [x] Emit structured JSON to stdout (journald captures stdout automatically):
  ```typescript
  // src/logger.ts
  export function log(level: 'debug'|'info'|'warn'|'error', event: string, meta?: Record<string, unknown>): void {
    const entry = { level, ts: new Date().toISOString(), event, ...meta };
    console.log(JSON.stringify(entry));
  }

  export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  ```

### Task 5: Create Job Type Interface — src/connectors/types.ts (AC: #2)
- [x] Define the connector execution contract (Story 2.6 will implement browser connector against this interface):
  ```typescript
  // src/connectors/types.ts
  export interface JobRecord {
    id: string;
    job_type: 'csv_email' | 'browser' | string;
    client_id: string;
    operator_id: string;
    retry_count: number;
    max_retries: number;
    priority: number;
    scheduled_at: string;
  }

  export interface JobResult {
    success: boolean;
    result?: Record<string, unknown>;
    errorMessage?: string;
  }

  export type ConnectorExecutor = (job: JobRecord) => Promise<JobResult>;
  ```
- [x] Create connector registry — src/connectors/index.ts:
  ```typescript
  // src/connectors/index.ts
  import { ConnectorExecutor } from './types';
  import { executeCsvEmail } from './csv-email';
  // import { executeBrowser } from './browser'; // Story 2.6

  export const connectors: Record<string, ConnectorExecutor> = {
    csv_email: executeCsvEmail,
    browser: async (_job) => { throw new Error('Browser connector not implemented — see Story 2.6'); },
  };
  ```

### Task 6: Create CSV Email Connector Stub — src/connectors/csv-email.ts (AC: #2)
- [x] The worker's role for csv_email is monitoring only — n8n handles actual execution:
  ```typescript
  // src/connectors/csv-email.ts
  import { JobRecord, JobResult } from './types';
  import { log } from '../logger';

  export async function executeCsvEmail(job: JobRecord): Promise<JobResult> {
    // csv_email jobs are created by n8n and executed by n8n independently.
    // The worker claims the job here only for status tracking purposes.
    // If this job appears in the queue, it means n8n failed to update its status.
    log('info', 'csv_email_status_ack', { jobId: job.id });
    return {
      success: true,
      result: { note: 'csv_email job acknowledged by worker; n8n is the actual executor' },
    };
  }
  ```

### Task 7: Create Poll Loop — src/poller.ts (AC: #1, #2, #4, #7, #8)
- [x] Implement the core poll-claim-execute-update cycle:
  ```typescript
  // src/poller.ts
  import * as Sentry from '@sentry/node';
  import { pool } from './db';
  import { connectors } from './connectors';
  import { log, sleep } from './logger';
  import { JobRecord } from './connectors/types';

  const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30000);

  const POLL_QUERY = `
    SELECT id, job_type, client_id, operator_id, retry_count, max_retries, priority, scheduled_at
    FROM jobs
    WHERE status IN ('pending', 'retrying')
      AND (scheduled_at IS NULL OR scheduled_at <= now())
    ORDER BY priority DESC, scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;
  // Note: `scheduled_at` is NOT NULL with DEFAULT NOW() — the `IS NULL` branch is defensive only and will never match.

  export async function startPollLoop(): Promise<void> {
    log('info', 'poll_loop_start', { intervalMs: POLL_INTERVAL_MS });
    while (true) {
      await pollOnce();
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function pollOnce(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<JobRecord>(POLL_QUERY);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        log('debug', 'poll_no_jobs');
        return;
      }
      const job = rows[0];
      await client.query(
        `UPDATE jobs SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      await client.query('COMMIT');
      log('info', 'job_claimed', { jobId: job.id, jobType: job.job_type });
      await executeJob(job);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      log('error', 'poll_error', { error: String(err) });
      Sentry.captureException(err);
    } finally {
      client.release();
    }
  }

  async function executeJob(job: JobRecord): Promise<void> {
    const startMs = Date.now();
    const executor = connectors[job.job_type];
    if (!executor) {
      log('warn', 'unknown_job_type', { jobId: job.id, jobType: job.job_type });
      await pool.query(
        `UPDATE jobs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [`Unknown job_type: ${job.job_type}`, job.id]
      );
      return;
    }
    try {
      const result = await executor(job);
      const durationMs = Date.now() - startMs;
      if (result.success) {
        await pool.query(
          `UPDATE jobs SET status = 'completed', completed_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(result.result ?? {}), job.id]
        );
        log('info', 'job_completed', { jobId: job.id, jobType: job.job_type, durationMs });
      } else {
        await handleJobFailure(job, result.errorMessage ?? 'Connector returned failure');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Sentry.withScope((scope) => {
        scope.setContext('job', { id: job.id, job_type: job.job_type, client_id: job.client_id, operator_id: job.operator_id, retry_count: job.retry_count });
        Sentry.captureException(err);
      });
      await handleJobFailure(job, msg);
    }
  }

  async function handleJobFailure(job: JobRecord, errorMessage: string): Promise<void> {
    const newRetryCount = job.retry_count + 1;
    if (job.retry_count < job.max_retries) { // compare pre-increment value; newRetryCount is used for the DB write
      const backoffSeconds = Math.pow(2, newRetryCount) * 60;
      await pool.query(
        `UPDATE jobs SET status = 'retrying', retry_count = $1, error_message = $2,
          scheduled_at = NOW() + ($3 || ' seconds')::interval, updated_at = NOW() WHERE id = $4`,
        [newRetryCount, errorMessage, backoffSeconds, job.id]
      );
      log('warn', 'job_retrying', { jobId: job.id, retryCount: newRetryCount, backoffSeconds });
    } else {
      await pool.query(
        `UPDATE jobs SET status = 'failed', retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
        [newRetryCount, errorMessage, job.id]
      );
      log('error', 'job_failed_permanent', { jobId: job.id, jobType: job.job_type, retryCount: newRetryCount });
    }
  }
  ```

### Task 8: Create Cron Module — src/cron.ts (AC: #3)
- [x] Use `node-cron` to create daily browser jobs at 06:00 CLT:
  ```typescript
  // src/cron.ts
  import cron from 'node-cron';
  import { pool } from './db';
  import { log } from './logger';

  export function startCron(): void {
    // CLT = UTC-4 (standard), CLST = UTC-3 (daylight saving). node-cron handles DST automatically via America/Santiago.
    // Use timezone option to avoid manual UTC calculation — do NOT hardcode UTC offset.
    cron.schedule('0 6 * * *', createDailyBrowserJobs, { timezone: 'America/Santiago' });
    log('info', 'cron_registered', { schedule: '0 6 * * * (America/Santiago)' });
  }

  async function createDailyBrowserJobs(): Promise<void> {
    log('info', 'cron_daily_jobs_start');
    try {
      // Find all active browser clients
      const { rows: clients } = await pool.query(
        `SELECT id, operator_id FROM tenant_clients WHERE is_active = true AND connector_type = 'browser'`
      );
      log('info', 'cron_clients_found', { count: clients.length });

      for (const client of clients) {
        // Deduplication: skip if a job already exists today for this client
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const { rows: existing } = await pool.query(
          `SELECT id FROM jobs
           WHERE client_id = $1
             AND status IN ('pending', 'running', 'retrying', 'completed')
             AND created_at >= $2::date
             AND created_at < ($2::date + interval '1 day')`,
          [client.id, today]
        );
        // Uses `created_at` (not `scheduled_at`) for deduplication — retried jobs have their `scheduled_at` bumped by backoff, which would pollute date-based checks.
        if (existing.length > 0) {
          log('debug', 'cron_job_exists_skip', { clientId: client.id });
          continue;
        }
        // Note: `updated_at` has DEFAULT NOW() so it's auto-filled on INSERT; the set_updated_at() trigger only fires on UPDATE.
        await pool.query(
          `INSERT INTO jobs (id, operator_id, client_id, job_type, status, priority, scheduled_at, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'browser', 'pending', 5, NOW(), NOW())`,
          [client.operator_id, client.id]
        );
        log('info', 'cron_job_created', { clientId: client.id, operatorId: client.operator_id });
      }
    } catch (err) {
      log('error', 'cron_daily_jobs_error', { error: String(err) });
    }
  }
  ```

### Task 9: Create n8n Monitoring Workflow (AC: #6)
- [ ] Create n8n workflow "aureon-monitoring" that runs on a schedule (every 15 min):
  - **Node 1 — Poll failed jobs:** PostgreSQL query:
    ```sql
    SELECT j.id, j.job_type, j.error_message, j.retry_count, tc.name AS client_name
    FROM jobs j
    JOIN tenant_clients tc ON j.client_id = tc.id
    WHERE j.status = 'failed'
      AND j.updated_at >= NOW() - interval '15 minutes'
    ```
  - **Node 2 — Alert if results:** If rows > 0, send notification with job details
  - **Node 3 — Check stale completed jobs:** Query for expected connectors with no 'completed' job in > 25 hours (warn)
  - **Node 4 — Disk usage check:** SSH Command node (or HTTP node calling VPS endpoint) to get `df -h /` output. Alert if > 80%, vacuum if > 90%.
  - **Node 5 — Auto-cleanup at 90%:** Execute via SSH: `journalctl --vacuum-size=500M`
  - **Node 6 — Stuck running jobs check:** PostgreSQL query:
    ```sql
    SELECT id, job_type, client_id, started_at
    FROM jobs
    WHERE status = 'running'
      AND started_at < NOW() - interval '30 minutes'
    ```
    If rows > 0: send alert. Optionally reset status to 'retrying' and clear started_at so the poll loop can reclaim the job.
- [ ] Export workflow JSON from n8n UI
- [ ] Save to: `apps/worker/n8n/workflows/aureon-monitoring.json`
- [ ] Commit for version control

### Task 10: Verify systemd Service Configuration (AC: #5, #8)
- [ ] Confirm `aureon-worker.service` exists on VPS at `/etc/systemd/system/aureon-worker.service`
- [ ] Required unit file content (create if missing — do NOT modify SSH/UFW/fail2ban):
  ```ini
  [Unit]
  Description=Aureon Automation Worker
  After=network.target
  Wants=network-online.target

  [Service]
  Type=simple
  User=aureon
  WorkingDirectory=/home/aureon/aureon-last-mile/apps/worker
  EnvironmentFile=/home/aureon/.env
  ExecStart=/usr/bin/node dist/index.js
  Restart=always
  RestartSec=5
  StandardOutput=journal
  StandardError=journal
  SyslogIdentifier=aureon-worker

  [Install]
  WantedBy=multi-user.target
  ```
- [ ] `sudo systemctl daemon-reload && sudo systemctl enable aureon-worker`
- [ ] Verify: `sudo systemctl status aureon-worker`

### Task 11: Add BetterStack Heartbeat (AC: #6)
- [x] Add a heartbeat ping to BetterStack after each successful poll cycle (or every N successful cycles)
- [x] BetterStack heartbeat URL stored in `BETTERSTACK_HEARTBEAT_URL` env var
- [x] If no heartbeat in > 5 minutes, BetterStack alerts on its own (VPS uptime monitoring)
- [x] Add `BETTERSTACK_HEARTBEAT_URL` to `apps/worker/.env.example`
- [x] Add `WORKER_POLL_INTERVAL_MS` to `apps/worker/.env.example` (default: 30000) — already existed

### Task 12: Update TypeScript Configuration (AC: #1–#10)
- [x] Verify `apps/worker/tsconfig.json` has correct settings (target ES2022, module CommonJS for Node.js):
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "module": "commonjs",
      "outDir": "dist",
      "rootDir": "src",
      "strict": true,
      "esModuleInterop": true,
      "resolveJsonModule": true,
      "skipLibCheck": true
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```
- [x] Run `npm run typecheck` — must pass with zero errors before merging

### Task 13: End-to-End Test (AC: all)
- [ ] Deploy to VPS via feature branch PR → CI merge → auto-deploy
- [ ] Verify: `sudo journalctl -u aureon-worker -f` shows structured JSON logs
- [ ] Verify: poll cycle runs every 30s with `poll_no_jobs` event (quiet log at debug level)
- [ ] Manually insert a test job into jobs table with `job_type='csv_email'`, verify worker claims and completes it
- [ ] Manually insert a test job with `job_type='unknown_test'`, verify worker marks it 'failed' immediately (no retry)
- [ ] Manually insert a failing job (use a mock executor or override), verify retry backoff and eventual 'failed' state
- [ ] Verify: Sentry captures exceptions with job context (check Sentry dashboard)
- [ ] Verify: cron fires at 06:00 CLT (or trigger manually by calling `createDailyBrowserJobs()`) and creates jobs for Paris
- [ ] Verify: `sudo systemctl status aureon-worker` shows active (running)
- [ ] Simulate process kill (`sudo systemctl kill aureon-worker`), verify systemd auto-restarts within 5 seconds

---

## Dev Notes

### Architecture Context

**System topology for this story:**
```
systemd (VPS 187.77.48.107)
  └── aureon-worker.service (Node.js process, user: aureon)
        ├── Poll loop (every 30s) → Supabase DB (SUPABASE_DB_* direct connection)
        │     └── FOR UPDATE SKIP LOCKED → claim job → dispatch by job_type
        │           ├── 'browser'   → browser connector (Story 2.6 stub here)
        │           └── 'csv_email' → status ack only (n8n is actual executor)
        └── Cron (node-cron, 06:00 CLT) → INSERT jobs for active browser clients

n8n (Docker on VPS, https://n8n.tractis.ai)
  ├── csv_email workflows (Story 2.5) — creates + updates jobs table independently
  └── aureon-monitoring workflow (THIS story, Task 9)
        ├── Poll failed jobs → alert
        ├── Disk usage check → alert at 80%, vacuum at 90%
        └── Stale connector check → warn

GitHub Actions (deploy.yml, self-hosted runner on VPS)
  └── deploy-worker job → apps/worker/scripts/deploy.sh (ALREADY EXISTS — no changes needed)
```

**Key design decision — worker vs n8n responsibility boundary:**
- The worker does NOT execute n8n workflows. n8n is a separate Docker process.
- n8n handles csv_email jobs end-to-end (Story 2.5). It creates the job, processes email, updates job status.
- The worker handles browser jobs (Story 2.6) end-to-end. It creates daily jobs (cron), executes the browser connector, updates job status.
- The worker DOES poll all job_types. If it finds a csv_email job in 'pending'/'retrying' (e.g., n8n failed to update status), it acknowledges it and marks it complete (monitoring/safety net, not re-execution).

### Database Schema (Story 2.4 — already applied, NO new migrations needed)

**Jobs table key fields for this story:**

| Column | Type | Purpose |
|--------|------|---------|
| `status` | `job_status_enum` | 'pending','running','completed','failed','retrying' |
| `priority` | INT default 5 | Higher priority polled first |
| `scheduled_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | When to execute; future = deferred. NOT NULL — `IS NULL` guard in poll query is defensive only and never matches. |
| `started_at` | TIMESTAMPTZ nullable | Set when worker claims job |
| `completed_at` | TIMESTAMPTZ nullable | Set on success |
| `retry_count` | INT default 0 | Incremented on each failure |
| `max_retries` | INT default 3 | Threshold for permanent failure |
| `result` | JSONB nullable | Success result data |
| `error_message` | TEXT nullable | Last error |
| `updated_at` | TIMESTAMPTZ | Auto-updated by set_updated_at() trigger |

**Partial index for worker polling (already exists from Story 2.4):**
```sql
CREATE INDEX idx_jobs_worker_poll ON jobs (status, priority DESC, scheduled_at)
  WHERE status IN ('pending', 'retrying');
```
This makes the poll query O(log n) regardless of total jobs table size.

**Seed data already present:**
- Transportes Musan operator (slug: `transportes-musan`)
- Easy tenant_client (slug: `easy`, connector_type: `csv_email`, is_active: true)
- Paris tenant_client (slug: `paris`, connector_type: `browser`, is_active: true)

### Environment Variables

All already documented in `apps/worker/.env.example`. Variables used by this story:

| Variable | Source | Purpose |
|----------|--------|---------|
| `SUPABASE_DB_HOST` | Supabase Dashboard → DB Settings | Direct PG connection for FOR UPDATE SKIP LOCKED |
| `SUPABASE_DB_PORT` | Same | Usually 5432 |
| `SUPABASE_DB_NAME` | Same | Usually `postgres` |
| `SUPABASE_DB_USER` | Same | Usually `postgres` |
| `SUPABASE_DB_PASSWORD` | Same | DB password |
| `WORKER_POLL_INTERVAL_MS` | .env | Default 30000 (30s) |
| `SENTRY_DSN` | Sentry → aureon-worker project | Error capture |
| `NODE_ENV` | .env | `production` on VPS |
| `BETTERSTACK_HEARTBEAT_URL` | BetterStack → Monitors | Heartbeat ping URL — ADD to .env.example |

**CRITICAL:** The worker uses `SUPABASE_DB_*` (direct PostgreSQL connection) — NOT `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. The Supabase JS client does not support `FOR UPDATE SKIP LOCKED`. The `pg` npm package is required.

### Existing Infrastructure (no changes needed)

**deploy.sh** (`apps/worker/scripts/deploy.sh`): Already handles disk check, git pull, npm ci, npm run build, npm prune, systemctl restart, health check, rollback on failure. No changes needed.

**deploy.yml** (`.github/workflows/deploy.yml`): Already has `deploy-worker` job that runs on VPS self-hosted runner, detects `apps/worker/` changes, calls deploy.sh. No changes needed.

**n8n**: Runs as Docker container. DO NOT modify the container or its configuration. The monitoring workflow (Task 9) is created via the n8n web UI.

### Current State of apps/worker/src/index.ts

The file is a 4-line placeholder:
```typescript
// Aureon Automation Worker
// Placeholder — actual implementation in Story 2.7
// This process will become the job queue orchestrator for data ingestion connectors.
console.log(`Aureon worker starting... (v0.1.0 - ${new Date().toISOString()})`);
```
This story replaces it entirely with the real worker implementation.

### File Structure After This Story

```
apps/worker/
├── src/
│   ├── index.ts              ← REPLACE placeholder with real bootstrap
│   ├── db.ts                 ← NEW: pg.Pool with exponential backoff
│   ├── logger.ts             ← NEW: structured JSON logger
│   ├── poller.ts             ← NEW: poll loop + claim + execute + retry
│   ├── cron.ts               ← NEW: node-cron daily job creation
│   └── connectors/
│       ├── types.ts          ← NEW: ConnectorExecutor interface + JobRecord
│       ├── index.ts          ← NEW: connector registry (csv_email only; browser stub)
│       └── csv-email.ts      ← NEW: csv_email monitoring stub
├── n8n/workflows/
│   ├── easy-csv-import.json  ← EXISTS (Story 2.5)
│   └── aureon-monitoring.json ← NEW (Task 9)
├── scripts/
│   └── deploy.sh             ← EXISTS — no changes
├── package.json              ← UPDATE: add pg, @sentry/node, node-cron + types
├── package-lock.json         ← UPDATE: regenerated
├── tsconfig.json             ← VERIFY/UPDATE if needed
└── .env.example              ← UPDATE: add BETTERSTACK_HEARTBEAT_URL
```

### Previous Story Intelligence

**From Story 2.4 (DB schema):**
- `jobs.updated_at` has auto-update trigger `set_updated_at()` — but always include `updated_at = NOW()` in UPDATE queries for explicitness and to avoid relying on trigger timing
- `job_status_enum` values: 'pending', 'running', 'completed', 'failed', 'retrying'
- `connector_type_enum` values: 'csv_email', 'api', 'browser'
- RLS is enabled on jobs table — but the worker connects as `postgres` user (via SUPABASE_DB_*) which bypasses RLS. This is correct for server-side automation.

**From Story 2.3 (VPS + n8n):**
- VPS IP: 187.77.48.107, user: aureon
- n8n at https://n8n.tractis.ai (port 5678 internally)
- Sentry and BetterStack already configured (DSN in VPS .env)

**From Story 2.5 (CSV/email connector):**
- n8n creates csv_email jobs in the jobs table independently
- The worker is NOT involved in csv_email execution — n8n handles it completely
- jobs table is the single source of truth for job status across both worker and n8n

**From deploy pipeline tests (commit 5657df7):**
- Self-hosted runner on VPS is working
- deploy.sh is working and tested
- apps/worker/ change detection in deploy.yml is working

### Git Intelligence

Recent commits:
```
f091943 chore: add CI confirmation and VPS SSH rules to CLAUDE.md
79c085c review(story-2.3): fix 9 code review issues (3H, 3M, 3L)
5657df7 chore: test worker deploy pipeline (#9)
65d8929 feat(story-2.4): create automation worker database schema (#7)
22a0d05 chore: test auto-merge pipeline (#5)
```

Branch convention: `feat/story-2-7-job-queue-orchestration`

### What NOT To Do

- **Do NOT** create database migrations — the jobs, tenant_clients, raw_files tables and all enums already exist from Story 2.4.
- **Do NOT** modify n8n Docker container or its configuration.
- **Do NOT** modify SSH config, UFW firewall rules, or fail2ban on the VPS (187.77.48.107). This was explicitly flagged in CLAUDE.md.
- **Do NOT** implement the actual browser connector logic — that is Story 2.6. Create the `ConnectorExecutor` interface and registry, but leave the browser executor as a stub (`throw new Error('Browser connector not implemented — see Story 2.6')`).
- **Do NOT** modify `.github/workflows/deploy.yml` — it already handles worker deployment correctly.
- **Do NOT** modify `apps/worker/scripts/deploy.sh` — it already handles deployment correctly.
- **Do NOT** use the Supabase JS client (`@supabase/supabase-js`) for job polling. It does not support `FOR UPDATE SKIP LOCKED`. Use the `pg` package with direct DB credentials.
- **Do NOT** have the worker execute n8n workflows or trigger n8n via API. They are independent processes.
- **Do NOT** push directly to `main`. Use `feat/story-2-7-job-queue-orchestration` branch, open PR, let CI pass, auto-merge.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7] — acceptance criteria and technical requirements
- [Source: _bmad-output/implementation-artifacts/2-4-create-automation-worker-database-schema.md] — DB schema, enums, seed data
- [Source: _bmad-output/implementation-artifacts/2-5-implement-easy-csv-email-connector.md] — n8n pattern, worker/n8n boundary
- [Source: apps/worker/scripts/deploy.sh] — deployment script (no changes needed)
- [Source: apps/worker/.env.example] — environment variables reference
- [Source: .github/workflows/deploy.yml] — CI/CD deploy pipeline (no changes needed)
- [Source: apps/worker/src/index.ts] — placeholder to replace

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- npm audit: 1 upstream `minimatch` vuln in `@sentry/node` transitive dep — not actionable, Sentry hasn't patched yet

### Completion Notes List

- Task 1: Installed pg@8.18.0, @sentry/node@9.47.1, node-cron@4.2.1 + type deps. Added vitest for testing.
- Task 2: Replaced placeholder index.ts with real bootstrap: Sentry init, DB connect, cron registration, poll loop start, SIGTERM/SIGINT graceful shutdown.
- Task 3: Created db.ts with pg.Pool, exponential backoff (5 attempts: 1,2,4,8,16s), SSL for Supabase, closeDb export.
- Task 4: Created logger.ts — structured JSON to stdout (journald captures), sleep helper.
- Task 5: Created connectors/types.ts — JobRecord, JobResult, ConnectorExecutor interfaces.
- Task 6: Created connectors/csv-email.ts — status ack stub (n8n is actual executor).
- Task 7: Created poller.ts — poll loop with FOR UPDATE SKIP LOCKED, claim→execute→update cycle, retry with exponential backoff, BetterStack heartbeat, Sentry error capture with job context.
- Task 8: Created cron.ts — node-cron 06:00 America/Santiago, creates browser jobs for active clients, deduplication check.
- Task 9: PENDING — requires VPS/n8n UI access to create monitoring workflow.
- Task 10: PENDING — requires VPS SSH access to verify/create systemd service.
- Task 11: Added BETTERSTACK_HEARTBEAT_URL to .env.example, heartbeat ping in poll loop.
- Task 12: Verified tsconfig.json (ES2022, commonjs), typecheck passes with 0 errors.
- Task 13: PENDING — requires VPS deployment for E2E verification.
- Tests: 22 unit tests across 6 test files, all passing. 363 frontend tests — 0 regressions.

### Change Log

- 2026-02-23: Implemented Tasks 1-8, 11-12 — core worker orchestration (poll loop, cron, connectors, logger, DB, Sentry, heartbeat). 22 tests passing.

### File List

- apps/worker/package.json (MODIFIED — added pg, @sentry/node, node-cron, vitest, type deps, test scripts)
- apps/worker/package-lock.json (MODIFIED — regenerated)
- apps/worker/src/index.ts (MODIFIED — replaced placeholder with real worker bootstrap)
- apps/worker/src/db.ts (NEW — PostgreSQL pool with exponential backoff)
- apps/worker/src/logger.ts (NEW — structured JSON logger + sleep)
- apps/worker/src/poller.ts (NEW — poll loop, claim, execute, retry, heartbeat)
- apps/worker/src/cron.ts (NEW — daily browser job creation at 06:00 CLT)
- apps/worker/src/connectors/types.ts (NEW — JobRecord, JobResult, ConnectorExecutor)
- apps/worker/src/connectors/index.ts (NEW — connector registry)
- apps/worker/src/connectors/csv-email.ts (NEW — csv_email status ack stub)
- apps/worker/src/logger.test.ts (NEW — 4 tests)
- apps/worker/src/db.test.ts (NEW — 4 tests)
- apps/worker/src/poller.test.ts (NEW — 6 tests)
- apps/worker/src/cron.test.ts (NEW — 5 tests)
- apps/worker/src/connectors/csv-email.test.ts (NEW — 1 test)
- apps/worker/src/connectors/index.test.ts (NEW — 2 tests)
- apps/worker/.env.example (MODIFIED — added BETTERSTACK_HEARTBEAT_URL)
