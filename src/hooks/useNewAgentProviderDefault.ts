import { useEffect, useRef, useState } from "react";
import {
  integrations,
  type NewAgentProviderSettings,
  type RuntimeConnection,
} from "../api";

export function useNewAgentProviderDefault(
  projectID: string | undefined,
  connections: RuntimeConnection[],
) {
  const [settings, setSettings] = useState<NewAgentProviderSettings | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    revision.current += 1;
    setBusy(false);
    setSaved(false);
    let cancelled = false;
    setSettings(null);
    setError("");
    integrations
      .newAgentProvider(projectID)
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err?.message || "Could not load the default provider.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectID, connections, retry]);

  const save = async (provider: string) => {
    const currentRevision = revision.current;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const next = await integrations.setNewAgentProvider(provider, projectID);
      if (revision.current === currentRevision) {
        setSettings(next);
        setSaved(true);
      }
    } catch (err: any) {
      if (revision.current === currentRevision)
        setError(err?.message || "Could not save the default provider.");
    } finally {
      if (revision.current === currentRevision) setBusy(false);
    }
  };
  return {
    settings,
    busy,
    error,
    saved,
    save,
    retry: () => setRetry((value) => value + 1),
  };
}
