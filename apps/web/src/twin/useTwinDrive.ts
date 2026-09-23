import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { twinDrivePath, type TwinDriveDocument } from "../../../../shared/twin-drive";
import { apiUrl, errorMessage, request } from "../api";
import { TwinPointStream, type TwinStreamState } from "./point-stream";

export function useTwinDrive(projectId: string, { live = true }: { live?: boolean } = {}) {
  const [document, setDocument] = useState<TwinDriveDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  // Explicit reconnect is a new source identity so the scene also clears its sequence fence.
  // Automatic transport retries retain the same identity and must still reject rollback.
  const reconnect = useCallback(() => setConnectionEpoch((value) => value + 1), []);
  // Every saved revision owns a fresh simulator sequence, even if its JSON content is unchanged.
  const documentRevision = document?.projectId === projectId ? document.revision : null;
  const source = useMemo(() => {
    const url = new URL(apiUrl("/api/v1/twin-drive"), window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("projectId", projectId);
    return new TwinPointStream(url.toString(), projectId, reload);
  }, [projectId, reload, connectionEpoch, documentRevision]);
  const [stream, setStream] = useState<TwinStreamState>(() => source.getState());
  const currentProject = useRef(projectId);
  currentProject.current = projectId;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void request<TwinDriveDocument>(twinDrivePath(projectId)).then((result) => {
      if (active) setDocument(result);
    }).catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, reloadToken]);

  useEffect(() => {
    if (!live) { setStream(source.getState()); return; }
    let changed = true;
    setStream(source.getState());
    const unsubscribe = source.subscribe(() => { changed = true; });
    const timer = setInterval(() => {
      if (changed) { changed = false; setStream(source.getState()); }
    }, 200);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [source, live]);

  const enabled = document?.projectId === projectId && document.config.enabled;
  useEffect(() => {
    if (live && enabled && document) { source.setConfiguration(document.revision, document.config.points); source.connect(); }
    return () => source.close();
  }, [enabled, document, source, live]);

  const acceptDocument = useCallback((next: TwinDriveDocument) => {
    if (next.projectId === currentProject.current) { setDocument(next); setError(null); }
  }, []);

  return { document, loading, error, source, stream, reload, reconnect, acceptDocument };
}
