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
import { mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { DatabaseAnalyticsStore } from './DatabaseAnalyticsStore';

jest.setTimeout(60_000);

const databases = TestDatabases.create({ ids: ['POSTGRES_14', 'SQLITE_3'] });

describe.each(databases.eachSupportedId())(
  'DatabaseAnalyticsStore (%s)',
  databaseId => {
    it('records idempotent events and produces reports', async () => {
      const knex = await databases.init(databaseId);
      if (databaseId.startsWith('POSTGRES')) {
        await knex.raw("set time zone 'America/Los_Angeles'");
      }
      const store = await DatabaseAnalyticsStore.create({
        database: mockServices.database({ knex }),
      });
      const occurredAt = new Date('2026-07-18T00:30:00.000Z');
      const event = {
        eventId: '62fbc254-d30c-46f1-a4c4-9cf73af9f197',
        occurredAt,
        receivedAt: occurredAt,
        userEntityRef: 'user:default/alice',
        sessionId: '35a52f7d-5583-42bb-951a-49f45e914c00',
        action: 'navigate',
        subject: '/catalog',
        currentPath: '/catalog',
      };
      const secondOccurredAt = new Date('2026-07-18T01:00:00.000Z');
      const secondEvent = {
        ...event,
        eventId: '9e926a35-c6eb-4925-b721-d88efbf7990f',
        occurredAt: secondOccurredAt,
        receivedAt: secondOccurredAt,
        action: 'click',
        subject: 'Create',
      };

      await store.recordEvents([event]);
      await store.recordEvents([event]);
      await store.recordEvents([secondEvent]);

      const range = {
        from: new Date('2026-07-18T00:00:00.000Z'),
        to: new Date('2026-07-19T00:00:00.000Z'),
      };
      await expect(store.getOverview(range)).resolves.toMatchObject({
        eventCount: 2,
        activeUsers: 1,
        sessions: 1,
        pageViews: 1,
      });
      await expect(
        store.getPages(range, { limit: 10, offset: 0 }),
      ).resolves.toEqual({
        items: [
          {
            path: '/catalog',
            pageViews: 1,
            uniqueUsers: 1,
            estimatedDurationSeconds: 0,
            lastViewedAt: occurredAt.toISOString(),
          },
        ],
        total: 1,
      });
      await expect(store.getTimeseries(range, 'day')).resolves.toMatchObject({
        buckets: [
          {
            start: '2026-07-18T00:00:00.000Z',
            eventCount: 2,
          },
        ],
      });
      await expect(store.getTimeseries(range, 'hour')).resolves.toMatchObject({
        buckets: [
          { start: '2026-07-18T00:00:00.000Z', eventCount: 1 },
          { start: '2026-07-18T01:00:00.000Z', eventCount: 1 },
        ],
      });
      await expect(store.getTimeseries(range, 'week')).resolves.toMatchObject({
        buckets: [{ start: '2026-07-13T00:00:00.000Z', eventCount: 2 }],
      });
      await expect(
        store.getUsers(range, { limit: 10, offset: 0 }),
      ).resolves.toEqual({
        items: [
          {
            userEntityRef: 'user:default/alice',
            eventCount: 2,
            sessionCount: 1,
            firstSeenAt: occurredAt.toISOString(),
            lastSeenAt: secondOccurredAt.toISOString(),
          },
        ],
        total: 1,
      });
      await expect(
        store.getActivity({
          ...range,
          limit: 10,
          offset: 0,
          action: 'click',
        }),
      ).resolves.toMatchObject({
        items: [
          {
            eventId: secondEvent.eventId,
            action: 'click',
            occurredAt: secondOccurredAt.toISOString(),
          },
        ],
        total: 1,
      });
      await expect(store.getSession(event.sessionId)).resolves.toMatchObject({
        sessionId: event.sessionId,
        userEntityRef: event.userEntityRef,
        startedAt: occurredAt.toISOString(),
        lastSeenAt: secondOccurredAt.toISOString(),
        durationSeconds: 1_800,
        events: [{ action: 'navigate' }, { action: 'click' }],
      });
      await expect(store.getEventTypes(range)).resolves.toEqual({
        items: expect.arrayContaining([
          { action: 'navigate', count: 1 },
          { action: 'click', count: 1 },
        ]),
      });

      const heartbeatAt = new Date('2026-07-18T01:05:00.000Z');
      await store.updatePresence({
        sessionId: event.sessionId,
        userEntityRef: event.userEntityRef,
        currentPath: '/latest',
        seenAt: heartbeatAt,
      });
      await expect(
        store.getPresenceSummary(new Date('2026-07-18T01:04:00.000Z')),
      ).resolves.toEqual({ onlineUsers: 1, onlineSessions: 1 });
      await expect(
        store.getOnlineUsers(new Date('2026-07-18T01:04:00.000Z'), {
          limit: 10,
          offset: 0,
        }),
      ).resolves.toMatchObject({
        items: [
          {
            userEntityRef: event.userEntityRef,
            activeSessionCount: 1,
            currentPath: '/latest',
            lastSeenAt: heartbeatAt.toISOString(),
          },
        ],
        total: 1,
      });

      await store.recordEvents([event]);
      await expect(
        store.getOnlineUsers(new Date('2026-07-18T01:04:00.000Z'), {
          limit: 10,
          offset: 0,
        }),
      ).resolves.toMatchObject({
        items: [{ currentPath: '/latest', activeSessionCount: 1 }],
      });
    });

    it('prevents another user from claiming a session', async () => {
      const knex = await databases.init(databaseId);
      const store = await DatabaseAnalyticsStore.create({
        database: mockServices.database({ knex }),
      });
      const sessionId = '35a52f7d-5583-42bb-951a-49f45e914c00';
      await store.updatePresence({
        sessionId,
        userEntityRef: 'user:default/alice',
        currentPath: '/',
        seenAt: new Date(),
      });

      await expect(
        store.updatePresence({
          sessionId,
          userEntityRef: 'user:default/bob',
          currentPath: '/admin',
          seenAt: new Date(),
        }),
      ).rejects.toThrow('Session belongs to another user');
    });

    it('deletes expired events and presence', async () => {
      const knex = await databases.init(databaseId);
      const store = await DatabaseAnalyticsStore.create({
        database: mockServices.database({ knex }),
      });
      const occurredAt = new Date('2025-01-01T00:00:00.000Z');

      await store.recordEvents([
        {
          eventId: '62fbc254-d30c-46f1-a4c4-9cf73af9f197',
          occurredAt,
          receivedAt: occurredAt,
          userEntityRef: 'user:default/alice',
          sessionId: '35a52f7d-5583-42bb-951a-49f45e914c00',
          action: 'navigate',
          subject: '/',
          currentPath: '/',
        },
      ]);

      await expect(
        store.deleteExpiredData({
          eventsBefore: new Date('2026-01-01T00:00:00.000Z'),
          presenceBefore: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ).resolves.toEqual({ events: 1, presence: 1 });
    });
  },
);
