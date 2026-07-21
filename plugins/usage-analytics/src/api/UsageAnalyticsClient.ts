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
import { DiscoveryApi, FetchApi } from '@backstage/frontend-plugin-api';
import { ResponseError } from '@backstage/errors';
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
  UsageUsersResponse,
} from '@backstage/plugin-usage-analytics-common';
import {
  UsageAnalyticsApi,
  UsageReportFilters,
  UsageReportOptions,
} from './UsageAnalyticsApi';

export class UsageAnalyticsClient implements UsageAnalyticsApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly fetchApi: FetchApi,
  ) {}

  getOverview(options?: UsageReportFilters) {
    return this.get<UsageOverview>('/v1/overview', options);
  }

  getTimeseries(
    interval: 'hour' | 'day' | 'week',
    options?: UsageReportFilters,
  ) {
    return this.get<UsageTimeseries>('/v1/timeseries', {
      ...options,
      interval,
    });
  }

  getPages(options?: UsageReportOptions) {
    return this.get<UsagePagesResponse>('/v1/pages', options);
  }

  getPlugins(options?: UsageReportOptions) {
    return this.get<UsagePluginsResponse>('/v1/plugins', options);
  }

  getUsers(options?: UsageReportOptions) {
    return this.get<UsageUsersResponse>('/v1/users', options);
  }

  getActivity(options?: Parameters<UsageAnalyticsApi['getActivity']>[0]) {
    return this.get<UsageActivityResponse>('/v1/activity', options);
  }

  getSessions(options?: UsageReportOptions) {
    return this.get<UsageSessionsResponse>('/v1/sessions', options);
  }

  getSession(sessionId: string) {
    return this.get<UsageSession>(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  getEventTypes(options?: UsageReportFilters) {
    return this.get<UsageEventTypesResponse>('/v1/event-types', options);
  }

  getPresenceSummary() {
    return this.get<UsagePresenceSummary>('/v1/presence/summary');
  }

  getOnlineUsers(options?: Pick<UsageReportOptions, 'limit' | 'offset'>) {
    return this.get<OnlineUsageUsersResponse>('/v1/presence/online', options);
  }

  private async get<T>(path: string, query?: object): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('usage-analytics');
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await this.fetchApi.fetch(url.toString());
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.json() as Promise<T>;
  }
}
