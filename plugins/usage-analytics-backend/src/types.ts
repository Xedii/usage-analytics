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

export interface DateRange {
  from: Date;
  to: Date;
}

export interface Paging {
  limit: number;
  offset: number;
}

export interface ReportQuery extends DateRange {
  userEntityRef?: string;
  action?: string;
  path?: string;
  pluginId?: string;
}

export interface ActivityQuery extends ReportQuery, Paging {
  sessionId?: string;
}

export interface StoredUsageEvent {
  eventId: string;
  occurredAt: Date;
  receivedAt: Date;
  userEntityRef: string;
  sessionId: string;
  action: string;
  subject?: string;
  value?: number;
  pluginId?: string;
  extensionId?: string;
  currentPath: string;
  previousPath?: string;
}

export interface StoredPresence {
  sessionId: string;
  userEntityRef: string;
  currentPath: string;
  seenAt: Date;
}

export interface AnalyticsStore {
  recordEvents(events: StoredUsageEvent[]): Promise<void>;
  updatePresence(presence: StoredPresence): Promise<void>;
  getOverview(range: ReportQuery): Promise<UsageOverview>;
  getTimeseries(
    range: ReportQuery,
    interval: UsageTimeseriesInterval,
  ): Promise<UsageTimeseries>;
  getPages(range: ReportQuery, paging: Paging): Promise<UsagePagesResponse>;
  getPlugins(range: ReportQuery, paging: Paging): Promise<UsagePluginsResponse>;
  getUsers(range: ReportQuery, paging: Paging): Promise<UsageUsersResponse>;
  getActivity(query: ActivityQuery): Promise<UsageActivityResponse>;
  getSessions(
    range: ReportQuery,
    paging: Paging,
  ): Promise<UsageSessionsResponse>;
  getSession(sessionId: string): Promise<UsageSession>;
  getEventTypes(range: ReportQuery): Promise<UsageEventTypesResponse>;
  getPresenceSummary(onlineAfter: Date): Promise<UsagePresenceSummary>;
  getOnlineUsers(
    onlineAfter: Date,
    paging: Paging,
  ): Promise<OnlineUsageUsersResponse>;
  deleteExpiredData(options: {
    eventsBefore: Date;
    presenceBefore: Date;
  }): Promise<{ events: number; presence: number }>;
}
