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
  mockCredentials,
  mockErrorHandler,
  mockServices,
} from '@backstage/backend-test-utils';
import express from 'express';
import request from 'supertest';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { AnalyticsService } from './AnalyticsService';
import { AnalyticsStore } from './types';
import { createRouter } from './router';

const createStore = (): jest.Mocked<AnalyticsStore> => ({
  recordEvents: jest.fn(),
  updatePresence: jest.fn(),
  getOverview: jest.fn().mockResolvedValue({
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-02-01T00:00:00.000Z',
    eventCount: 0,
    activeUsers: 0,
    sessions: 0,
    pageViews: 0,
  }),
  getTimeseries: jest.fn(),
  getPages: jest.fn(),
  getPlugins: jest.fn(),
  getUsers: jest.fn(),
  getActivity: jest.fn(),
  getSessions: jest.fn(),
  getSession: jest.fn(),
  getEventTypes: jest.fn(),
  getPresenceSummary: jest.fn(),
  getOnlineUsers: jest.fn(),
  deleteExpiredData: jest.fn(),
});

describe('createRouter', () => {
  it('records events using the authenticated user', async () => {
    const store = createStore();
    const service = new AnalyticsService({
      store,
      config: mockServices.rootConfig(),
    });
    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      permissions: mockServices.permissions(),
      service,
      store,
    });
    const app = express().use(router).use(mockErrorHandler());

    await request(app)
      .post('/v1/events')
      .send({
        sessionId: '35a52f7d-5583-42bb-951a-49f45e914c00',
        events: [
          {
            eventId: '62fbc254-d30c-46f1-a4c4-9cf73af9f197',
            occurredAt: new Date().toISOString(),
            action: 'navigate',
            subject: '/',
            currentPath: '/',
            userEntityRef: 'user:default/forged',
          },
        ],
      })
      .expect(204);

    expect(store.recordEvents.mock.calls[0][0][0].userEntityRef).toBe(
      mockCredentials.user().principal.userEntityRef,
    );
  });

  it('rejects aggregate reads when permission is denied', async () => {
    const service = new AnalyticsService({
      store: createStore(),
      config: mockServices.rootConfig(),
    });
    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      permissions: mockServices.permissions({ result: AuthorizeResult.DENY }),
      service,
      store: createStore(),
    });
    const app = express().use(router).use(mockErrorHandler());

    const response = await request(app).get('/v1/overview');
    expect(response.status).toBe(403);
  });
});
