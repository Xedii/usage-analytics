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
import { RootConfigService } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import {
  RecordUsageEventsRequest,
  UsagePresenceHeartbeatRequest,
} from '@backstage/plugin-usage-analytics-common';
import { AnalyticsStore, DateRange, Paging } from './types';

const MAX_BATCH_SIZE = 100;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
const ONLINE_THRESHOLD_MS = 90 * 1000;

type ServiceOptions = {
  store: AnalyticsStore;
  config: RootConfigService;
};

export class AnalyticsService {
  readonly retentionEventsDays: number;
  readonly retentionPresenceHours: number;

  private readonly store: AnalyticsStore;

  constructor(options: ServiceOptions) {
    this.store = options.store;
    const { config } = options;
    this.retentionEventsDays =
      config.getOptionalNumber('usageAnalytics.retention.eventsDays') ?? 90;
    this.retentionPresenceHours =
      config.getOptionalNumber('usageAnalytics.retention.presenceHours') ?? 24;
  }

  async recordEvents(
    userEntityRef: string,
    request: RecordUsageEventsRequest,
  ): Promise<void> {
    if (request.events.length === 0) {
      throw new InputError('At least one event is required');
    }
    if (request.events.length > MAX_BATCH_SIZE) {
      throw new InputError(
        `Event batch exceeds the maximum of ${MAX_BATCH_SIZE}`,
      );
    }

    const receivedAt = new Date();
    const events = request.events.map(event => {
      const occurredAt = new Date(event.occurredAt);
      if (!Number.isFinite(occurredAt.valueOf())) {
        throw new InputError('Invalid occurredAt timestamp');
      }
      if (
        occurredAt.valueOf() < receivedAt.valueOf() - MAX_EVENT_AGE_MS ||
        occurredAt.valueOf() > receivedAt.valueOf() + 5 * 60 * 1000
      ) {
        throw new InputError('occurredAt is outside the accepted time window');
      }

      const currentPath = this.sanitizePath(event.currentPath);
      const subject =
        event.action === 'navigate' && event.subject
          ? this.sanitizePath(event.subject)
          : undefined;

      return {
        eventId: event.eventId,
        occurredAt,
        receivedAt,
        userEntityRef,
        sessionId: request.sessionId,
        action: event.action.slice(0, 128),
        subject,
        value: event.value,
        pluginId: event.pluginId?.slice(0, 128),
        extensionId: event.extensionId?.slice(0, 128),
        currentPath,
        previousPath: event.previousPath
          ? this.sanitizePath(event.previousPath)
          : undefined,
      };
    });

    await this.store.recordEvents(events);
  }

  async updatePresence(
    userEntityRef: string,
    request: UsagePresenceHeartbeatRequest,
  ): Promise<void> {
    await this.store.updatePresence({
      sessionId: request.sessionId,
      userEntityRef,
      currentPath: this.sanitizePath(request.currentPath),
      seenAt: new Date(),
    });
  }

  parseRange(from?: string, to?: string): DateRange {
    const end = to ? new Date(to) : new Date();
    const start = from
      ? new Date(from)
      : new Date(end.valueOf() - 30 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf())) {
      throw new InputError('Invalid date range');
    }
    if (start >= end) {
      throw new InputError('from must be before to');
    }
    if (end.valueOf() - start.valueOf() > MAX_RANGE_MS) {
      throw new InputError('Requested date range is too large');
    }
    return { from: start, to: end };
  }

  parsePaging(limit?: string, offset?: string): Paging {
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    const parsedOffset = offset === undefined ? 0 : Number(offset);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 100 ||
      !Number.isInteger(parsedOffset) ||
      parsedOffset < 0
    ) {
      throw new InputError('Invalid pagination');
    }
    return { limit: parsedLimit, offset: parsedOffset };
  }

  retentionCutoffs(now = new Date()) {
    return {
      eventsBefore: new Date(
        now.valueOf() - this.retentionEventsDays * 24 * 60 * 60 * 1000,
      ),
      presenceBefore: new Date(
        now.valueOf() - this.retentionPresenceHours * 60 * 60 * 1000,
      ),
    };
  }

  onlineAfter() {
    return new Date(Date.now() - ONLINE_THRESHOLD_MS);
  }

  private sanitizePath(input: string): string {
    let pathname: string;
    try {
      pathname = new URL(input, 'http://backstage.local').pathname;
    } catch {
      throw new InputError('Invalid path');
    }

    pathname = pathname.replace(/\/{2,}/g, '/');
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/$/, '');
    }
    return pathname.slice(0, 512) || '/';
  }
}
