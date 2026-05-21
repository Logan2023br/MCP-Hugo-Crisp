import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalatePartnerIssueHandler,
  formatPartnerNoteContent,
} from "./handler.ts";

test("partner: ready immediately with just issue_description", async () => {
  const out = await escalatePartnerIssueHandler({
    issue_description: "Customer wants to become a PageFly affiliate partner",
  });
  assert.equal(out.is_ready_for_escalation, true);
  assert.deepEqual(out.missing_info, []);
});

test("partner: wait message comes back English by default (no Claude key)", async () => {
  const out = await escalatePartnerIssueHandler({
    issue_description: "Customer wants to integrate their app with PageFly",
  });
  assert.match(out.next_step_for_user, /Thank you|technical team/i);
});

test("partner: wait message comes back Vietnamese when customer chats VI (no Claude key)", async () => {
  const out = await escalatePartnerIssueHandler({
    issue_description: "Customer wants partnership",
    customer_last_message_text: "Mình muốn làm partner của PageFly",
  });
  assert.match(out.next_step_for_user, /Cảm ơn|team technical/);
});

test("formatPartnerNoteContent: 2-line note", () => {
  const note = formatPartnerNoteContent(
    {
      issueDescription: "Customer wants to integrate their app with PageFly element library.",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer wants to integrate their app with PageFly element library.\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});
