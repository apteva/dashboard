import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { PRODUCT_TOUR } from "./config";

export const PRODUCT_TOUR_STATUS_EVENT = "apteva:tour-status";
// Numeric IDs are reused when a local server/database is recreated on the same
// origin. Include account creation time so its old dismissal cannot hide a new
// account's guide. Server preferences preserve history for existing accounts.
export const productTourStorageKey = (userId?: number, createdAt?: string) =>
  `apteva:tour:${userId ?? "anonymous"}:${createdAt || "unknown"}:${PRODUCT_TOUR.id}`;

function locallyCompleted(key: string) {
  try { return localStorage.getItem(key) === "completed"; } catch { return false; }
}

export function useProductTourCompleted() {
  const { user } = useAuth();
  const key = productTourStorageKey(user ? user.id : undefined, user ? user.createdAt : undefined);
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; status: string }>).detail;
      if (detail?.key === key && detail.status === "completed") setCompletedKey(key);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key && event.newValue === "completed") setCompletedKey(key);
    };
    window.addEventListener(PRODUCT_TOUR_STATUS_EVENT, onStatus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PRODUCT_TOUR_STATUS_EVENT, onStatus);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  return (!!user && user.productTours?.[PRODUCT_TOUR.id] === "completed") || completedKey === key || locallyCompleted(key);
}
