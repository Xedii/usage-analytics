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
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import {
  RecordUsageEventsRequest,
  UsageAnalyticsEventInput,
  UsagePresenceHeartbeatRequest,
  UsageTimeseriesInterval,
  usageAnalyticsReadAggregatesPermission,
  usageAnalyticsReadDetailsPermission,
} from '@backstage/plugin-usage-analytics-common';
import {
  AuthorizeResult,
  BasicPermission,
} from '@backstage/plugin-permission-common';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod/v3';
import { AnalyticsService } from './AnalyticsService';
import { AnalyticsStore } from './types';

const eventSchema: z.ZodType<UsageAnalyticsEventInput> = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().max(64),
  action: z.string().min(1).max(128),
  subject: z.string().max(2048).optional(),
  value: z.number().finite().optional(),
  pluginId: z.string().max(128).optional(),
  extensionId: z.string().max(128).optional(),
  currentPath: z.string().min(1).max(2048),
  previousPath: z.string().max(2048).optional(),
});

const eventsRequestSchema: z.ZodType<RecordUsageEventsRequest> = z.object({
  sessionId: z.string().uuid(),
  events: z.array(eventSchema),
});

const heartbeatSchema: z.ZodType<UsagePresenceHeartbeatRequest> = z.object({
  sessionId: z.string().uuid(),
  currentPath: z.string().min(1).max(2048),
});

export function createRouter(options: {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  service: AnalyticsService;
  store: AnalyticsStore;
}): express.Router {
  const { httpAuth, permissions, service, store } = options;
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  const authorize = async (
    req: express.Request,
    permission: BasicPermission,
  ) => {
    const credentials = await httpAuth.credentials(req);
    const [decision] = await permissions.authorize([{ permission }], {
      credentials,
    });
    if (decision.result === AuthorizeResult.DENY) {
      throw new NotAllowedError('Permission denied');
    }
  };
  const authorizeReport = (req: express.Request) =>
    authorize(
      req,
      query(req, 'userEntityRef')
        ? usageAnalyticsReadDetailsPermission
        : usageAnalyticsReadAggregatesPermission,
    );

  router.post('/v1/events', async (req, res) => {
    const parsed = eventsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await service.recordEvents(
      credentials.principal.userEntityRef,
      parsed.data,
    );
    res.status(204).end();
  });

  router.post('/v1/presence/heartbeat', async (req, res) => {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await service.updatePresence(
      credentials.principal.userEntityRef,
      parsed.data,
    );
    res.status(204).end();
  });

  router.get('/v1/overview', async (req, res) => {
    await authorizeReport(req);
    res.json(await store.getOverview(reportQuery(req, service)));
  });

  router.get('/v1/timeseries', async (req, res) => {
    await authorizeReport(req);
    const interval = query(req, 'interval') ?? 'day';
    if (!['hour', 'day', 'week'].includes(interval)) {
      throw new InputError('interval must be hour, day, or week');
    }
    res.json(
      await store.getTimeseries(
        reportQuery(req, service),
        interval as UsageTimeseriesInterval,
      ),
    );
  });

  router.get('/v1/pages', async (req, res) => {
    await authorizeReport(req);
    res.json(
      await store.getPages(
        reportQuery(req, service),
        service.parsePaging(query(req, 'limit'), query(req, 'offset')),
      ),
    );
  });

  router.get('/v1/plugins', async (req, res) => {
    await authorizeReport(req);
    res.json(
      await store.getPlugins(
        reportQuery(req, service),
        service.parsePaging(query(req, 'limit'), query(req, 'offset')),
      ),
    );
  });

  router.get('/v1/users', async (req, res) => {
    await authorize(req, usageAnalyticsReadDetailsPermission);
    res.json(
      await store.getUsers(
        reportQuery(req, service),
        service.parsePaging(query(req, 'limit'), query(req, 'offset')),
      ),
    );
  });

  router.get('/v1/activity', async (req, res) => {
    await authorize(req, usageAnalyticsReadDetailsPermission);
    const range = reportQuery(req, service);
    const paging = service.parsePaging(
      query(req, 'limit'),
      query(req, 'offset'),
    );
    res.json(
      await store.getActivity({
        ...range,
        ...paging,
        userEntityRef: query(req, 'userEntityRef'),
        sessionId: query(req, 'sessionId'),
        action: query(req, 'action'),
        path: query(req, 'path'),
        pluginId: query(req, 'pluginId'),
      }),
    );
  });

  router.get('/v1/sessions', async (req, res) => {
    await authorize(req, usageAnalyticsReadDetailsPermission);
    res.json(
      await store.getSessions(
        reportQuery(req, service),
        service.parsePaging(query(req, 'limit'), query(req, 'offset')),
      ),
    );
  });

  router.get('/v1/sessions/:sessionId', async (req, res) => {
    await authorize(req, usageAnalyticsReadDetailsPermission);
    if (!z.string().uuid().safeParse(req.params.sessionId).success) {
      throw new InputError('Invalid sessionId');
    }
    res.json(await store.getSession(req.params.sessionId));
  });

  router.get('/v1/event-types', async (req, res) => {
    await authorizeReport(req);
    res.json(await store.getEventTypes(reportQuery(req, service)));
  });

  router.get('/v1/presence/summary', async (req, res) => {
    await authorize(req, usageAnalyticsReadAggregatesPermission);
    res.json(await store.getPresenceSummary(service.onlineAfter()));
  });

  router.get('/v1/presence/online', async (req, res) => {
    await authorize(req, usageAnalyticsReadDetailsPermission);
    res.json(
      await store.getOnlineUsers(
        service.onlineAfter(),
        service.parsePaging(query(req, 'limit'), query(req, 'offset')),
      ),
    );
  });

  return router;
}

function reportQuery(req: express.Request, service: AnalyticsService) {
  return {
    ...service.parseRange(query(req, 'from'), query(req, 'to')),
    userEntityRef: query(req, 'userEntityRef'),
    action: query(req, 'action'),
    path: query(req, 'path'),
    pluginId: query(req, 'pluginId'),
  };
}

function query(req: express.Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}
