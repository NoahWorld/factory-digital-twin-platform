import { demoProduction, demoEnvironment, demoUtilities, type DemoDevice, type DemoMetric } from "./metal-salt-demo";
export type DashboardConfig = {
  sourceProjectId: string; subtitle: string; view: "front" | "top"; scale: number;
  production: typeof demoProduction; devices: DemoDevice[]; environment: DemoMetric[]; utilities: DemoMetric[];
};
export type DashboardResponse = { project: { id: string; name: string }; dashboard: { revision: number; config: DashboardConfig } };
export const dashboardPath = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/dashboard`;
export const dashboardRoute = (id: string, mode: "run" = "run") => `#/projects/${encodeURIComponent(id)}/dashboard/${mode}`;
