/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  ApiBlueprint,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { AnalyticsImplementationBlueprint } from '@backstage/plugin-app-react';
import { UsageAnalyticsClient } from './api/UsageAnalyticsClient';
import { UsageAnalyticsCollector } from './api/UsageAnalyticsCollector';
import { usageAnalyticsApiRef } from './api/UsageAnalyticsApi';
import { rootRouteRef } from './routes';

/**
 * API extension for querying usage analytics reports.
 *
 * @public
 */
export const usageAnalyticsApi = ApiBlueprint.make({
  params: define =>
    define({
      api: usageAnalyticsApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new UsageAnalyticsClient(discoveryApi, fetchApi),
    }),
});

/**
 * Analytics implementation that records Backstage frontend events.
 *
 * @public
 */
export const usageAnalyticsImplementation =
  AnalyticsImplementationBlueprint.make({
    name: 'usage-analytics',
    params: define =>
      define({
        deps: {
          discoveryApi: discoveryApiRef,
          fetchApi: fetchApiRef,
        },
        factory: ({ discoveryApi, fetchApi }) =>
          new UsageAnalyticsCollector({
            discoveryApi,
            fetchApi,
          }),
      }),
  });

/**
 * Page extension for the usage analytics dashboard.
 *
 * @public
 */
export const usageAnalyticsPage = PageBlueprint.make({
  params: {
    path: '/usage-analytics',
    routeRef: rootRouteRef,
    title: 'Usage analytics',
    loader: () =>
      import('./components/UsageAnalyticsPage/UsageAnalyticsPage').then(m => (
        <m.UsageAnalyticsPageWithPermission />
      )),
  },
});

/**
 * Usage analytics frontend plugin.
 *
 * @public
 */
export const usageAnalyticsPlugin = createFrontendPlugin({
  pluginId: 'usage-analytics',
  title: 'Usage analytics',
  info: { packageJson: () => import('../package.json') },
  extensions: [
    usageAnalyticsApi,
    usageAnalyticsImplementation,
    usageAnalyticsPage,
  ],
  routes: { root: rootRouteRef },
});
