import { useEffect, useState, type ComponentProps } from "react";
import { errorMessage } from "../api";
import { invalidateResourceAccess, resolveResourceAccess } from "./resources";

function useResourceUrl(path: string) {
  const [state, setState] = useState<{ path: string; url?: string; error?: string }>({ path });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path });
    void resolveResourceAccess(path, controller.signal).then(access => {
      if (!controller.signal.aborted) setState({ path, url: access.url });
    }).catch(reason => {
      if (!controller.signal.aborted) setState({ path, error: errorMessage(reason) });
    });
    return () => controller.abort();
  }, [path, retry]);
  return {
    ...(state.path === path ? state : { path }),
    failed: () => setState({ path, error: "资源读取失败，请重新加载。" }),
    reload: () => { invalidateResourceAccess(path); setRetry(value => value + 1); },
  };
}

type ImageProps = Omit<ComponentProps<"img">, "src"> & { src: string };
type VideoProps = Omit<ComponentProps<"video">, "src"> & { src: string };
type AudioProps = Omit<ComponentProps<"audio">, "src"> & { src: string };
function ResourceState({ error, reload }: { error?: string; reload: () => void }) {
  return <span data-cover-state={error ? "error" : "loading"} role={error ? "alert" : "status"} className="iot-resource-state">
    {error ?? "正在读取资源…"}
    {error ? <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); reload(); }}>重新加载</button> : null}
  </span>;
}
export function ResourceImage({ src, onError, ...props }: ImageProps) {
  const resource = useResourceUrl(src);
  return resource.url && !resource.error
    ? <img {...props} src={resource.url} referrerPolicy="no-referrer" onError={event => { resource.failed(); onError?.(event); }} />
    : <ResourceState error={resource.error} reload={resource.reload} />;
}
export function ResourceVideo({ src, onError, ...props }: VideoProps) {
  const resource = useResourceUrl(src);
  return resource.url && !resource.error
    ? <video {...props} src={resource.url} onError={event => { resource.failed(); onError?.(event); }} />
    : <ResourceState error={resource.error} reload={resource.reload} />;
}
export function ResourceAudio({ src, onError, ...props }: AudioProps) {
  const resource = useResourceUrl(src);
  return resource.url && !resource.error
    ? <audio {...props} src={resource.url} onError={event => { resource.failed(); onError?.(event); }} />
    : <ResourceState error={resource.error} reload={resource.reload} />;
}
