/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { diagnosizeFontIssueHandler } from "@/mcp/tools/diagnose_font_issue/handler.js";
import {
  DIAGNOSE_FONT_INPUT_SHAPE,
  DIAGNOSE_FONT_OUTPUT_SHAPE,
} from "@/mcp/tools/diagnose_font_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  DiagnosizeFontInput,
  DiagnosizeFontOutput,
} from "@/mcp/tools/diagnose_font_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "diagnose_font_issue" tool with the MCP server.
 *
 * This tool helps diagnose and fix font-related issues where the live/preview page
 * displays different fonts than what's in the editor.
 *
 * Workflow:
 * 1. Hugo asks what's different (image, color, font, layout, etc.)
 * 2. User says "font"
 * 3. Hugo asks for screenshot/description of the issue
 * 4. Hugo calls this tool with the description
 * 5. Tool analyzes and identifies the font
 * 6. Tool provides solution:
 *    - If Google Font: Direct CSS code to add
 *    - If Custom Font: Escalate to support with details
 * 7. Hugo guides user through fix or escalates to support
 */
function registerDiagnosizeFontIssueTool(server: McpServer): void {
  server.registerTool(
    "diagnose_font_issue",
    {
      title: "Diagnose and fix font issues",
      description: `
        Use this tool to diagnose and fix font-related issues in PageFly pages.

        When to use this tool:
        - User reports font looks different in live vs editor
        - Font renders incorrectly in preview
        - Wrong font family is showing up
        - Custom font is not loading

        How it works:
        1. Takes a description of the font issue and screenshot details
        2. Identifies which font should be used
        3. Determines if it's a Google Font or custom font
        4. Provides a solution:
           - Google Font: Direct CSS code to add to custom CSS
           - Custom Font: Escalation info for support team

        Example conversation:
        User: "My website font looks different from the editor"
        Hugo: "I can help with that. Is it the image, colors, font, or layout that's different?"
        User: "It's the font. Looks like a serif instead of sans-serif"
        Hugo: "Can you describe what font should be there?"
        User: "It should be Roboto"
        Hugo: [calls diagnose_font_issue tool]
        Hugo: "Found it! Roboto is a Google Font. Here's how to fix it:
               1. Copy this CSS code
               2. Go to PageFly → Design → Custom CSS
               3. Paste and publish
               Should take 5 minutes!"

        Common fonts handled:
        - Roboto
        - Open Sans
        - Montserrat
        - Playfair Display
        - Poppins
        - Inter
        - Lato
        - Raleway
      `,
      inputSchema: DIAGNOSE_FONT_INPUT_SHAPE,
      outputSchema: DIAGNOSE_FONT_OUTPUT_SHAPE,
    },
    async (input: DiagnosizeFontInput) => {
      const output: DiagnosizeFontOutput = diagnosizeFontIssueHandler(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    },
  );
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerDiagnosizeFontIssueTool };
