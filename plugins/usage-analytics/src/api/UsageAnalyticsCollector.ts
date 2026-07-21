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
  AnalyticsEvent,
  AnalyticsImplementation,
  DiscoveryApi,
  FetchApi,
} from '@backstage/frontend-plugin-api';
import { RecordUsageEventsRequest } from '@backstage/plugin-usage-analytics-common';

const FLUSH_DELAY_MS = 5_000;
const MAX_RETRY_ATTEMPTS = 3;
const HEARTBEAT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

class UsageAnalyticsPostError extends Error {
  constructor(readonly status: number, readonly retryable: boolean) {
    super(`Usage analytics ingestion failed with ${status}`);
  }
}

type PendingBatch = {
  events: RecordUsageEventsRequest['events'];
  retryAttempts: number;
};

/** @public */
export class UsageAnalyticsCollector implements AnalyticsImplementation {
  private readonly sessionId: string;
  private readonly queue: RecordUsageEventsRequest['events'] = [];
  private previousPath: string | undefined;
  private previousNavigationAt = Date.now();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pendingBatch: PendingBatch | undefined;
  private flushInProgress = false;
  private heartbeatInProgress = false;
  private stopped = false;

  constructor(
    private readonly options: {
      discoveryApi: DiscoveryApi;
      fetchApi: FetchApi;
    },
  ) {
    this.sessionId = window.crypto.randomUUID();
    this.previousPath = this.browserPath();
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_MS);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);
  }

  captureEvent(event: AnalyticsEvent): void {
    const currentPath = this.browserPath();
    const { pluginId, extensionId } = event.context;
    const value =
      event.action === 'navigate'
        ? Math.min(1_800, (Date.now() - this.previousNavigationAt) / 1_000)
        : event.value;
    this.queue.push({
      eventId: window.crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      action: event.action,
      subject: event.action === 'navigate' ? event.subject : undefined,
      value,
      pluginId,
      extensionId,
      currentPath,
      previousPath: this.previousPath,
    });
    if (this.queue.length > 1_000) {
      this.queue.splice(0, this.queue.length - 1_000);
    }
    if (event.action === 'navigate') {
      this.previousPath = currentPath;
      this.previousNavigationAt = Date.now();
    }
    if (this.pendingBatch) {
      return;
    }
    if (this.queue.length >= 20) {
      this.flush();
    } else if (!this.flushTimer) {
      this.scheduleFlush(FLUSH_DELAY_MS);
    }
  }

  shutdown() {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    window.removeEventListener('pagehide', this.handlePageHide);
  }

  private readonly handleVisibilityChange = () => this.sendHeartbeat();

  private readonly handlePageHide = () => {
    this.sendHeartbeat(true);
    this.flush(true);
  };

  private async flush(keepalive = false) {
    if (this.flushInProgress || this.stopped) {
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const batchSize = keepalive ? 8 : 100;
    const pending = this.pendingBatch;
    const batch =
      (pending
        ? {
            events: pending.events.slice(0, batchSize),
            retryAttempts: pending.retryAttempts,
          }
        : undefined) ??
      (this.queue.length > 0
        ? { events: this.queue.splice(0, batchSize), retryAttempts: 0 }
        : undefined);
    if (!batch) {
      return;
    }
    this.pendingBatch =
      pending && pending.events.length > batch.events.length
        ? { ...pending, events: pending.events.slice(batch.events.length) }
        : undefined;
    this.flushInProgress = true;
    try {
      await this.post(
        '/v1/events',
        { sessionId: this.sessionId, events: batch.events },
        keepalive,
      );
    } catch (error) {
      const retryable =
        !(error instanceof UsageAnalyticsPostError) || error.retryable;
      if (keepalive) {
        this.queue.unshift(...batch.events);
      } else if (retryable && batch.retryAttempts < MAX_RETRY_ATTEMPTS) {
        this.pendingBatch = {
          events: batch.events,
          retryAttempts: batch.retryAttempts + 1,
        };
        this.scheduleFlush(FLUSH_DELAY_MS * 2 ** batch.retryAttempts);
      }
    } finally {
      this.flushInProgress = false;
    }
    if (!this.pendingBatch && this.queue.length > 0 && !keepalive) {
      this.scheduleFlush(FLUSH_DELAY_MS);
    }
  }

  private async sendHeartbeat(keepalive = false) {
    if (this.heartbeatInProgress) {
      return;
    }
    this.heartbeatInProgress = true;
    try {
      await this.post(
        '/v1/presence/heartbeat',
        {
          sessionId: this.sessionId,
          currentPath: this.browserPath(),
        },
        keepalive,
      );
    } catch {
      // Presence is best-effort; the next interval retries it.
    } finally {
      this.heartbeatInProgress = false;
    }
  }

  private async post(path: string, body: unknown, keepalive: boolean) {
    const baseUrl = await this.options.discoveryApi.getBaseUrl(
      'usage-analytics',
    );
    const response = await this.options.fetchApi.fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new UsageAnalyticsPostError(
        response.status,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }
  }

  private scheduleFlush(delayMs: number) {
    if (!this.flushTimer && !this.stopped) {
      this.flushTimer = setTimeout(() => this.flush(), delayMs);
    }
  }

  private browserPath() {
    return window.location.pathname;
  }
}
