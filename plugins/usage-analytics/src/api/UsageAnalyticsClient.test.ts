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
import { UsageAnalyticsClient } from './UsageAnalyticsClient';

describe('UsageAnalyticsClient', () => {
  it('builds report query parameters', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buckets: [] }),
    });
    const client = new UsageAnalyticsClient(
      { getBaseUrl: jest.fn().mockResolvedValue('http://api') },
      { fetch },
    );

    await client.getTimeseries('week', {
      from: '2026-01-01T00:00:00Z',
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://api/v1/timeseries?from=2026-01-01T00%3A00%3A00Z&interval=week',
    );

    await client.getPages({
      limit: 25,
      offset: 50,
      orderField: 'pageViews',
      orderDirection: 'desc',
    });

    expect(fetch).toHaveBeenLastCalledWith(
      'http://api/v1/pages?limit=25&offset=50&orderField=pageViews&orderDirection=desc',
    );
  });

  it('downloads filtered CSV exports using the backend filename', async () => {
    const content = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('path,pageViews\n/catalog,12\n'),
        );
        controller.close();
      },
    });
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'Content-Disposition':
          'attachment; filename="usage-analytics-pages-2026-07-01-2026-07-31.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      }),
      body: content,
    });
    const client = new UsageAnalyticsClient(
      { getBaseUrl: jest.fn().mockResolvedValue('http://api') },
      { fetch },
    );
    const signal = new AbortController().signal;

    await expect(
      client.exportCsv(
        {
          dataset: 'pages',
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-08-01T00:00:00.000Z',
          pluginId: 'catalog',
        },
        signal,
      ),
    ).resolves.toEqual({
      content,
      contentType: 'text/csv; charset=utf-8',
      filename: 'usage-analytics-pages-2026-07-01-2026-07-31.csv',
    });
    expect(fetch).toHaveBeenCalledWith('http://api/v1/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset: 'pages',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
        pluginId: 'catalog',
      }),
      signal,
    });
  });

  it('uses a fallback filename and propagates backend errors', async () => {
    const content = new ReadableStream<Uint8Array>();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        body: content,
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { name: 'Error', message: 'Too many exports' },
          }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    const client = new UsageAnalyticsClient(
      { getBaseUrl: jest.fn().mockResolvedValue('http://api') },
      { fetch },
    );

    await expect(client.exportCsv({ dataset: 'activity' })).resolves.toEqual({
      content,
      contentType: 'text/csv; charset=utf-8',
      filename: 'usage-analytics-activity.csv',
    });
    await expect(client.exportCsv({ dataset: 'activity' })).rejects.toThrow(
      'Request failed with 429',
    );
  });
});
