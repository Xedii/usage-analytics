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
  Content,
  Header,
  HeaderTabs,
  InfoCard,
  Page,
  Progress,
  ResponseErrorPanel,
  Table,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { Button } from '@material-ui/core';
import {
  usageAnalyticsReadAggregatesPermission,
  usageAnalyticsReadDetailsPermission,
} from '@backstage/plugin-usage-analytics-common';
import { RequirePermission } from '@backstage/plugin-permission-react';
import { ChangeEvent, ReactNode, useMemo, useState } from 'react';
import useAsync from 'react-use/lib/useAsync';
import useAsyncRetry from 'react-use/lib/useAsyncRetry';
import useInterval from 'react-use/lib/useInterval';
import {
  UsageReportFilters,
  usageAnalyticsApiRef,
} from '../../api/UsageAnalyticsApi';
import styles from './UsageAnalyticsPage.module.css';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'pages', label: 'Pages' },
  { id: 'users', label: 'Users' },
  { id: 'sessions', label: 'Sessions' },
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Usage analytics dashboard component.
 *
 * @public
 */
export function UsageAnalyticsPageContent() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [filters, setFilters] = useState<FilterValues>({
    from: '',
    to: '',
    userEntityRef: '',
    path: '',
    pluginId: '',
    action: '',
  });
  const options = useMemo(() => filterOptions(filters), [filters]);
  return (
    <Page themeId="tool">
      <Header
        title="Usage analytics"
        subtitle="First-party activity, sessions, and online presence"
      />
      <FilterBar values={filters} onChange={setFilters} />
      <HeaderTabs
        tabs={tabs}
        selectedIndex={selectedTab}
        onChange={setSelectedTab}
      />
      <Content>
        {selectedTab === 0 && <OverviewContent filters={options} />}
        {selectedTab === 1 && <PagesContent filters={options} />}
        {selectedTab === 2 && (
          <RequirePermission permission={usageAnalyticsReadDetailsPermission}>
            <UsersContent filters={options} />
          </RequirePermission>
        )}
        {selectedTab === 3 && (
          <RequirePermission permission={usageAnalyticsReadDetailsPermission}>
            <SessionsContent filters={options} />
          </RequirePermission>
        )}
      </Content>
    </Page>
  );
}

function OverviewContent({ filters }: { filters: UsageReportFilters }) {
  const api = useApi(usageAnalyticsApiRef);
  const reports = useAsync(
    () =>
      Promise.all([
        api.getOverview(filters),
        api.getTimeseries('day', filters),
        api.getEventTypes(filters),
        api.getPlugins({ ...filters, limit: 10 }),
      ]),
    [api, filters],
  );
  const presence = useAsyncRetry(() => api.getPresenceSummary(), [api]);
  useInterval(presence.retry, 30_000);
  if (reports.loading || (presence.loading && !presence.value)) {
    return <Progress />;
  }
  if (reports.error || presence.error) {
    return <ResponseErrorPanel error={(reports.error ?? presence.error)!} />;
  }
  const [overview, timeseries, eventTypes, plugins] = reports.value!;
  const metrics = [
    ['Events', overview.eventCount],
    ['Active users', overview.activeUsers],
    ['Sessions', overview.sessions],
    ['Page views', overview.pageViews],
    ['Online now', presence.value!.onlineUsers],
  ];
  return (
    <>
      <div className={styles.cards}>
        {metrics.map(([label, value]) => (
          <InfoCard key={label} title={String(label)}>
            <div className={styles.metric}>
              {Number(value).toLocaleString()}
            </div>
          </InfoCard>
        ))}
      </div>
      <div className={styles.grid}>
        <InfoCard title="Daily activity">
          <DataTable
            headers={['Day', 'Events', 'Users', 'Sessions']}
            rows={timeseries.buckets.map(bucket => [
              formatDate(bucket.start),
              bucket.eventCount,
              bucket.activeUsers,
              bucket.sessions,
            ])}
          />
        </InfoCard>
        <InfoCard title="Event types">
          <DataTable
            headers={['Action', 'Events']}
            rows={eventTypes.items.map(item => [item.action, item.count])}
          />
        </InfoCard>
        <InfoCard title="Popular plugins">
          <DataTable
            headers={['Plugin', 'Events', 'Users']}
            rows={plugins.items.map(plugin => [
              plugin.pluginId,
              plugin.events,
              plugin.uniqueUsers,
            ])}
          />
        </InfoCard>
      </div>
    </>
  );
}

function PagesContent({ filters }: { filters: UsageReportFilters }) {
  const api = useApi(usageAnalyticsApiRef);
  const state = useAsync(
    () => api.getPages({ ...filters, limit: 100 }),
    [api, filters],
  );
  if (state.loading) return <Progress />;
  if (state.error) return <ResponseErrorPanel error={state.error} />;
  return (
    <InfoCard title={`Pages (${state.value!.total})`}>
      <DataTable
        headers={['Path', 'Views', 'Users', 'Estimated time', 'Last viewed']}
        rows={state.value!.items.map(page => [
          page.path,
          page.pageViews,
          page.uniqueUsers,
          `${page.estimatedDurationSeconds}s`,
          formatDateTime(page.lastViewedAt),
        ])}
      />
    </InfoCard>
  );
}

