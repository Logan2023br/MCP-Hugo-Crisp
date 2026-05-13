/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateAppsInput,
  EscalateAppsOutput,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";
import { looksLikePlaceholder } from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_links" | "media_urls" | "publish_status";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  editor_links: "link editor",
  media_urls: "hình ảnh hoặc video",
  publish_status: "trạng thái publish (đã publish hay chỉ save)",
};

/**************************************************************************
 * URL FILTERING
 ***************************************************************************/

function filterValidUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((u) => typeof u === "string" && u.length > 0 && !looksLikePlaceholder(u));
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateAppsIssueHandler(
  input: EscalateAppsInput
): Promise<EscalateAppsOutput> {
  const validEditors = filterValidUrls(input.editor_links);
  const validMedia = filterValidUrls(input.media_urls);

  const missing: MissingField[] = [];
  if (validEditors.length === 0) missing.push("editor_links");
  if (validMedia.length === 0) missing.push("media_urls");
  if (input.publish_status !== "published" && input.publish_status !== "only_save") {
    missing.push("publish_status");
  }

  if (missing.length > 0) {
    const labels = missing.map((key) => MISSING_FIELD_LABEL[key]).join(", ");
    return {
      issue_summary: "Cần thêm thông tin trước khi escalate cho technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labels} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`,
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real editor link(s), image/video showing the issue, and publish status. Do NOT fabricate URLs or status values.",
    };
  }

  // Successful-escalation branch added in Task 3.
  throw new Error("not implemented: ready-to-escalate branch (added in Task 3)");
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { escalateAppsIssueHandler };
