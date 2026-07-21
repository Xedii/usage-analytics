# Usage Analytics Backend

The backend stores sanitized usage events and ephemeral online presence in two
database tables. Reports are calculated on demand without queues or aggregate
tables.

```ts
backend.add(import('@backstage/plugin-usage-analytics-backend'));
```

PostgreSQL is recommended for production. SQLite is supported for local
development and tests.

```yaml
usageAnalytics:
  retention:
    eventsDays: 90
    presenceHours: 24
```

The plugin registers `usage-analytics.aggregates.read` and
`usage-analytics.details.read`. Writes require an authenticated user, while
detailed reports require the latter permission.

An online user has sent a heartbeat in the last 90 seconds. Background tabs
remain online while they continue to communicate with Backstage. Session
summaries and timelines use the complete event history.
