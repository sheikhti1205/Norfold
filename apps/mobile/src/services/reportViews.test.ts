import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordReportView } from "./reportViews";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabaseClient", () => ({ getSupabase: () => ({ rpc }) }));

describe("recordReportView", () => {
  beforeEach(() => rpc.mockReset());

  it("records the report id", async () => {
    rpc.mockResolvedValue({ error: null });
    await recordReportView("report-id");
    expect(rpc).toHaveBeenCalledWith("findback_record_report_view", { p_report_id: "report-id" });
  });

  it("never surfaces RPC errors", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    await expect(recordReportView("report-id")).resolves.toBeUndefined();
    rpc.mockResolvedValue({ error: new Error("denied") });
    await expect(recordReportView("report-id")).resolves.toBeUndefined();
  });
});
