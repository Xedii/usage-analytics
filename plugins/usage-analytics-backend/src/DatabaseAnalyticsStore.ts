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
  DatabaseService,
  resolvePackagePath,
} from '@backstage/backend-plugin-api';
import { ConflictError, NotFoundError } from '@backstage/errors';
import {
  OnlineUsageUser,
  UsageActivityItem,
  UsageEventType,
  UsagePage,
  UsagePlugin,
  UsageSessionSummary,
  UsageTimeseriesInterval,
  UsageTimeseriesPoint,
  UsageUser,
} from '@backstage/plugin-usage-analytics-common';
import { Knex } from 'knex';
import {
  ActivityQuery,
  AnalyticsStore,
  Paging,
  ReportQuery,
  StoredPresence,
  StoredUsageEvent,
} from './types';

const migrationsDir = resolvePackagePath(
  '@backstage/plugin-usage-analytics-backend',
  'migrations',
);

type EventRow = {
  event_id: string;
  occurred_at: Date | string | number;
  user_entity_ref: string;
  session_id: string;
  action: string;
  subject: string | null;
  value: number | null;
  plugin_id: string | null;
  extension_id: string | null;
  current_path: string;
  previous_path: string | null;
};

type PresenceRow = {
  session_id: string;
  user_entity_ref: string;
  current_path: string;
  started_at: Date | string | number;
  last_seen_at: Date | string | number;
};

type OverviewRow = {
  event_count: string | number;
  active_users: string | number;
  sessions: string | number;
  page_views: string | number | null;
};

export class DatabaseAnalyticsStore implements AnalyticsStore {
  private readonly isSQLite: boolean;

  private constructor(private readonly db: Knex) {
    this.isSQLite = db.client.config.client.includes('sqlite');
  }

  static async create(options: { database: DatabaseService }) {
    const client = await options.database.getClient();
    if (!options.database.migrations?.skip) {
      await client.migrate.latest({ directory: migrationsDir });
    }
    return new DatabaseAnalyticsStore(client);
  }

  async recordEvents(events: StoredUsageEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.db.transaction(async tx => {
      const first = events[0];
      const last = events.reduce((latest, event) =>
        event.occurredAt > latest.occurredAt ? event : latest,
      );
      await this.assertSessionOwner(tx, {
        sessionId: first.sessionId,
        userEntityRef: first.userEntityRef,
        currentPath: last.currentPath,
        seenAt: first.receivedAt,
        startedAt: new Date(
          Math.min(...events.map(event => event.occurredAt.valueOf())),
        ),
      });

      await tx<EventRow>('usage_events')
        .insert(
          events.map(event => ({
            event_id: event.eventId,
            occurred_at: event.occurredAt,
            user_entity_ref: event.userEntityRef,
            session_id: event.sessionId,
            action: event.action,
            subject: event.subject ?? null,
            value: event.value ?? null,
            plugin_id: event.pluginId ?? null,
            extension_id: event.extensionId ?? null,
            current_path: event.currentPath,
            previous_path: event.previousPath ?? null,
          })),
        )
        .onConflict('event_id')
        .ignore();
    });
  }

  async updatePresence(presence: StoredPresence): Promise<void> {
    await this.db.transaction(async tx => {
      await this.assertSessionOwner(tx, {
        ...presence,
        startedAt: presence.seenAt,
      });
      await tx<PresenceRow>('usage_presence')
        .where({
          session_id: presence.sessionId,
          user_entity_ref: presence.userEntityRef,
        })
        .update({
          current_path: presence.currentPath,
          last_seen_at: presence.seenAt,
        });
    });
  }

