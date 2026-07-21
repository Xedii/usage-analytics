# Usage Analytics Legacy

The legacy frontend integration collects Backstage Analytics API events,
reports online presence, and provides the usage analytics dashboard for apps
created with `@backstage/app-defaults`.

Add the plugin to the legacy app:

```tsx
import {
  UsageAnalyticsPage,
  usageAnalyticsCollectorApi,
  usageAnalyticsPlugin,
} from '@backstage/plugin-usage-analytics-legacy';

const app = createApp({
  apis: [usageAnalyticsCollectorApi],
  plugins: [usageAnalyticsPlugin],
});
```

Mount the dashboard in the app routes:

```tsx
<Route path="/usage-analytics" element={<UsageAnalyticsPage />} />
```

The plugin registers the report client. The collector is passed through the
app-level `apis` option so that it replaces the default no-op analytics API. If
the app already supplies another implementation of `analyticsApiRef`, use
`MultipleAnalyticsApi` to forward events to both implementations.

The backend setup is shared with the new frontend integration:

```ts
backend.add(import('@backstage/plugin-usage-analytics-backend'));
```
