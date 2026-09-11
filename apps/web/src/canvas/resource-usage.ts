export type ResourceUsage = {
  count: number;
  nodes: Array<{
    id: string;
    type: string;
  }>;
};
