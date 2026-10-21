import { realtimeSelection } from "../realtime/config";
import { useEffect, useState } from "react";
import { core, type RealtimeAvailability } from "../api";

const unavailable: RealtimeAvailability = {
  enabled: false,
  available: false,
  voice: "marin",
  mcp: [],
  provider: "openai-realtime",
};

export function useRealtimeAvailability(agentId?: number, running = false): RealtimeAvailability {
  const [value, setValue] = useState<RealtimeAvailability>(unavailable);
  useEffect(() => {
    if (!agentId || !running) {
      setValue(unavailable);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      core.config(agentId).then((config) => {
        if (cancelled) return;
        const { provider, model, modelTier, voice, execution } = realtimeSelection(config);
        const attached = new Set((config.mcp_servers || []).map((server) => server.name));
        setValue({
          enabled: !!config.realtime_enabled,
          available: !!provider,
          voice,
          model,
          modelTier,
          execution,
          mcp: (config.realtime_voice_mcp || []).filter((name) => attached.has(name)),
          provider: provider?.name || "openai-realtime",
        });
      }).catch(() => {
        if (!cancelled) setValue(unavailable);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentId, running]);
  return value;
}
