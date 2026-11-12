import { getSupabase } from "./supabaseClient";

/** Call once when a report detail mounts; recording never interrupts reading. */
export async function recordReportView(reportId: string): Promise<void> {
  try {
    await getSupabase().rpc("findback_record_report_view", { p_report_id: reportId });
  } catch {
    // Impressions are best-effort.
  }
}
