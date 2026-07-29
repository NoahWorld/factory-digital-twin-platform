export type DataSourceType = "rest_polling" | "websocket";

export type RestPollingConfig = {
  url: string;
  intervalSeconds: number;
  timeoutMs: number;
  credentialRef: string | null;
};

export type WebSocketConfig = {
  url: string;
  heartbeatSeconds: number;
  reconnectMaxSeconds: number;
  credentialRef: string | null;
};

type ProjectDataSourceBase = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDataSource =
  | ProjectDataSourceBase & {
      sourceType: "rest_polling";
      config: RestPollingConfig;
    }
  | ProjectDataSourceBase & {
      sourceType: "websocket";
      config: WebSocketConfig;
    };

export type DataSourceListResponse = {
  dataSources: ProjectDataSource[];
  requestId: string;
};

export type DataSourceResponse = {
  dataSource: ProjectDataSource;
  requestId: string;
};

export const dataSourcesPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/data-sources`;

export const dataSourcePath = (projectId: string, dataSourceId: string): string =>
  `${dataSourcesPath(projectId)}/${encodeURIComponent(dataSourceId)}`;
