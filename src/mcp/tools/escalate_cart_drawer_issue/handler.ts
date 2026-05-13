/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateCartDrawerInput,
  EscalateCartDrawerOutput,
} from "@/mcp/tools/escalate_cart_drawer_issue/shapes.js";
import {
  looksLikePlaceholder,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "live_preview_url";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  editor_link: "link editor",
  live_preview_url: "link live preview",
};

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateCartDrawerIssueHandler(
  input: EscalateCartDrawerInput
): Promise<EscalateCartDrawerOutput> {
  const missing: MissingField[] = [];

  if (!input.editor_link) missing.push("editor_link");
  if (!input.live_preview_url) missing.push("live_preview_url");

  // Reject obvious placeholders. Hugo sometimes invents values like
  // "YOUR_STORE", "example.com", "dummyimage.com" to satisfy the schema
  // instead of asking the user. Treat these as "missing".
  if (input.editor_link && looksLikePlaceholder(input.editor_link)) {
    if (!missing.includes("editor_link")) missing.push("editor_link");
  }
  if (input.live_preview_url && looksLikePlaceholder(input.live_preview_url)) {
    if (!missing.includes("live_preview_url")) missing.push("live_preview_url");
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
        "Not ready for escalation — Hugo MUST ask the user for the real editor link and live preview URL, then call this tool again with the user's actual values. Do NOT fabricate placeholder URLs.",
    };
  }

  // Successful-escalation branch is added in Task 6.
  throw new Error("not implemented: ready-to-escalate branch (added in Task 6)");
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { escalateCartDrawerIssueHandler };
