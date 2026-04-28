/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { diagnosizePageSizeIssueHandler } from "@/mcp/tools/diagnose_pagesize_issue/handler.js";
import {
  DIAGNOSE_PAGESIZE_INPUT_SHAPE,
  DIAGNOSE_PAGESIZE_OUTPUT_SHAPE,
} from "@/mcp/tools/diagnose_pagesize_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  DiagnosizePageSizeInput,
  DiagnosizePageSizeOutput,
} from "@/mcp/tools/diagnose_pagesize_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "diagnose_pagesize_issue" tool with the MCP server.
 * 
 * This tool helps diagnose why a PageFly page exceeds the size limit
 * by analyzing which elements are consuming the most space.
 */
function registerDiagnosizePageSizeIssueTool(server: McpServer): void {
  server.registerTool(
    "diagnose_pagesize_issue",
    {
      title: "Diagnose PageFly page size issue",
      description: `
        Use this tool to diagnose why a PageFly page exceeds the 256KB size limit.

        How it works:
        1. Takes a PageFly editor link as input
        2. Analyzes the page's elements and their sizes
        3. Identifies which element is consuming the most space
        4. Provides a recommendation on how to reduce the page size

        Example use case:
        - User: "My PageFly page is exceeding the 256KB limit and I don't know why"
        - Hugo: "Let me check that for you. Can you share the PageFly editor link?"
        - User: [shares link]
        - Hugo: [calls this tool with the link]
        - Tool returns: Page is 350KB, Product Detail section is too large, suggest removing it
        - Hugo: "Your page is 350KB. The Product Detail section is 180KB (51% of total). 
                 Remove it and use Product List instead to save 85KB!"

        Common recommendations:
        - Replace heavy components (Product Detail) with lighter alternatives (Product List)
        - Remove unused sections
        - Optimize images and media
      `,
      inputSchema: DIAGNOSE_PAGESIZE_INPUT_SHAPE,
      outputSchema: DIAGNOSE_PAGESIZE_OUTPUT_SHAPE,
    },
    async (input: DiagnosizePageSizeInput) => {
      const output: DiagnosizePageSizeOutput = diagnosizePageSizeIssueHandler(input);

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

export { registerDiagnosizePageSizeIssueTool };
