# Usage Analytics Legacy

The legacy frontend integration collects Backstage Analytics API events,
reports online presence, and provides the usage analytics dashboard for apps
created with `@backstage/app-defaults`.

Add the plugin to the legacy app:

```tsx
import {
  UsageAnalyticsPage,
  usageAnalyticsPlugin,
} from '@backstage/plugin-usage-analytics-legacy';

const app = createApp({
  plugins: [usageAnalyticsPlugin],
});
```

Mount the dashboard in the app routes:

```tsx
<Route path="/usage-analytics" element={<UsageAnalyticsPage />} />
```

The plugin registers the report client and the usage analytics collector. If
the app explicitly supplies another implementation of `analyticsApiRef`, use
`MultipleAnalyticsApi` to forward events to both implementations.

The backend setup is shared with the new frontend integration:

```ts
backend.add(import('@backstage/plugin-usage-analytics-backend'));
```
