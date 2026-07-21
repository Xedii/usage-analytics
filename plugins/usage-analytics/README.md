# Usage Analytics

The usage analytics plugin provides first-party, privacy-conscious analytics
for a Backstage installation. It collects events already emitted through the
Backstage Analytics API, reports online presence, and exposes an administrative
dashboard at `/usage-analytics`.

Add the frontend plugin to an app using the new frontend system:

```ts
import usageAnalyticsPlugin from '@backstage/plugin-usage-analytics';

const app = createApp({
  features: [usageAnalyticsPlugin],
});
```

Apps using the legacy frontend system should install
`@backstage/plugin-usage-analytics-legacy` instead.

The plugin buffers analytics events in the browser and sends presence
heartbeats independently. User identity is never accepted from the browser; it
is resolved by the backend from Backstage credentials.

The browser sends a heartbeat every 30 seconds. Each open tab has its own
session identifier.