  async getOverview(range: ReportQuery) {
    const row = await this.rangeQuery(range)
      .count<{ event_count: string | number }>({ event_count: '*' })
      .countDistinct<{ active_users: string | number }>({
        active_users: 'user_entity_ref',
      })
      .countDistinct<{ sessions: string | number }>({ sessions: 'session_id' })
      .sum<{ page_views: string | number }>({
        page_views: this.db.raw(
          "case when action = 'navigate' then 1 else 0 end",
        ),
      })
      .first<OverviewRow | undefined>();

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      eventCount: this.toNumber(row?.event_count),
      activeUsers: this.toNumber(row?.active_users),
      sessions: this.toNumber(row?.sessions),
      pageViews: this.toNumber(row?.page_views),
    };
  }

  async getTimeseries(range: ReportQuery, interval: UsageTimeseriesInterval) {
    const bucket = this.bucketExpression(interval);
    const rows = await this.rangeQuery(range)
      .select({ bucket })
      .count({ event_count: '*' })
      .countDistinct({
        active_users: 'user_entity_ref',
      })
      .countDistinct({ sessions: 'session_id' })
      .sum({
        page_views: this.db.raw(
          "case when action = 'navigate' then 1 else 0 end",
        ),
      })
      .groupBy('bucket')
      .orderBy('bucket', 'asc');

    const buckets: UsageTimeseriesPoint[] = rows.map(row => ({
      start: this.toISOString(row.bucket),
      eventCount: this.toNumber(row.event_count),
      activeUsers: this.toNumber(row.active_users),
      sessions: this.toNumber(row.sessions),
      pageViews: this.toNumber(row.page_views),
    }));

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      interval,
      buckets,
    };
  }

  async getPages(range: ReportQuery, paging: Paging) {
    const base = this.rangeQuery(range).where('action', 'navigate');
    const totalRow = await base
      .clone()
      .countDistinct<{ total: string | number }>({ total: 'current_path' })
      .first();
    const rows = await base
      .clone()
      .select('current_path')
      .count<{ page_views: string | number }>({ page_views: '*' })
      .countDistinct<{ unique_users: string | number }>({
        unique_users: 'user_entity_ref',
      })
      .max<{ last_viewed_at: Date | string | number }>({
        last_viewed_at: 'occurred_at',
      })
      .groupBy('current_path')
      .orderBy('page_views', 'desc')
      .limit(paging.limit)
      .offset(paging.offset);

    const dwellRows = await this.applyReportFilters(
      this.db<EventRow>('usage_events')
        .where('occurred_at', '>=', range.from)
        .where('occurred_at', '<', range.to)
        .where('action', 'navigate')
        .whereNotNull('previous_path'),
      range,
      'previous_path',
    )
      .select({ path: 'previous_path' })
      .sum<{ duration: string | number }>({ duration: 'value' })
      .groupBy('previous_path');
    const durations = new Map(
      dwellRows.map(row => [row.path, this.toNumber(row.duration)]),
    );

    const items: UsagePage[] = rows.map(row => ({
      path: row.current_path,
      pageViews: this.toNumber(row.page_views),
      uniqueUsers: this.toNumber(row.unique_users),
      estimatedDurationSeconds: Math.round(
        durations.get(row.current_path) ?? 0,
      ),
      lastViewedAt: this.toISOString(row.last_viewed_at),
    }));
    return { items, total: this.toNumber(totalRow?.total) };
  }

  async getUsers(range: ReportQuery, paging: Paging) {
    const base = this.rangeQuery(range);
    const totalRow = await base
      .clone()
      .countDistinct<{ total: string | number }>({ total: 'user_entity_ref' })
      .first();
    const rows = await base
      .clone()
      .select('user_entity_ref')
      .count<{ event_count: string | number }>({ event_count: '*' })
      .countDistinct<{ session_count: string | number }>({
        session_count: 'session_id',
      })
      .min<{ first_seen_at: Date | string | number }>({
        first_seen_at: 'occurred_at',
      })
      .max<{ last_seen_at: Date | string | number }>({
        last_seen_at: 'occurred_at',
      })
      .groupBy('user_entity_ref')
      .orderBy('last_seen_at', 'desc')
      .limit(paging.limit)
      .offset(paging.offset);

    const items: UsageUser[] = rows.map(row => ({
      userEntityRef: row.user_entity_ref,
      eventCount: this.toNumber(row.event_count),
      sessionCount: this.toNumber(row.session_count),
      firstSeenAt: this.toISOString(row.first_seen_at),
      lastSeenAt: this.toISOString(row.last_seen_at),
    }));
    return { items, total: this.toNumber(totalRow?.total) };
  }

  async getActivity(query: ActivityQuery) {
    const base = this.applyActivityFilters(this.rangeQuery(query), query);
    const totalRow = await base
      .clone()
      .count<{ total: string | number }>({ total: '*' })
      .first();
    const rows = await base
      .clone()
      .select<EventRow[]>([
        'event_id',
        'occurred_at',
        'user_entity_ref',
        'session_id',
        'action',
        'subject',
        'value',
        'plugin_id',
        'extension_id',
        'current_path',
        'previous_path',
      ])
      .orderBy('occurred_at', 'desc')
      .limit(query.limit)
      .offset(query.offset);

    return {
      items: rows.map(row => this.mapActivity(row)),
      total: this.toNumber(totalRow?.total),
    };
  }

  async getSession(sessionId: string) {
    const base = this.db<EventRow>('usage_events').where({
      session_id: sessionId,
    });
    const [summary, newestRows] = await Promise.all([
      base
        .clone()
        .select('user_entity_ref')
        .min<{ started_at: Date | string | number }>({
          started_at: 'occurred_at',
        })
        .max<{ last_seen_at: Date | string | number }>({
          last_seen_at: 'occurred_at',
        })
        .groupBy('user_entity_ref')
        .first(),
      base.clone().select().orderBy('occurred_at', 'asc'),
    ]);
    if (!summary || newestRows.length === 0) {
      throw new NotFoundError(`Session '${sessionId}' was not found`);
    }

    const startedAt = new Date(this.toISOString(summary.started_at));
    const lastSeenAt = new Date(this.toISOString(summary.last_seen_at));
    return {
      sessionId,
      userEntityRef: summary.user_entity_ref,
      startedAt: startedAt.toISOString(),
      lastSeenAt: lastSeenAt.toISOString(),
      durationSeconds: Math.max(
        0,
        Math.round((lastSeenAt.valueOf() - startedAt.valueOf()) / 1000),
      ),
      events: newestRows.map(row => this.mapActivity(row)),
    };
  }

  async getSessions(query: ReportQuery, paging: Paging) {
    const base = this.rangeQuery(query);
    const totalRow = await this.db
      .from(
        base
          .clone()
          .select('session_id', 'user_entity_ref')
          .groupBy('session_id', 'user_entity_ref')
          .as('sessions'),
      )
      .count<{ total: string | number }>({ total: '*' })
      .first();
    const rows = await base
      .select('session_id', 'user_entity_ref')
      .min<{ started_at: Date | string | number }>({
        started_at: 'occurred_at',
      })
      .max<{ last_seen_at: Date | string | number }>({
        last_seen_at: 'occurred_at',
      })
      .count<{ event_count: string | number }>({ event_count: '*' })
      .groupBy('session_id', 'user_entity_ref')
      .orderBy('last_seen_at', 'desc')
      .limit(paging.limit)
      .offset(paging.offset);
    const items: UsageSessionSummary[] = rows.map(row => {
      const startedAt = new Date(this.toISOString(row.started_at));
      const lastSeenAt = new Date(this.toISOString(row.last_seen_at));
      return {
        sessionId: row.session_id,
        userEntityRef: row.user_entity_ref,
        startedAt: startedAt.toISOString(),
        lastSeenAt: lastSeenAt.toISOString(),
        durationSeconds: Math.max(
          0,
          Math.round((lastSeenAt.valueOf() - startedAt.valueOf()) / 1_000),
        ),
        eventCount: this.toNumber(row.event_count),
      };
    });
    return { items, total: this.toNumber(totalRow?.total) };
  }

  async getPlugins(range: ReportQuery, paging: Paging) {
    const base = this.rangeQuery(range).whereNotNull('plugin_id');
    const totalRow = await base
      .clone()
      .countDistinct<{ total: string | number }>({ total: 'plugin_id' })
      .first();
    const rows = await base
      .select('plugin_id')
      .count<{ events: string | number }>({ events: '*' })
      .countDistinct<{ unique_users: string | number }>({
        unique_users: 'user_entity_ref',
      })
      .max<{ last_used_at: Date | string | number }>({
        last_used_at: 'occurred_at',
      })
      .groupBy('plugin_id')
      .orderBy('events', 'desc')
      .limit(paging.limit)
      .offset(paging.offset);
    const items: UsagePlugin[] = rows.map(row => ({
      pluginId: row.plugin_id!,
      events: this.toNumber(row.events),
      uniqueUsers: this.toNumber(row.unique_users),
      lastUsedAt: this.toISOString(row.last_used_at),
    }));
    return { items, total: this.toNumber(totalRow?.total) };
  }

  async getEventTypes(range: ReportQuery) {
    const rows = await this.rangeQuery(range)
      .select('action')
      .count<{ count: string | number }>({ count: '*' })
      .groupBy('action')
      .orderBy('count', 'desc');
    const items: UsageEventType[] = rows.map(row => ({
      action: row.action,
      count: this.toNumber(row.count),
    }));
    return { items };
  }

  async getPresenceSummary(onlineAfter: Date) {
    const row = await this.db<PresenceRow>('usage_presence')
      .where('last_seen_at', '>=', onlineAfter)
      .count<{ online_sessions: string | number }>({ online_sessions: '*' })
      .countDistinct<{ online_users: string | number }>({
        online_users: 'user_entity_ref',
      })
      .first();
    return {
      onlineUsers: this.toNumber(row?.online_users),
      onlineSessions: this.toNumber(row?.online_sessions),
    };
  }

  async getOnlineUsers(onlineAfter: Date, paging: Paging) {
    const rows = await this.db<PresenceRow>('usage_presence')
      .where('last_seen_at', '>=', onlineAfter)
      .select()
      .orderBy('last_seen_at', 'desc');
    // ponytail: online presence is small; move grouping to SQL if it grows.
    const grouped = new Map<string, OnlineUsageUser>();
    for (const row of rows) {
      const current = grouped.get(row.user_entity_ref);
      if (current) {
        current.activeSessionCount += 1;
      } else {
        grouped.set(row.user_entity_ref, {
          userEntityRef: row.user_entity_ref,
          activeSessionCount: 1,
          currentPath: row.current_path,
          lastSeenAt: this.toISOString(row.last_seen_at),
        });
      }
    }
    const users = [...grouped.values()];
    return {
      items: users.slice(paging.offset, paging.offset + paging.limit),
      total: users.length,
    };
  }

  async deleteExpiredData(options: {
    eventsBefore: Date;
    presenceBefore: Date;
  }) {
    return this.db.transaction(async tx => ({
      events: await tx<EventRow>('usage_events')
        .where('occurred_at', '<', options.eventsBefore)
        .delete(),
      presence: await tx<PresenceRow>('usage_presence')
        .where('last_seen_at', '<', options.presenceBefore)
        .delete(),
    }));
  }

  private async assertSessionOwner(
    tx: Knex.Transaction,
    presence: StoredPresence & { startedAt: Date },
  ) {
    const current = await tx<PresenceRow>('usage_presence')
      .where({ session_id: presence.sessionId })
      .first();
    if (current && current.user_entity_ref !== presence.userEntityRef) {
      throw new ConflictError('Session belongs to another user');
    }

    if (!current) {
      const historical = await tx<EventRow>('usage_events')
        .where({ session_id: presence.sessionId })
        .select('user_entity_ref')
        .first();
      if (historical && historical.user_entity_ref !== presence.userEntityRef) {
        throw new ConflictError('Session belongs to another user');
      }

      await tx<PresenceRow>('usage_presence')
        .insert({
          session_id: presence.sessionId,
          user_entity_ref: presence.userEntityRef,
          current_path: presence.currentPath,
          started_at: presence.startedAt,
          last_seen_at: presence.seenAt,
        })
        .onConflict('session_id')
        .ignore();
      const claimed = await tx<PresenceRow>('usage_presence')
        .where({ session_id: presence.sessionId })
        .first();
      if (claimed?.user_entity_ref !== presence.userEntityRef) {
        throw new ConflictError('Session belongs to another user');
      }
    }
  }

  private rangeQuery(range: ReportQuery) {
    return this.applyReportFilters(
      this.db<EventRow>('usage_events')
        .where('occurred_at', '>=', range.from)
        .where('occurred_at', '<', range.to),
      range,
    );
  }

  private applyActivityFilters(
    query: Knex.QueryBuilder<EventRow, EventRow[]>,
    filters: ActivityQuery,
  ) {
    this.applyReportFilters(query, filters);
    if (filters.sessionId) {
      query.where('session_id', filters.sessionId);
    }
    return query;
  }

  private applyReportFilters(
    query: Knex.QueryBuilder<EventRow, EventRow[]>,
    filters: ReportQuery,
    pathColumn = 'current_path',
  ) {
    if (filters.userEntityRef)
      query.where('user_entity_ref', filters.userEntityRef);
    if (filters.action) query.where('action', filters.action);
    if (filters.path) query.where(pathColumn, filters.path);
    if (filters.pluginId) query.where('plugin_id', filters.pluginId);
    return query;
  }

  private bucketExpression(
    interval: UsageTimeseriesInterval,
  ): Knex.Raw<Date | string | number> {
    if (!this.isSQLite) {
      return this.db.raw(
        "date_trunc(?, occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [interval],
      );
    }
    if (interval === 'hour') {
      return this.db.raw(
        "strftime('%Y-%m-%dT%H:00:00Z', occurred_at / 1000, 'unixepoch')",
      );
    }
    if (interval === 'day') {
      return this.db.raw(
        "strftime('%Y-%m-%dT00:00:00Z', occurred_at / 1000, 'unixepoch')",
      );
    }
    return this.db.raw(
      "strftime('%Y-%m-%dT00:00:00Z', occurred_at / 1000, 'unixepoch', '-' || ((cast(strftime('%w', occurred_at / 1000, 'unixepoch') as integer) + 6) % 7) || ' days')",
    );
  }

  private mapActivity(row: EventRow): UsageActivityItem {
    return {
      eventId: row.event_id,
      occurredAt: this.toISOString(row.occurred_at),
      userEntityRef: row.user_entity_ref,
      sessionId: row.session_id,
      action: row.action,
      ...(row.subject ? { subject: row.subject } : {}),
      ...(row.value !== null ? { value: Number(row.value) } : {}),
      ...(row.plugin_id ? { pluginId: row.plugin_id } : {}),
      ...(row.extension_id ? { extensionId: row.extension_id } : {}),
      currentPath: row.current_path,
      ...(row.previous_path ? { previousPath: row.previous_path } : {}),
    };
  }

  private toNumber(value: string | number | null | undefined): number {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? result : 0;
  }

  private toISOString(value: Date | string | number): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return new Date(value.endsWith('Z') ? value : `${value}Z`).toISOString();
    }
    return new Date(value).toISOString();
  }
}
