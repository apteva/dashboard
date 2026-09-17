import { useState } from "react";

export function IntegrationLogo({ src, name }: { src?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-input text-accent font-bold" aria-hidden="true">
      {src && !broken ? <img src={src} alt="" loading="lazy" className="h-6 w-6 object-contain" onError={() => setBroken(true)} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

