import { describe, expect, test } from "bun:test";
import { serializeSubscriptionFilters } from "./subscriptionFilters";

describe("serializeSubscriptionFilters", () => {
  test("serializes direct scalar and array-member filter values", () => {
    expect(serializeSubscriptionFilters(
      [
        { field: "list_ids", value: "2" },
        { field: "activity_event", value: "makecademy_lead_captured" },
        { field: "active", value: "true" },
      ],
      { list_ids: "array", activity_event: "string", active: "boolean" },
    )).toEqual({
      list_ids: 2,
      activity_event: "makecademy_lead_captured",
      active: true,
    });
  });

  test("trims fields and ignores incomplete rows", () => {
    expect(serializeSubscriptionFilters([
      { field: " source ", value: " campaign " },
      { field: "", value: "ignored" },
      { field: "list_ids", value: "" },
    ])).toEqual({ source: "campaign" });
  });
});
