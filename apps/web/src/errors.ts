export type RequestContext = {
  status?: number;
  method?: string;
  path?: string;
  cause?: unknown;
};

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly requestId: string | undefined,
    message: string,
    readonly context: RequestContext = {},
  ) {
    super(message, { cause: context.cause });
    this.name = "ApiRequestError";
  }
}

/** Explicitly reviewed local validation text; never wrap arbitrary server messages in this type. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

// Codes are the API contract. Never infer a cause from arbitrary server messages.
const userMessages: Readonly<Record<string, string>> = {
  invalid_credentials: "账号或密码不正确，请重新输入。",
  unauthenticated: "登录状态已失效，请重新登录。",
  login_rate_limited: "登录尝试过于频繁，请 15 分钟后重试。",
  forbidden: "你没有操作权限，请联系管理员。",
  permission_denied: "你没有操作权限，请联系管理员。",
  module_access_denied: "此模块尚未授权，请联系管理员。",
  origin_denied: "当前访问地址未获允许，请联系管理员。",
  invalid_bootstrap_token: "初始化凭证不正确，请重新确认。",
  already_initialized: "平台已完成初始化，请刷新后登录。",
  user_not_found: "账号不存在，请刷新列表后重试。",
  user_inactive: "账号已停用，请先恢复账号。",
  user_active: "账号已经启用，请刷新列表。",
  self_admin_required: "不能移除自己的超级管理员权限。",
  self_delete_forbidden: "不能停用当前登录的账号。",
  last_admin_required: "请至少保留一位启用的超级管理员。",
  admin_modules_fixed: "超级管理员已拥有全部模块权限。",
  constraint_conflict: "内容重复或仍被使用，请检查后重试。",
  request_too_large: "内容过大，请缩小文件后重试。",
  invalid_input: "输入内容不符合要求，请检查后重试。",
  resource_in_use: "资源仍被使用，请确认引用后再删除。",
  internal_error: "服务暂时异常，请稍后重试。",
  network_error: "连接失败，请检查网络后重试。",
  invalid_response: "服务返回异常，请稍后重试。",
  publication_read_only: "公开链接仅供查看，请登录后编辑。",
  publication_not_found: "公开链接已失效，请联系项目负责人。",
  source_origin_denied: "接口地址未获允许，请联系管理员添加业务来源。",
  invalid_source_url: "接口地址无效，请检查地址和连接方式。",
  invalid_subscription_json: "订阅消息格式不正确，请填写有效的 JSON。",
  source_http_error: "业务接口返回异常，请检查接口服务。",
  source_connection_failed: "无法连接业务接口，正在重试。请检查接口服务。",
  source_socket_closed: "业务接口连接已断开，正在重试。",
  source_timeout: "业务接口响应超时，请检查服务和超时设置。",
  source_payload_too_large: "接口数据过大，请缩小返回内容。",
  invalid_source_payload: "接口数据结构不符合要求，请检查返回内容。",
  invalid_source_json: "接口未返回有效的 JSON，请检查接口服务。",
  invalid_source_timestamp: "接口采样时间无效，请检查时间字段。",
  source_clock_error: "接口采样时间异常，请检查业务服务器时间。",
  invalid_source_sequence: "接口数据序号无效，请检查接口服务。",
  source_sequence_regressed: "接口时间或序号发生回退，已暂停动作。请修正接口后重新保存配置。",
  source_timestamp_reused: "接口数据已变化但采样时间未更新，已暂停动作。",
  source_point_missing: "绑定字段缺失或类型不符，请检查接口字段。",
  source_point_out_of_range: "接口数据超出设置范围，请检查数据和动作范围。",
  source_binary_not_supported: "订阅接口需要返回 JSON 文本，请检查接口格式。",
  source_discovery_failed: "后端无法读取接口配置，正在重试。请联系管理员。",
  source_worker_capacity_exceeded: "后端接口采集繁忙，正在重试。",
  motion_source_capacity_exceeded: "运行中的接口项目过多，请联系管理员。",
  source_test_interrupted: "接口检查已中断，请重试。",
  legacy_simulation_removed: "旧版平台模拟已停用，请重新接入业务接口。",
  twin_revision_conflict: "接口配置已变化，请重新加载后再保存。",
  twin_animation_conflict: "绑定模型的原生动画仍在播放，请先关闭该模型动画。",
};

function userMessage(error: ApiRequestError): string {
  if (error.context.status === 404 && error.context.path === "/api/v1/test-business/handling-cell/state") return "测试业务接口尚未启用，请联系管理员更新后端服务。";
  if (Object.hasOwn(userMessages, error.code)) return userMessages[error.code];
  const status = error.context.status;
  if (status === 400 || status === 422) return "输入内容不符合要求，请检查后重试。";
  if (status === 401) return "身份验证未通过，请重新登录。";
  if (status === 403) return "本次操作被拒绝，请联系管理员。";
  if (status === 404) return "内容不存在，请刷新后重试。";
  if (status === 409) return "数据已发生变化，请刷新后重试。";
  if (status === 429) return "请求过于频繁，请稍后重试。";
  if (status !== undefined && status >= 500) return "服务暂时异常，请稍后重试。";
  return "操作未完成，请重试或联系管理员。";
}

export function errorPresentation(reason: unknown): { message: string } {
  if (reason instanceof ApiRequestError) return { message: userMessage(reason) };
  if (reason instanceof UserFacingError) return { message: reason.message };
  if (reason instanceof DOMException && reason.name === "AbortError") return { message: "操作已取消。" };
  return { message: "操作未完成，请重试或联系管理员。" };
}

const reportedErrors = new WeakSet<object>();
const diagnosticIdentifier = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : "[redacted]";

function diagnosticPath(path: string): string {
  try {
    return new URL(path, "http://dtwin.invalid").pathname
      .replace(/\/(?:share|tokens?)\/[^/]+/gi, "/[redacted]");
  } catch (reason) {
    // A malformed diagnostic path must not replace the original failure or expose the raw value.
    if (!(reason instanceof TypeError)) throw reason;
    return "[redacted]";
  }
}

function diagnosticSource(reason: Error): { source?: string; sourceUnavailable?: true } {
  // Stack is optional diagnostic data and may be an accessor supplied by third-party code.
  // Its failure must not prevent reporting the original error's safe metadata.
  let stack: unknown;
  try { stack = reason.stack; } catch { return { sourceUnavailable: true }; }
  if (typeof stack !== "string") return {};
  // Exclude the message line and log locations only: no stack text, paths, URL queries or arguments.
  const source = stack.split("\n").slice(1).flatMap((line) => {
    if (/[?#]/.test(line)) return [];
    const location = line.match(/\b([\w.-]+\.(?:m?js|tsx?):\d+:\d+)\)?\s*$/)?.[1];
    return location ? [location] : [];
  }).slice(0, 6).join(", ") || undefined;
  return source ? { source } : {};
}

type DiagnosticContext = {
  operation: string;
  projectId?: string | null;
  canvasNodeId?: string | null;
  instanceId?: string | null;
  decorationId?: string | null;
  assetId?: string | null;
  originProjectId?: string | null;
  linkedProjectId?: string | null;
  templateId?: string | null;
  ruleId?: string | null;
  targetProjectId?: string | null;
  correlationId?: string | null;
  assetRecordId?: string | null;
  revision?: number | null;
  sequence?: number | null;
  failureCount?: number | null;
  bindingIds?: readonly string[];
  targetProjectIds?: readonly string[];
  allowedOriginProjectIds?: readonly string[];
};

/** Keep diagnostics useful without logging arbitrary response text, bodies, credentials or causes. */
export function reportError(reason: unknown, context?: DiagnosticContext): void {
  if (typeof reason === "object" && reason !== null) {
    if (reportedErrors.has(reason)) return;
    reportedErrors.add(reason);
  }
  const diagnostic: Record<string, string | number | boolean | undefined> = {
    name: reason instanceof ApiRequestError ? "ApiRequestError"
      : reason instanceof UserFacingError ? "UserFacingError"
      : reason instanceof TypeError ? "TypeError"
      : reason instanceof RangeError ? "RangeError"
      : reason instanceof SyntaxError ? "SyntaxError"
      : reason instanceof ReferenceError ? "ReferenceError"
      : reason instanceof URIError ? "URIError"
      : reason instanceof EvalError ? "EvalError"
      : reason instanceof Error ? "Error" : "NonError",
  };
  if (reason instanceof Error) Object.assign(diagnostic, diagnosticSource(reason));
  if (context) {
    for (const key of ["operation", "projectId", "canvasNodeId", "instanceId", "decorationId", "assetId", "originProjectId", "linkedProjectId", "templateId", "ruleId", "targetProjectId", "correlationId", "assetRecordId"] as const) {
      const value = context[key];
      if (value != null) diagnostic[key] = diagnosticIdentifier(value);
    }
    for (const key of ["revision", "sequence", "failureCount"] as const) {
      const value = context[key];
      if (value != null && Number.isFinite(value)) diagnostic[key] = value;
    }
    for (const key of ["bindingIds", "targetProjectIds", "allowedOriginProjectIds"] as const) {
      const ids = context[key];
      if (ids) diagnostic[key] = ids.slice(0, 100).map((id) => diagnosticIdentifier(id)).join(", ");
    }
  }
  if (reason instanceof ApiRequestError) {
    diagnostic.code = diagnosticIdentifier(reason.code);
    diagnostic.status = reason.context.status;
    diagnostic.method = diagnosticIdentifier(reason.context.method);
    diagnostic.requestId = diagnosticIdentifier(reason.requestId);
    if (reason.context.path) {
      diagnostic.path = diagnosticPath(reason.context.path);
    }
  }
  console.error("[DTwin] 操作失败", diagnostic);
}

export const errorMessage = (reason: unknown): string => {
  reportError(reason);
  return errorPresentation(reason).message;
};
