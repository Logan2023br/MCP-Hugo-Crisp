/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const DIAGNOSE_FONT_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .describe(
      "Description of the font issue. Example: 'Font looks different in live page' or 'Font changed in preview'"
    ),
  
  screenshot_description: z
    .string()
    .describe(
      "Description of what the user sees in the screenshot. Example: 'Expected font is Roboto, but seeing serif font instead'"
    ),
  
  editor_link: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional PageFly editor link for reference. Format: https://admin.shopify.com/store/*/apps/pagefly/editor?type=page&id=*"
    ),
  
  affected_areas: z
    .array(z.string())
    .optional()
    .describe(
      "Optional array of affected areas. Example: ['hero section', 'product title', 'button text']"
    ),
});

type DiagnosizeFontInput = z.infer<typeof DIAGNOSE_FONT_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const FONT_SUGGESTION = z.object({
  name: z.string().describe("Font name (e.g., 'Roboto', 'Open Sans')"),
  type: z.enum(["google_font", "custom_font", "system_font"]).describe("Type of font"),
  cdn_link: z
    .string()
    .optional()
    .describe("CDN link to import the font (for Google Fonts)"),
  css_code: z
    .string()
    .optional()
    .describe("CSS code snippet to add to custom CSS"),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe("Confidence level of font identification (0-100)"),
});

const FONT_INSTRUCTION = z.object({
  step_number: z.number().describe("Step number in the process"),
  action: z.string().describe("What to do"),
  details: z.string().describe("Detailed instructions"),
  expected_result: z.string().describe("Expected outcome after completing this step"),
});

const DIAGNOSE_FONT_OUTPUT_SHAPE = z.object({
  issue_summary: z.string().describe("Summary of the font issue"),
  
  detected_font: FONT_SUGGESTION.describe("Detected font information"),
  
  font_type_description: z
    .string()
    .describe(
      "Explanation of the font type (Google Font, Custom Font, or System Font)"
    ),
  
  is_google_font: z
    .boolean()
    .describe("Whether the font is a Google Font that can be easily imported"),
  
  solutions: z.object({
    if_google_font: z.object({
      title: z.string(),
      description: z.string(),
      instructions: z.array(FONT_INSTRUCTION),
      css_code_snippet: z.string().describe("Complete CSS code to add"),
      expected_fix_time: z.string().describe("Estimated time to fix"),
    }),
    if_custom_font: z.object({
      title: z.string(),
      description: z.string(),
      escalation_needed: z.boolean(),
      escalation_steps: z.array(FONT_INSTRUCTION),
    }),
  }),
  
  escalation_info: z
    .object({
      is_escalation_needed: z
        .boolean()
        .describe("Whether escalation to support team is needed"),
      reason: z.string().optional().describe("Reason for escalation"),
      information_to_provide: z.array(z.string()).describe("What to tell support"),
      crisp_note_template: z
        .string()
        .describe(
          "Template note to post on Crisp for support team"
        ),
    })
    .optional(),
  
  summary_recommendation: z
    .string()
    .describe("Final recommendation for the user"),
});

type DiagnosizeFontOutput = z.infer<typeof DIAGNOSE_FONT_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  DIAGNOSE_FONT_INPUT_SHAPE,
  DIAGNOSE_FONT_OUTPUT_SHAPE,
  type DiagnosizeFontInput,
  type DiagnosizeFontOutput,
};
