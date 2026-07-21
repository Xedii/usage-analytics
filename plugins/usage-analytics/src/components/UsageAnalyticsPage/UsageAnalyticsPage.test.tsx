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
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import {
  UsageAnalyticsApi,
  usageAnalyticsApiRef,
} from '../../api/UsageAnalyticsApi';
import { UsageAnalyticsPageContent } from './UsageAnalyticsPage';

const api: jest.Mocked<UsageAnalyticsApi> = {
  getOverview: jest.fn().mockResolvedValue({
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-18T00:00:00.000Z',
    eventCount: 12,
    activeUsers: 3,
    sessions: 4,
    pageViews: 5,
  }),
  getTimeseries: jest.fn().mockResolvedValue({
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-18T00:00:00.000Z',
    interval: 'day',
    buckets: [],
  }),
  getPlugins: jest.fn().mockResolvedValue({
    items: [
      {
        pluginId: 'catalog',
        events: 7,
        uniqueUsers: 2,
        lastUsedAt: '2026-07-18T00:00:00.000Z',
      },
    ],
    total: 1,
  }),
  getEventTypes: jest.fn().mockResolvedValue({ items: [] }),
  getPresenceSummary: jest
    .fn()
    .mockResolvedValue({ onlineUsers: 2, onlineSessions: 3 }),
  getPages: jest.fn(),
  getUsers: jest.fn(),
  getActivity: jest.fn(),
  getSessions: jest.fn(),
  getSession: jest.fn(),
  getOnlineUsers: jest.fn(),
};

describe('UsageAnalyticsPage', () => {
  it('renders aggregate and plugin reports', async () => {
    await renderInTestApp(
      <TestApiProvider apis={[[usageAnalyticsApiRef, api]]}>
        <UsageAnalyticsPageContent />
      </TestApiProvider>,
    );

    expect(await screen.findByText('catalog')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Online now')).toBeTruthy();
  });
});
