import { errorPresentation } from "../api";

type ErrorNoticeProps = {
  error: unknown;
};

export function ErrorNotice({ error }: ErrorNoticeProps) {
  if (error === null || error === undefined) return null;

  const { message, details } = errorPresentation(error);

  return (
    <div className="form-error error-notice">
      <p className="error-notice-message" role="alert">{message}</p>
      {details.length > 0 ? (
        <details className="error-notice-details">
          <summary>查看错误详情</summary>
          <p className="error-notice-help">联系管理员时，请提供以下信息。</p>
          <dl>
            {details.map(({ label, value }, index) => (
              <div className="error-notice-detail" key={`${label}-${index}`}>
                <dt>{label}</dt>
                <dd><code>{value}</code></dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
