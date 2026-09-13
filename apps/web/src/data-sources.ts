import type { MqttConfig,SqliteQueryConfig } from "../../api/src/data-sources";
import type { TimestampFormat } from "../../../shared/metric-transforms";
export type DataSourceType = "rest_polling" | "websocket" | "mqtt" | "sqlite_query";

export type RestPollingConfig = {
  timestampFormat?:TimestampFormat;
  url: string;
  endpointRef?: string;
  collectionMode?: "demand" | "continuous";
  intervalSeconds: number;
  timeoutMs: number;
  timestampPath: string | null;
  credentialRef: string | null;
};

export type WebSocketConfig = {
  timestampFormat?:TimestampFormat;
  url: string;
  endpointRef?: string;
  collectionMode?: "demand" | "continuous";
  heartbeatSeconds: number;
  timestampPath?: string | null;
  sampleIntervalMs?: number;
  topics?: string[];
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
    }
  | ProjectDataSourceBase & { sourceType:"mqtt";config:MqttConfig }
  | ProjectDataSourceBase & { sourceType:"sqlite_query";config:SqliteQueryConfig };

export type DataSourceListResponse = {
  dataSources: ProjectDataSource[];
  requestId: string;
};

export type DataSourceResponse = {
  dataSource: ProjectDataSource;
  requestId: string;
};

export type RestDataSourceProbe = {
  dataSource: Pick<ProjectDataSource, "id" | "name" | "sourceType">;
  collectedAt: string;
  sourceTimestamp: string | null;
  sourceAgeSeconds: number | null;
  durationMs: number;
  responseBytes: number;
  fields: Array<{
    path: string;
    valueType: "number" | "string" | "boolean" | "null";
    sample: number | string | boolean | null;
  }>;
  fieldsTruncated: boolean;
};

export type RestDataSourceProbeResponse = {
  probe: RestDataSourceProbe;
  requestId: string;
};

export const dataSourcesPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/data-sources`;

export const dataSourcePath = (projectId: string, dataSourceId: string): string =>
  `${dataSourcesPath(projectId)}/${encodeURIComponent(dataSourceId)}`;

export const dataSourceProbePath = (projectId: string, dataSourceId: string): string =>
  `${dataSourcePath(projectId, dataSourceId)}/test`;
