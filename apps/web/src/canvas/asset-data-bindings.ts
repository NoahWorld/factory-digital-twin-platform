export type MetricValueType = "number" | "string" | "boolean" | "timestamp";

export type AssetDataBinding = {
  id: string;
  assetRecordId: string;
  dataSourceId: string;
  dataSourceName: string;
  dataSourceType: "rest_polling" | "websocket";
  metricKey: string;
  sourcePath: string;
  valueType: MetricValueType;
  unit: string | null;
  staleAfterSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type AssetDataBindingListResponse = {
  dataBindings: AssetDataBinding[];
  requestId: string;
};

export type AssetDataBindingResponse = {
  dataBinding: AssetDataBinding;
  requestId: string;
};

export const assetDataBindingsPath = (
  projectId: string,
  assetRecordId: string,
): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetRecordId)}/data-bindings`;

export const assetDataBindingPath = (
  projectId: string,
  assetRecordId: string,
  bindingId: string,
): string =>
  `${assetDataBindingsPath(projectId, assetRecordId)}/${encodeURIComponent(bindingId)}`;
