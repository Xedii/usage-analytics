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
import { analyticsApiRef } from '@backstage/core-plugin-api';
import { usageAnalyticsApiRef } from '@backstage/plugin-usage-analytics';
import {
  UsageAnalyticsPage,
  usageAnalyticsCollectorApi,
  usageAnalyticsPlugin,
} from './plugin';

describe('usage-analytics-legacy', () => {
  it('registers the legacy plugin, page, and APIs', () => {
    expect(usageAnalyticsPlugin.getId()).toBe('usage-analytics');
    expect(usageAnalyticsPlugin.routes.root).toBeDefined();
    expect(
      [...usageAnalyticsPlugin.getApis()].map(factory => factory.api),
    ).toEqual([usageAnalyticsApiRef]);
    expect(usageAnalyticsCollectorApi.api).toBe(analyticsApiRef);
    expect(UsageAnalyticsPage).toBeDefined();
  });
});
