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
  AnalyticsApi,
  AnalyticsEvent,
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';
import { UsageAnalyticsCollector } from '@backstage/plugin-usage-analytics';

/** @public */
export class LegacyUsageAnalyticsCollector implements AnalyticsApi {
  private readonly collector: UsageAnalyticsCollector;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.collector = new UsageAnalyticsCollector(options);
  }

  captureEvent(event: AnalyticsEvent): void {
    this.collector.captureEvent({
      ...event,
      context: {
        ...event.context,
        extensionId: event.context.extension,
      },
    });
  }

  shutdown(): void {
    this.collector.shutdown();
  }
}
