type ApiFailure = {
  error?: string;
  message?: string;
  requestId?: string;
};

type RequestContext = {
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

// Codes are the API contract. Do not infer a specific cause from a translated message or status alone.
const userMessages: Readonly<Record<string, string>> = {
  invalid_credentials: "账号或密码不正确。请检查账号、密码及大小写后重试；忘记密码请联系管理员重置。",
  unauthenticated: "当前未登录，或登录状态已过期、被撤销。请重新登录后继续。",
  login_rate_limited: "登录尝试过于频繁，已被暂时限制。请等待 15 分钟后再试。",
  forbidden: "你没有执行此操作的权限。请联系管理员确认账号权限。",
  permission_denied: "你没有执行此操作的权限。请联系管理员确认账号权限。",
  module_access_denied: "你的账号未开通此模块。请联系管理员调整模块权限。",
  origin_denied: "当前访问地址未获服务器允许。请使用管理员提供的平台地址，或联系管理员检查地址配置。",
  invalid_bootstrap_token: "初始化凭证不正确。请向部署管理员确认凭证后重试。",
  already_initialized: "平台已完成初始化。请刷新页面，使用已有账号登录。",
  user_not_found: "该账号不存在或已被移除。请刷新用户列表后确认。",
  user_inactive: "该账号已停用。请先恢复账号，再修改资料或权限。",
  user_active: "该账号已经启用，无需恢复。请刷新用户列表。",
  self_admin_required: "不能移除自己的超级管理员权限。请使用其他超级管理员账号操作。",
  self_delete_forbidden: "不能停用当前登录的账号。请使用其他超级管理员账号操作。",
  last_admin_required: "平台必须保留至少一个启用的超级管理员。请先设置另一位超级管理员。",
  admin_modules_fixed: "超级管理员固定拥有 2D 和 3D 权限，无需单独调整模块授权。",
  constraint_conflict: "提交的数据与已有记录冲突。请检查是否有重复内容或仍被引用的数据，再重试。",
  request_too_large: "提交的内容超过服务器允许的大小。请缩小文件或减少本次提交的内容。",
  internal_error: "服务器处理请求时发生异常。请稍后重试；仍失败请将错误详情提供给管理员。",
  network_error: "无法获取服务器响应。请检查网络后重试；仍失败请联系管理员检查服务。",
  invalid_response: "服务器返回的内容格式异常。请刷新页面后重试；仍失败请将错误详情提供给管理员。",
  publication_read_only: "公开链接只允许查看。请登录平台后编辑项目。",
  publication_not_found: "此公开链接不存在或已取消发布。请向项目负责人获取有效链接。",
};

function userMessage(error: ApiRequestError): string {
  if (Object.hasOwn(userMessages, error.code)) return userMessages[error.code];
  // Preserve already actionable Chinese business validation messages.
  if (/[\u3400-\u9fff]/.test(error.message)) return error.message;
  const status = error.context.status;
  if (status === 400 || status === 422) return "提交内容未通过校验。请根据错误详情检查输入后重试。";
  if (status === 401) return "身份验证未通过。请重新登录；仍失败请联系管理员。";
  if (status === 403) return "服务器拒绝了本次操作。请将错误详情提供给管理员确认原因。";
  if (status === 404) return "请求的内容或接口不存在。请刷新页面后重试；仍失败请联系管理员。";
  if (status === 409) return "本次操作与当前数据状态冲突。请查看错误详情，确认最新状态后再操作。";
  if (status === 429) return "请求过于频繁或服务当前繁忙。请稍后重试。";
  if (status !== undefined && status >= 500) return "服务器暂时无法完成请求。请稍后重试；仍失败请将错误详情提供给管理员。";
  return "操作未完成，暂时无法确定具体原因。请将错误详情提供给管理员排查。";
}

export function errorPresentation(reason: unknown): {
  message: string;
  details: Array<{ label: string; value: string }>;
} {
  if (!(reason instanceof ApiRequestError)) {
    return { message: reason instanceof Error ? reason.message : String(reason), details: [] };
  }
  const details = [{ label: "错误码", value: reason.code }];
  if (reason.context.status !== undefined) details.push({ label: "HTTP 状态", value: String(reason.context.status) });
  if (reason.context.method && reason.context.path) {
    details.push({ label: "请求接口", value: `${reason.context.method} ${reason.context.path}` });
  }
  details.push({ label: "请求编号", value: reason.requestId ?? "未收到" });
  details.push({ label: "原始信息", value: reason.message });
  return { message: userMessage(reason), details };
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export const publicShareToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/^#\/share\/([^/?#]+)$/);
  return match ? match[1] : null;
};

export const apiUrl = (path: string): string => {
  const share = publicShareToken();
  if (share && /^\/api\/v1\/projects(?:\/|\?|$)/.test(path)) {
    const publicPath = path.replace(/^\/api\/v1\/projects/, "/api/v1/publications/projects");
    return `${apiBaseUrl}${publicPath}${publicPath.includes("?") ? "&" : "?"}share=${encodeURIComponent(share)}`;
  }
  return `${apiBaseUrl}${path}`;
};

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const share = publicShareToken();
  if (share && init.method && init.method.toUpperCase() !== "GET") {
    throw new ApiRequestError("publication_read_only", undefined, "公开链接只允许查看项目。");
  }
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Never store headers, request bodies, query strings or share tokens in diagnostics.
  const context: RequestContext = {
    method: (init.method ?? "GET").toUpperCase(),
    path: new URL(path, "http://dtwin.invalid").pathname,
  };
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: share ? "omit" : "include",
      headers,
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    if (!(cause instanceof TypeError)) throw cause;
    throw new ApiRequestError("network_error", undefined, cause.message, { ...context, cause });
  }
  context.status = response.status;
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  const emptyResponse = response.status === 204 || response.status === 205 || context.method === "HEAD";
  if (!emptyResponse && contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      if (!(cause instanceof SyntaxError) && !(cause instanceof TypeError)) throw cause;
      const code = cause instanceof SyntaxError ? "invalid_response" : "network_error";
      throw new ApiRequestError(code, headerRequestId, cause.message, { ...context, cause });
    }
  } else if (response.ok && !emptyResponse) {
    throw new ApiRequestError("invalid_response", headerRequestId,
      `Expected a JSON response; received ${contentType || "no Content-Type"}.`, context);
  }

  if (!response.ok) {
    const failure = payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? payload as ApiFailure : null;
    throw new ApiRequestError(
      typeof failure?.error === "string" && failure.error ? failure.error : "request_failed",
      typeof failure?.requestId === "string" && failure.requestId ? failure.requestId : headerRequestId,
      typeof failure?.message === "string" && failure.message ? failure.message : `API request failed with HTTP ${response.status}.`,
      context,
    );
  }

  return payload as T;
}

export const errorMessage = (reason: unknown): string => {
  if (reason instanceof ApiRequestError) {
    const presentation = errorPresentation(reason);
    // Existing string-only notices retain unknown business errors and their trace IDs.
    const message = !Object.hasOwn(userMessages, reason.code) && presentation.message !== reason.message
      ? `${presentation.message} 原始信息：${reason.message}（错误码：${reason.code}）`
      : presentation.message;
    return reason.requestId
      ? `${message}（请求 ID：${reason.requestId}）`
      : message;
  }

  return reason instanceof Error ? reason.message : String(reason);
};
