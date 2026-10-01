import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { PRODUCT_TOUR } from "./config";

export const PRODUCT_TOUR_STATUS_EVENT = "apteva:tour-status";
// Numeric IDs are reused when a local server/database is recreated on the same
// origin. Include account creation time so its old dismissal cannot hide a new
// account's guide. Server preferences preserve history for existing accounts.
export const productTourStorageKey = (userId?: number, createdAt?: string) =>
  `apteva:tour:${userId ?? "anonymous"}:${createdAt || "unknown"}:${PRODUCT_TOUR.id}`;

type TourStatus = "skipped" | "completed";
const tourStatus = (value: unknown): TourStatus | undefined => value === "skipped" || value === "completed" ? value : undefined;
function localStatus(key: string) {
  try { return tourStatus(localStorage.getItem(key)); } catch { return undefined; }
}

function useProductTourStatus() {
  const { user } = useAuth();
  const key = productTourStorageKey(user ? user.id : undefined, user ? user.createdAt : undefined);
  const [reported, setReported] = useState<{ key: string; status?: TourStatus }>();
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; status: string }>).detail;
      if (detail?.key === key) setReported({ key, status: tourStatus(detail.status) });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setReported({ key, status: tourStatus(event.newValue) });
    };
    window.addEventListener(PRODUCT_TOUR_STATUS_EVENT, onStatus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PRODUCT_TOUR_STATUS_EVENT, onStatus);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  const statuses = [tourStatus(user ? user.productTours?.[PRODUCT_TOUR.id] : undefined), reported?.key === key ? reported.status : undefined, localStatus(key)];
  // Preserve completion when a replay is skipped, while treating both outcomes
  // as a lasting dismissal of the automatic offer and top-bar reminder.
  return statuses.includes("completed") ? "completed" : statuses.includes("skipped") ? "skipped" : undefined;
}

export function useProductTourCompleted() { return useProductTourStatus() === "completed"; }
export function useProductTourDismissed() { return useProductTourStatus() !== undefined; }
