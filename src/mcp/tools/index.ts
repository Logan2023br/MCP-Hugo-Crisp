/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGetUserTool } from "@/mcp/tools/get_user/main.js";
import { registerGetProductTool } from "@/mcp/tools/get_product/main.js";
import { registerGetOrderTool } from "@/mcp/tools/get_order/main.js";
import { registerDiagnosizePageSizeIssueTool } from "@/mcp/tools/diagnose_pagesize_issue/main.js";
import { registerDiagnosizeFontIssueTool } from "@/mcp/tools/diagnose_font_issue/main.js";
import { registerEscalateScrollIssueTool } from "@/mcp/tools/escalate_scroll_issue/main.js";
import { registerEscalateCartDrawerIssueTool } from "@/mcp/tools/escalate_cart_drawer_issue/main.js";
import { registerEscalateAppsIssueTool } from "@/mcp/tools/escalate_apps_issue/main.js";
import { registerEscalateAnimationIssueTool } from "@/mcp/tools/escalate_animation_issue/main.js";
import { registerEscalatePageBrokenIssueTool } from "@/mcp/tools/escalate_page_broken_issue/main.js";

/**************************************************************************
 * MAIN
 ***************************************************************************/

// Helper function to register our tools
function registerTools(server: McpServer): void {
  registerGetUserTool(server);
  registerGetProductTool(server);
  registerGetOrderTool(server);
  registerDiagnosizePageSizeIssueTool(server);
  registerDiagnosizeFontIssueTool(server);
  registerEscalateScrollIssueTool(server);
  registerEscalateCartDrawerIssueTool(server);
  registerEscalateAppsIssueTool(server);
  registerEscalateAnimationIssueTool(server);
  registerEscalatePageBrokenIssueTool(server);
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerTools };
