import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export const session = () => {
  const path = process.env.NEWPOWER_SESSION_FILE;
  if (!path) throw new Error("Set NEWPOWER_SESSION_FILE to the private local smoke session file.");
  return JSON.parse(readFileSync(path, "utf8")) as {
    apiBase: string; projectId: string; sessionCookie: string; email: string; password: string;
  };
};

export async function login(page: Page) {
  const identity = session();
  await page.goto("/#/projects");
  await page.getByLabel("邮箱", { exact: true }).fill(identity.email);
  await page.getByLabel("密码", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "登录平台", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建项目", exact: true })).toBeVisible();
}

export async function control(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${process.env.NEWPOWER_MOCK_URL ?? "http://127.0.0.1:8790"}${path}`, { data });
  expect(response.ok()).toBeTruthy();
}
