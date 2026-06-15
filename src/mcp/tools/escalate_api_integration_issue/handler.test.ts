import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateApiIntegrationIssueHandler,
  formatApiIntegrationNoteContent,
} from "./handler.ts";

test("api-integration: ready immediately with just issue_description", async () => {
  // No access check, no editor-exit gate — handler reaches tryPostNoteWithScoring
  // directly. In the test env (no Crisp creds), posting fails but is_ready stays true.
  const out = await escalateApiIntegrationIssueHandler({
    issue_description: "Customer asks if PageFly can publish/integrate an API",
  });
  assert.equal(out.is_ready_for_escalation, true);
  assert.deepEqual(out.missing_info, []);
});

test("api-integration: wait message comes back English by default (no Claude key)", async () => {
  const out = await escalateApiIntegrationIssueHandler({
    issue_description: "Customer requests API",
  });
  assert.match(out.next_step_for_user, /Thanks for sharing|update soon/i);
});

test("api-integration: wait message comes back Vietnamese when customer chats VI (no Claude key)", async () => {
  const out = await escalateApiIntegrationIssueHandler({
    issue_description: "Customer requests API",
    customer_last_message_text: "Bạn có thể cung cấp API cho mình không",
  });
  assert.match(out.next_step_for_user, /Cảm ơn|team technical/);
});

test("formatApiIntegrationNoteContent: 2-line note", () => {
  const note = formatApiIntegrationNoteContent(
    {
      issueDescription:
        "Customer asks if PageFly can publish/integrate an API; standard reply did not satisfy, requesting technical review.",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer asks if PageFly can publish/integrate an API; standard reply did not satisfy, requesting technical review.\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});
