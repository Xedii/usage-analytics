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
import { ApiRef, createApiRef } from '@backstage/core-plugin-api';
import {
  OnlineUsageUsersResponse,
  UsageActivityResponse,
  UsageEventTypesResponse,
  UsageOverview,
  UsagePagesResponse,
  UsagePluginsResponse,
  UsagePresenceSummary,
  UsageSession,
  UsageSessionsResponse,
  UsageTimeseries,
  UsageTimeseriesInterval,
  UsageUsersResponse,
} from '@backstage/plugin-usage-analytics-common';

/**
 * Options shared by usage analytics report requests.
 *
 * @public
 */
export interface UsageReportOptions {
  from?: string;
  to?: string;
  userEntityRef?: string;
  path?: string;
  pluginId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

/**
 * Filters shared by non-paginated usage analytics reports.
 *
 * @public
 */
export type UsageReportFilters = Omit<UsageReportOptions, 'limit' | 'offset'>;

/**
 * Read-only client API for the usage analytics backend.
 *
 * @public
 */
export interface UsageAnalyticsApi {
  getOverview(options?: UsageReportFilters): Promise<UsageOverview>;
  getTimeseries(
    interval: UsageTimeseriesInterval,
    options?: UsageReportFilters,
  ): Promise<UsageTimeseries>;
  getPages(options?: UsageReportOptions): Promise<UsagePagesResponse>;
  getPlugins(options?: UsageReportOptions): Promise<UsagePluginsResponse>;
  getUsers(options?: UsageReportOptions): Promise<UsageUsersResponse>;
  getActivity(
    options?: UsageReportOptions & { sessionId?: string },
  ): Promise<UsageActivityResponse>;
  getSessions(options?: UsageReportOptions): Promise<UsageSessionsResponse>;
  getSession(sessionId: string): Promise<UsageSession>;
  getEventTypes(options?: UsageReportFilters): Promise<UsageEventTypesResponse>;
  getPresenceSummary(): Promise<UsagePresenceSummary>;
  getOnlineUsers(
    options?: Pick<UsageReportOptions, 'limit' | 'offset'>,
  ): Promise<OnlineUsageUsersResponse>;
}

/** @public */
export const usageAnalyticsApiRef: ApiRef<UsageAnalyticsApi> = createApiRef({
  id: 'plugin.usage-analytics.service',
});
