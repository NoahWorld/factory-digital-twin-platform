import { useEffect } from "react";
import { errorPresentation, reportError } from "../api";

/** Persistent loading failures only. User actions use the global notification provider. */
export function ErrorNotice({ error }: { error: unknown }) {
  useEffect(() => {
    if (error !== null && error !== undefined) reportError(error);
  }, [error]);
  if (error === null || error === undefined) return null;
  return <p className="form-error error-notice" role="alert">{errorPresentation(error).message}</p>;
}
