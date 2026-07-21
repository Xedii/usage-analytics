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
import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  TextField,
  Typography,
} from '@material-ui/core';
import { fade, makeStyles, useTheme } from '@material-ui/core/styles';
import AccessTimeOutlinedIcon from '@material-ui/icons/AccessTimeOutlined';
import AssessmentOutlinedIcon from '@material-ui/icons/AssessmentOutlined';
import ClearAllOutlinedIcon from '@material-ui/icons/ClearAllOutlined';
import FiberManualRecordIcon from '@material-ui/icons/FiberManualRecord';
import FilterListIcon from '@material-ui/icons/FilterList';
import PeopleAltOutlinedIcon from '@material-ui/icons/PeopleAltOutlined';
import PersonOutlineIcon from '@material-ui/icons/PersonOutline';
import VisibilityOutlinedIcon from '@material-ui/icons/VisibilityOutlined';
import {
  usageAnalyticsReadAggregatesPermission,
  usageAnalyticsReadDetailsPermission,
} from '@backstage/plugin-usage-analytics-common';
import { RequirePermission } from '@backstage/plugin-permission-react';
import { ReactNode, useMemo, useState } from 'react';
import useAsync from 'react-use/lib/useAsync';
import useAsyncRetry from 'react-use/lib/useAsyncRetry';
import useInterval from 'react-use/lib/useInterval';
import {
  UsageReportFilters,
  usageAnalyticsApiRef,
} from '../../api/UsageAnalyticsApi';

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

type FilterValues = Record<
  'from' | 'to' | 'userEntityRef' | 'path' | 'pluginId' | 'action',
  string
>;

const emptyFilters: FilterValues = {
  from: '',
  to: '',
  userEntityRef: '',
  path: '',
  pluginId: '',
  action: '',
};

const filterLabels: Record<keyof FilterValues, string> = {
  from: 'From',
  to: 'To',
  userEntityRef: 'User',
  path: 'Path',
  pluginId: 'Plugin',
  action: 'Action',
};

const usePageStyles = makeStyles(theme => ({
  metrics: {
    marginBottom: theme.spacing(3),
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(6, 2),
    color: theme.palette.text.secondary,
  },
  sessionMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
}));

/**
 * Usage analytics dashboard component.
 *
 * @public
 */