function UsersContent({ filters }: { filters: UsageReportFilters }) {
  const api = useApi(usageAnalyticsApiRef);
  const [userEntityRef, setUserEntityRef] = useState<string>();
  const users = useAsync(
    () => api.getUsers({ ...filters, limit: 100 }),
    [api, filters],
  );
  const history = useAsync(
    () =>
      userEntityRef
        ? api.getActivity({ ...filters, userEntityRef, limit: 100 })
        : Promise.resolve(undefined),
    [api, filters, userEntityRef],
  );
  const online = useAsyncRetry(() => api.getOnlineUsers({ limit: 100 }), [api]);
  useInterval(online.retry, 30_000);
  if (users.loading || (online.loading && !online.value)) return <Progress />;
  if (users.error || online.error) {
    return <ResponseErrorPanel error={(users.error ?? online.error)!} />;
  }
  return (
    <div className={styles.grid}>
      <InfoCard title={`Users (${users.value!.total})`}>
        <DataTable
          headers={['User', 'Events', 'Sessions', 'Last seen']}
          rows={users.value!.items.map(user => [
            <Button
              color="primary"
              onClick={() => setUserEntityRef(user.userEntityRef)}
            >
              {user.userEntityRef}
            </Button>,
            user.eventCount,
            user.sessionCount,
            formatDateTime(user.lastSeenAt),
          ])}
        />
      </InfoCard>
      <InfoCard title={`Online users (${online.value!.total})`}>
        <DataTable
          headers={['User', 'Sessions', 'Path', 'Last heartbeat']}
          rows={online.value!.items.map(user => [
            user.userEntityRef,
            user.activeSessionCount,
            user.currentPath,
            formatDateTime(user.lastSeenAt),
          ])}
        />
      </InfoCard>
      <InfoCard title="User history">
        {!userEntityRef && <div className={styles.muted}>Select a user.</div>}
        {history.loading && userEntityRef && <Progress />}
        {history.error && <ResponseErrorPanel error={history.error} />}
        {history.value && (
          <DataTable
            headers={['Time', 'Action', 'Path', 'Plugin']}
            rows={[...history.value.items]
              .reverse()
              .map(event => [
                formatDateTime(event.occurredAt),
                event.action,
                event.currentPath,
                event.pluginId ?? '',
              ])}
          />
        )}
      </InfoCard>
    </div>
  );
}

function SessionsContent({ filters }: { filters: UsageReportFilters }) {
  const api = useApi(usageAnalyticsApiRef);
  const sessions = useAsync(
    () => api.getSessions({ ...filters, limit: 100 }),
    [api, filters],
  );
  const [sessionId, setSessionId] = useState<string>();
  const selected = useAsync(
    () => (sessionId ? api.getSession(sessionId) : Promise.resolve(undefined)),
    [api, sessionId],
  );
  if (sessions.loading) return <Progress />;
  if (sessions.error) return <ResponseErrorPanel error={sessions.error} />;

  return (
    <div className={styles.grid}>
      <InfoCard title="Recent sessions">
        <DataTable
          headers={['Session', 'User', 'Last activity']}
          rows={sessions.value!.items.map(item => [
            <Button
              color="primary"
              onClick={() => setSessionId(item.sessionId)}
            >
              {item.sessionId}
            </Button>,
            item.userEntityRef,
            formatDateTime(item.lastSeenAt),
          ])}
        />
      </InfoCard>
      <InfoCard title="Session timeline">
        {selected.loading && sessionId && <Progress />}
        {selected.error && <ResponseErrorPanel error={selected.error} />}
        {!selected.value && !selected.error && !selected.loading && (
          <div className={styles.muted}>Select a recent session.</div>
        )}
        {selected.value && !selected.loading && (
          <>
            <div>
              {selected.value.userEntityRef} · {selected.value.durationSeconds}s
              · {selected.value.events.length} events
            </div>
            <DataTable
              headers={['Time', 'Action', 'Path']}
              rows={selected.value.events.map(event => [
                formatDateTime(event.occurredAt),
                event.action,
                event.currentPath,
              ])}
            />
          </>
        )}
      </InfoCard>
    </div>
  );
}

function DataTable(props: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <Table<ReactNode[]>
      columns={props.headers.map((title, index) => ({
        title,
        render: row => row[index],
      }))}
      data={props.rows}
      options={{
        paging: false,
        search: false,
        toolbar: false,
        padding: 'dense',
      }}
    />
  );
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

/** @public */
export const UsageAnalyticsPage = () => {
  return (
    <RequirePermission permission={usageAnalyticsReadAggregatesPermission}>
      <UsageAnalyticsPageContent />
    </RequirePermission>
  );
};

type FilterValues = Record<
  'from' | 'to' | 'userEntityRef' | 'path' | 'pluginId' | 'action',
  string
>;

function FilterBar(props: {
  values: FilterValues;
  onChange: (values: FilterValues) => void;
}) {
  const change = (event: ChangeEvent<HTMLInputElement>) =>
    props.onChange({
      ...props.values,
      [event.target.name]: event.target.value,
    });
  return (
    <div className={styles.filters}>
      {Object.entries(props.values).map(([name, value]) => (
        <label key={name}>
          {name}
          <input
            name={name}
            type={name === 'from' || name === 'to' ? 'date' : 'text'}
            value={value}
            onChange={change}
          />
        </label>
      ))}
    </div>
  );
}

function filterOptions(values: FilterValues): UsageReportFilters {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value)
      .map(([key, value]) => [key, filterValue(key, value)]),
  );
}

function filterValue(key: string, value: string) {
  if (key === 'from') return `${value}T00:00:00.000Z`;
  if (key === 'to') return `${value}T23:59:59.999Z`;
  return value;
}
