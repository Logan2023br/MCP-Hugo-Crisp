/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateApiFeatureInput,
  EscalateApiFeatureOutput,
} from "@/mcp/tools/escalate_api_feature_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  hasAnyReferenceMedia,
  looksLikePlaceholder,
  pickMissingInfoMessage,
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type FeatureType =
  | "api_translation"
  | "smart_page"
  | "ai_credit"
  | "ai_credit_refund";

type MissingField = "editor_link" | "screenshot" | "publish_status";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the affected page",
  screenshot:
    "a screenshot of the error (paste link or attach the file directly in chat)",
  publish_status:
    "whether the technical team may publish the page after fixing or only save it",
};

const PUBLISH_STATUS_LABEL: Record<"published" | "only_save", string> = {
  published: "Allowed to publish",
  only_save: "Only Save",
};

const FEATURE_LABEL: Record<FeatureType, string> = {
  api_translation: "API Translation",
  smart_page: "Smart Page",
  ai_credit: "AI Credit",
  ai_credit_refund: "AI Credit Refund",
};

function featureNeedsEditorContext(featureType: FeatureType): boolean {
  return featureType !== "smart_page";
}

/**************************************************************************
 * NOTE FORMAT
 *
 * Always: Issue line, Feature line, Ticket line.
 * For non-smart-page: also Editor line + status line.
 ***************************************************************************/

interface ApiFeatureNoteFields {
  issueDescription: string;
  featureType: FeatureType;
  editorLink?: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
  publishStatus?: "published" | "only_save";
}

function formatApiFeatureNoteContent(
  fields: ApiFeatureNoteFields,
  ticketUrl: string
): string {
  const evidenceFragment = formatReferenceMedia(
    {
      urls: fields.screenshotUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "screenshot"
  );
  const issueLine = evidenceFragment
    ? `Issue: ${fields.issueDescription}, ${evidenceFragment}`
    : `Issue: ${fields.issueDescription}`;
  const featureLine = `Feature: ${FEATURE_LABEL[fields.featureType]}`;

  const lines = [issueLine, featureLine];
  if (fields.editorLink) {
    lines.push(`Editor: ${fields.editorLink}`);
  }
  lines.push(`Ticket: ${ticketUrl}`);
  if (fields.publishStatus) {
    lines.push(PUBLISH_STATUS_LABEL[fields.publishStatus]);
  }
  return lines.join("\n");
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateApiFeatureIssueHandler(
  input: EscalateApiFeatureInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateApiFeatureOutput> {
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateApiFeatureOutput;
  }

  const needsEditorContext = featureNeedsEditorContext(input.feature_type);

  // Editor-exit gate only when an editor is involved.
  if (needsEditorContext) {
    const editorExit = await requireEditorExit(
      input.user_exited_editor,
      input.customer_last_message_text
    );
    if (!editorExit.ready) {
      return {
        issue_summary:
          "Need confirmation that the customer has exited the editor before escalating.",
        session_match: undefined,
        ...editorExit.output,
      } as EscalateApiFeatureOutput;
    }
  }

  const missing: MissingField[] = [];

  if (needsEditorContext) {
    if (!input.editor_link || looksLikePlaceholder(input.editor_link)) {
      missing.push("editor_link");
    }
    if (
      input.publish_status !== "published" &&
      input.publish_status !== "only_save"
    ) {
      missing.push("publish_status");
    }
  }

  if (
    !hasAnyReferenceMedia({
      urls: input.screenshot_urls,
      hasAttachedFiles: input.customer_attached_files,
    })
  ) {
    missing.push("screenshot");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect the required info for this feature_type. Do NOT fabricate URLs or status values.",
    };
  }

  const editorLink = needsEditorContext ? (input.editor_link as string) : undefined;
  const publishStatus = needsEditorContext ? input.publish_status : undefined;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_api_feature_issue", editorLink ?? ""),
    fields: {
      issueDescription: issueDescriptionEn,
      featureType: input.feature_type,
      editorLink,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
      publishStatus,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatApiFeatureNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_api_feature_issue] match: feature=${input.feature_type} session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_api_feature_issue] match: posted=false error=${noteResult.error}`
    );
  }

  return {
    issue_summary: input.issue_description,
    is_ready_for_escalation: true,
    missing_info: [],
    crisp_note: {
      content: noteResult.noteContent,
      formatted_message: noteResult.noteContent,
    },
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
    note_posted: noteResult.posted,
    note_post_error: noteResult.error,
    session_match: noteResult.match
      ? {
          score: noteResult.match.score,
          signals_matched: noteResult.match.signalsMatched,
          threshold_met: noteResult.match.thresholdMet,
        }
      : undefined,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { escalateApiFeatureIssueHandler, formatApiFeatureNoteContent };