export function UsageAnalyticsPageContent() {
  const classes = usePageStyles();
  const [selectedTab, setSelectedTab] = useState(0);
  const [filters, setFilters] = useState<FilterValues>(emptyFilters);
  const options = useMemo(() => filterOptions(filters), [filters]);
  return (
    <Page themeId="tool">
      <Header
        title="Usage analytics"
        subtitle="First-party activity, sessions, and online presence"
      />
      <HeaderTabs
        tabs={tabs}
        selectedIndex={selectedTab}
        onChange={setSelectedTab}
      />
      <Content>
        <Box className={classes.metrics}>
          <FilterBar values={filters} onChange={setFilters} />
        </Box>
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
  return (
    <>
      <MetricCards
        metrics={[
          {
            label: 'Events',
            value: overview.eventCount,
            icon: <AssessmentOutlinedIcon />,
            color: 'primary',
          },
          {
            label: 'Active users',
            value: overview.activeUsers,
            icon: <PeopleAltOutlinedIcon />,
            color: 'success',
          },
          {
            label: 'Sessions',
            value: overview.sessions,
            icon: <AccessTimeOutlinedIcon />,
            color: 'warning',
          },
          {
            label: 'Page views',
            value: overview.pageViews,
            icon: <VisibilityOutlinedIcon />,
            color: 'info',
          },
          {
            label: 'Online now',
            value: presence.value!.onlineUsers,
            icon: <FiberManualRecordIcon />,
            color: 'error',
          },
        ]}
      />
      <Grid container spacing={3}>
        <Grid item xs={12} lg={6}>
          <InfoCard title="Daily activity" noPadding>
            <DataTable
              headers={['Day', 'Events', 'Users', 'Sessions']}
              rows={timeseries.buckets.map(bucket => [
                formatDate(bucket.start),
                bucket.eventCount.toLocaleString(),
                bucket.activeUsers.toLocaleString(),
                bucket.sessions.toLocaleString(),
              ])}
            />
          </InfoCard>
        </Grid>
        <Grid item xs={12} md={6} lg={3}>
          <InfoCard title="Event types" noPadding>
            <DataTable
              headers={['Action', 'Events']}
              rows={eventTypes.items.map(item => [
                <Chip label={item.action} size="small" variant="outlined" />,
                item.count.toLocaleString(),
              ])}
            />
          </InfoCard>
        </Grid>
        <Grid item xs={12} md={6} lg={3}>
          <InfoCard title="Popular plugins" noPadding>
            <DataTable
              headers={['Plugin', 'Events', 'Users']}
              rows={plugins.items.map(plugin => [
                <Chip label={plugin.pluginId} size="small" />,
                plugin.events.toLocaleString(),
                plugin.uniqueUsers.toLocaleString(),
              ])}
            />
          </InfoCard>
        </Grid>
      </Grid>
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
    <InfoCard title={`Pages (${state.value!.total})`} noPadding>
      <DataTable
        headers={['Path', 'Views', 'Users', 'Estimated time', 'Last viewed']}
        rows={state.value!.items.map(page => [
          <Typography variant="body2" component="code">
            {page.path}
          </Typography>,
          page.pageViews.toLocaleString(),
          page.uniqueUsers.toLocaleString(),
          formatDuration(page.estimatedDurationSeconds),
          formatDateTime(page.lastViewedAt),
        ])}
      />
    </InfoCard>
  );
}

function UsersContent({ filters }: { filters: UsageReportFilters }) {
  const classes = usePageStyles();
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
    <Grid container spacing={3}>
      <Grid item xs={12} lg={6}>
        <InfoCard title={`Users (${users.value!.total})`} noPadding>
          <DataTable
            headers={['User', 'Events', 'Sessions', 'Last seen']}
            rows={users.value!.items.map(user => [
              <Button
                size="small"
                color="primary"
                startIcon={<PersonOutlineIcon />}
                onClick={() => setUserEntityRef(user.userEntityRef)}
              >
                {user.userEntityRef}
              </Button>,
              user.eventCount.toLocaleString(),
              user.sessionCount.toLocaleString(),
              formatDateTime(user.lastSeenAt),
            ])}
          />
        </InfoCard>
      </Grid>
      <Grid item xs={12} lg={6}>
        <InfoCard title={`Online users (${online.value!.total})`} noPadding>
          <DataTable
            headers={['User', 'Sessions', 'Path', 'Last heartbeat']}
            rows={online.value!.items.map(user => [
              <Typography variant="body2" component="span">
                <OnlineIndicator /> {user.userEntityRef}
              </Typography>,
              user.activeSessionCount,
              <Typography variant="body2" component="code">
                {user.currentPath}
              </Typography>,
              formatDateTime(user.lastSeenAt),
            ])}
          />
        </InfoCard>
      </Grid>
      <Grid item xs={12}>
        <InfoCard
          title={userEntityRef ? `History · ${userEntityRef}` : 'User history'}
          noPadding
        >
          {!userEntityRef && (
            <div className={classes.emptyState}>
              <PersonOutlineIcon fontSize="large" />
              <Typography variant="body1">
                Select a user to see their recent activity.
              </Typography>
            </div>
          )}
          {history.loading && userEntityRef && <Progress />}
          {history.error && <ResponseErrorPanel error={history.error} />}
          {history.value && (
            <DataTable
              headers={['Time', 'Action', 'Path', 'Plugin']}
              rows={[...history.value.items].reverse().map(event => [
                formatDateTime(event.occurredAt),
                <Chip label={event.action} size="small" variant="outlined" />,
                <Typography variant="body2" component="code">
                  {event.currentPath}
                </Typography>,
                event.pluginId ?? '',
              ])}
            />
          )}
        </InfoCard>
      </Grid>
    </Grid>
  );
}

