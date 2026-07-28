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
import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import {
  OnlineUsageUsersResponse,
  UsageActivityResponse,
  UsageEventTypesResponse,
  UsageOverview,
  UsagePagesResponse,
  UsagePluginsResponse,
  UsagePresenceSummary,
  UsageSessionsResponse,
  UsageTimeseries,
  UsageTimeseriesInterval,
  UsageUsersResponse,
} from '@backstage/plugin-usage-analytics-common';
import {
  UsageActivityOptions,
  UsageAnalyticsApi,
  OnlineUsageUsersOptions,
  UsageCsvExport,
  UsageExportOptions,
  UsagePagesOptions,
  UsagePluginsOptions,
  UsageReportFilters,
  UsageSessionsOptions,
  UsageUsersOptions,
} from './UsageAnalyticsApi';

/** @public */
export class UsageAnalyticsClient implements UsageAnalyticsApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly fetchApi: FetchApi,
  ) {}

  getOverview(options?: UsageReportFilters) {
    return this.get<UsageOverview>('/v1/overview', options);
  }

  getTimeseries(
    interval: UsageTimeseriesInterval,
    options?: UsageReportFilters,
  ) {
    return this.get<UsageTimeseries>('/v1/timeseries', {
      ...options,
      interval,
    });
  }

  getPages(options?: UsagePagesOptions) {
    return this.get<UsagePagesResponse>('/v1/pages', options);
  }

  getPlugins(options?: UsagePluginsOptions) {
    return this.get<UsagePluginsResponse>('/v1/plugins', options);
  }

  getUsers(options?: UsageUsersOptions) {
    return this.get<UsageUsersResponse>('/v1/users', options);
  }

  getActivity(options?: UsageActivityOptions) {
    return this.get<UsageActivityResponse>('/v1/activity', options);
  }

  getSessions(options?: UsageSessionsOptions) {
    return this.get<UsageSessionsResponse>('/v1/sessions', options);
  }

  getEventTypes(options?: UsageReportFilters) {
    return this.get<UsageEventTypesResponse>('/v1/event-types', options);
  }

  getPresenceSummary() {
    return this.get<UsagePresenceSummary>('/v1/presence/summary');
  }

  getOnlineUsers(options?: OnlineUsageUsersOptions) {
    return this.get<OnlineUsageUsersResponse>('/v1/presence/online', options);
  }

  async exportCsv(
    options: UsageExportOptions,
    signal?: AbortSignal,
  ): Promise<UsageCsvExport> {
    const baseUrl = await this.discoveryApi.getBaseUrl('usage-analytics');
    const response = await this.fetchApi.fetch(`${baseUrl}/v1/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal,
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    if (!response.body) {
      throw new Error('CSV export response did not include a body');
    }

    const disposition = response.headers.get('Content-Disposition');
    const filename =
      disposition?.match(/filename="([^"]+)"/)?.[1] ??
      `usage-analytics-${options.dataset}.csv`;
    return {
      content: response.body,
      contentType:
        response.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
      filename,
    };
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
