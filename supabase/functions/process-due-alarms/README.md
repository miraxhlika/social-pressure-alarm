# Due alarm worker deployment

Deploy `process-due-alarms` with `DUE_ALARM_WORKER_SECRET` configured. The database migration deliberately does not enable a cron job; enable it only after the occurrence-aware mobile build is the minimum supported version.

Invoke the function once per minute with the header:

```text
x-worker-secret: <DUE_ALARM_WORKER_SECRET>
```

For hosted Supabase, use Supabase Cron to issue an HTTP POST to the deployed Edge Function URL. Store both the URL and worker secret in Vault rather than embedding either value in a migration. The worker claims at most 100 overdue alarms and consumes at most 100 outbox records per invocation; retries are safe because occurrence, outbox, and per-device delivery keys are unique.