function SessionsContent({ filters }: { filters: UsageReportFilters }) {
  const classes = usePageStyles();
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
    <Grid container spacing={3}>
      <Grid item xs={12} lg={5}>
        <InfoCard title="Recent sessions" noPadding>
          <DataTable
            headers={['Session', 'User', 'Last activity']}
            rows={sessions.value!.items.map(item => [
              <Button
                size="small"
                color="primary"
                startIcon={<AccessTimeOutlinedIcon />}
                onClick={() => setSessionId(item.sessionId)}
              >
                {item.sessionId}
              </Button>,
              item.userEntityRef,
              formatDateTime(item.lastSeenAt),
            ])}
          />
        </InfoCard>
      </Grid>
      <Grid item xs={12} lg={7}>
        <InfoCard title="Session timeline" noPadding>
          {selected.loading && sessionId && <Progress />}
          {selected.error && <ResponseErrorPanel error={selected.error} />}
          {!selected.value && !selected.error && !selected.loading && (
            <div className={classes.emptyState}>
              <AccessTimeOutlinedIcon fontSize="large" />
              <Typography variant="body1">
                Select a recent session to inspect its timeline.
              </Typography>
            </div>
          )}
          {selected.value && !selected.loading && (
            <Box p={2}>
              <div className={classes.sessionMeta}>
                <Chip
                  icon={<PersonOutlineIcon />}
                  label={selected.value.userEntityRef}
                  size="small"
                />
                <Chip
                  icon={<AccessTimeOutlinedIcon />}
                  label={formatDuration(selected.value.durationSeconds)}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={`${selected.value.events.length} events`}
                  size="small"
                  variant="outlined"
                />
              </div>
              <DataTable
                headers={['Time', 'Action', 'Path']}
                rows={selected.value.events.map(event => [
                  formatDateTime(event.occurredAt),
                  <Chip label={event.action} size="small" variant="outlined" />,
                  <Typography variant="body2" component="code">
                    {event.currentPath}
                  </Typography>,
                ])}
              />
            </Box>
          )}
        </InfoCard>
      </Grid>
    </Grid>
  );
}

const useMetricStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    height: '100%',
    padding: theme.spacing(2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    transition: theme.transitions.create(['box-shadow', 'transform'], {
      duration: theme.transitions.duration.short,
    }),
    '&:hover': {
      boxShadow: theme.shadows[4],
      transform: 'translateY(-2px)',
    },
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    flexShrink: 0,
    borderRadius: theme.shape.borderRadius,
  },
  value: {
    fontSize: '1.75rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  label: {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
}));

type MetricColor = 'primary' | 'success' | 'warning' | 'info' | 'error';

function MetricCards(props: {
  metrics: {
    label: string;
    value: number;
    icon: ReactNode;
    color: MetricColor;
  }[];
}) {
  return (
    <Grid container spacing={3}>
      {props.metrics.map(metric => (
        <Grid item key={metric.label} xs={6} sm={4} md>
          <MetricCard {...metric} />
        </Grid>
      ))}
    </Grid>
  );
}

function MetricCard(props: {
  label: string;
  value: number;
  icon: ReactNode;
  color: MetricColor;
}) {
  const classes = useMetricStyles();
  const theme = useTheme();
  const color = theme.palette[props.color].main;
  return (
    <Paper elevation={0} className={classes.root}>
      <div
        className={classes.badge}
        style={{ backgroundColor: fade(color, 0.12), color }}
      >
        {props.icon}
      </div>
      <div>
        <div className={classes.value}>{props.value.toLocaleString()}</div>
        <div className={classes.label}>{props.label}</div>
      </div>
    </Paper>
  );
}

const useOnlineIndicatorStyles = makeStyles(theme => ({
  dot: {
    color: theme.palette.success.main,
    fontSize: '0.75rem',
    verticalAlign: 'middle',
  },
}));

function OnlineIndicator() {
  const classes = useOnlineIndicatorStyles();
  return <FiberManualRecordIcon className={classes.dot} />;
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

function formatDuration(totalSeconds: number) {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** @public */
export const UsageAnalyticsPage = () => {
  return (
    <RequirePermission permission={usageAnalyticsReadAggregatesPermission}>
      <UsageAnalyticsPageContent />
    </RequirePermission>
  );
};

const useFilterStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  icon: {
    color: theme.palette.text.secondary,
    marginRight: theme.spacing(1),
  },
}));

function FilterBar(props: {
  values: FilterValues;
  onChange: (values: FilterValues) => void;
}) {
  const classes = useFilterStyles();
  const keys = Object.keys(props.values) as (keyof FilterValues)[];
  return (
    <Paper elevation={0} className={classes.root}>
      <Grid container spacing={2} alignItems="center">
        <Grid item>
          <FilterListIcon className={classes.icon} />
        </Grid>
        {keys.map(name => (
          <Grid item xs={6} sm={4} md={2} key={name}>
            <TextField
              fullWidth
              size="small"
              variant="outlined"
              label={filterLabels[name]}
              name={name}
              type={name === 'from' || name === 'to' ? 'date' : 'text'}
              value={props.values[name]}
              InputLabelProps={{ shrink: true }}
              onChange={event =>
                props.onChange({
                  ...props.values,
                  [name]: event.target.value,
                })
              }
            />
          </Grid>
        ))}
        <Grid item>
          <Button
            size="small"
            startIcon={<ClearAllOutlinedIcon />}
            onClick={() => props.onChange(emptyFilters)}
          >
            Clear
          </Button>
        </Grid>
      </Grid>
    </Paper>
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
