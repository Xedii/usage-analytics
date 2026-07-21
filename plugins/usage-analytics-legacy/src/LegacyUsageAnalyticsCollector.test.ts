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
import { LegacyUsageAnalyticsCollector } from './LegacyUsageAnalyticsCollector';

describe('LegacyUsageAnalyticsCollector', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('maps the legacy extension context to extensionId', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const collector = new LegacyUsageAnalyticsCollector({
      discoveryApi: { getBaseUrl: jest.fn().mockResolvedValue('http://api') },
      fetchApi: { fetch },
    });

    collector.captureEvent({
      action: 'click',
      subject: 'Catalog link',
      context: {
        pluginId: 'catalog',
        routeRef: 'catalog-index',
        extension: 'CatalogPage',
      },
    });
    await jest.advanceTimersByTimeAsync(5_000);

    const request = fetch.mock.calls.find(call =>
      call[0].endsWith('/v1/events'),
    );
    expect(JSON.parse(request![1].body).events[0]).toMatchObject({
      pluginId: 'catalog',
      extensionId: 'CatalogPage',
    });
    collector.shutdown();
  });
});
