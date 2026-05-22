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
import { registerEscalateSectionIssueTool } from "@/mcp/tools/escalate_section_issue/main.js";
import { registerEscalateHorizontalScrollIssueTool } from "@/mcp/tools/escalate_horizontal_scroll_issue/main.js";
import { registerEscalateThemeOverrideIssueTool } from "@/mcp/tools/escalate_theme_override_issue/main.js";
import { registerEscalateSpeedPageIssueTool } from "@/mcp/tools/escalate_speed_page_issue/main.js";
import { registerEscalateScrollSectionIssueTool } from "@/mcp/tools/escalate_scroll_section_issue/main.js";
import { registerEscalateStickyIssueTool } from "@/mcp/tools/escalate_sticky_issue/main.js";
import { registerEscalateHiddenSoldoutIssueTool } from "@/mcp/tools/escalate_hidden_soldout_issue/main.js";
import { registerEscalateUploadImageIssueTool } from "@/mcp/tools/escalate_upload_image_issue/main.js";
import { registerEscalateMissImageIssueTool } from "@/mcp/tools/escalate_miss_image_issue/main.js";
import { registerEscalate404PageIssueTool } from "@/mcp/tools/escalate_404_page_issue/main.js";
import { registerEscalateThemePageflyMissIssueTool } from "@/mcp/tools/escalate_themepagefly_miss_issue/main.js";
import { registerEscalateApiIntegrationIssueTool } from "@/mcp/tools/escalate_api_integration_issue/main.js";
import { registerEscalatePartnerIssueTool } from "@/mcp/tools/escalate_partner_issue/main.js";
import { registerEscalateVariantAbTestingIssueTool } from "@/mcp/tools/escalate_variant_abtesting_issue/main.js";
import { registerEscalateOverrideSectionThemeIssueTool } from "@/mcp/tools/escalate_override_section_theme_issue/main.js";
import { registerEscalatePublishLiquidErrorIssueTool } from "@/mcp/tools/escalate_publish_liquid_error_issue/main.js";
import { registerEscalateWhitePageIssueTool } from "@/mcp/tools/escalate_white_page_issue/main.js";
import { registerEscalateLiveDifferentEditorIssueTool } from "@/mcp/tools/escalate_live_different_editor_issue/main.js";
import { registerEscalateElementNotworkingIssueTool } from "@/mcp/tools/escalate_element_notworking_issue/main.js";
import { registerEscalateRedirectCheckoutIssueTool } from "@/mcp/tools/escalate_redirect_checkout_issue/main.js";
import { registerEscalatePopupErrorIssueTool } from "@/mcp/tools/escalate_popup_error_issue/main.js";
import { registerEscalateVariantMediaIssueTool } from "@/mcp/tools/escalate_variant_media_issue/main.js";
import { registerEscalateEventButtonIssueTool } from "@/mcp/tools/escalate_event_button_issue/main.js";
import { registerEscalateFormIssueTool } from "@/mcp/tools/escalate_form_issue/main.js";
import { registerEscalateDuplicateWidgetIssueTool } from "@/mcp/tools/escalate_duplicate_widget_issue/main.js";
import { registerEscalateRemoveSpaceIssueTool } from "@/mcp/tools/escalate_remove_space_issue/main.js";
import { registerEscalateAppErrorPositionIssueTool } from "@/mcp/tools/escalate_app_error_position_issue/main.js";
import { registerEscalateSchemaPageflyIssueTool } from "@/mcp/tools/escalate_schema_pagefly_issue/main.js";
import { registerEscalateAnimationBrokenIssueTool } from "@/mcp/tools/escalate_animation_broken_issue/main.js";
import { registerEscalateJsPageflyIssueTool } from "@/mcp/tools/escalate_js_pagefly_issue/main.js";
import { registerEscalateVideoNotAutoIssueTool } from "@/mcp/tools/escalate_video_not_auto_issue/main.js";
import { registerEscalateElementNotShowIssueTool } from "@/mcp/tools/escalate_element_not_show_issue/main.js";
import { registerEscalateBackgroundMobileIssueTool } from "@/mcp/tools/escalate_background_mobile_issue/main.js";
import { registerEscalateProductNotAssignIssueTool } from "@/mcp/tools/escalate_product_not_assign_issue/main.js";
import { registerEscalateComparePriceIssueTool } from "@/mcp/tools/escalate_compare_price_issue/main.js";
import { registerEscalateBadgeIssueTool } from "@/mcp/tools/escalate_badge_issue/main.js";
import { registerEscalateApiFeatureIssueTool } from "@/mcp/tools/escalate_api_feature_issue/main.js";
import { registerEscalatePageflyAnalyticsIssueTool } from "@/mcp/tools/escalate_pagefly_analytics_issue/main.js";
import { registerEscalateAbTestingIssueTool } from "@/mcp/tools/escalate_ab_testing_issue/main.js";
import { registerEscalateGtmIssueTool } from "@/mcp/tools/escalate_gtm_issue/main.js";
import { registerEscalateSeoToolIssueTool } from "@/mcp/tools/escalate_seo_tool_issue/main.js";
import { registerEscalateSourceRevertIssueTool } from "@/mcp/tools/escalate_source_revert_issue/main.js";
import { registerEscalateImagePreviewIssueTool } from "@/mcp/tools/escalate_image_preview_issue/main.js";
import { registerEscalateHeaderFooterIssueTool } from "@/mcp/tools/escalate_header_footer_issue/main.js";
import { registerEscalateUnderlineIssueTool } from "@/mcp/tools/escalate_underline_issue/main.js";
import { registerEscalateHerobannerIssueTool } from "@/mcp/tools/escalate_herobanner_issue/main.js";

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
  registerEscalateSectionIssueTool(server);
  registerEscalateHorizontalScrollIssueTool(server);
  registerEscalateThemeOverrideIssueTool(server);
  registerEscalateSpeedPageIssueTool(server);
  registerEscalateScrollSectionIssueTool(server);
  registerEscalateStickyIssueTool(server);
  registerEscalateHiddenSoldoutIssueTool(server);
  registerEscalateUploadImageIssueTool(server);
  registerEscalateMissImageIssueTool(server);
  registerEscalate404PageIssueTool(server);
  registerEscalateThemePageflyMissIssueTool(server);
  registerEscalateApiIntegrationIssueTool(server);
  registerEscalatePartnerIssueTool(server);
  registerEscalateVariantAbTestingIssueTool(server);
  registerEscalateOverrideSectionThemeIssueTool(server);
  registerEscalatePublishLiquidErrorIssueTool(server);
  registerEscalateWhitePageIssueTool(server);
  registerEscalateLiveDifferentEditorIssueTool(server);
  registerEscalateElementNotworkingIssueTool(server);
  registerEscalateRedirectCheckoutIssueTool(server);
  registerEscalatePopupErrorIssueTool(server);
  registerEscalateVariantMediaIssueTool(server);
  registerEscalateEventButtonIssueTool(server);
  registerEscalateFormIssueTool(server);
  registerEscalateDuplicateWidgetIssueTool(server);
  registerEscalateRemoveSpaceIssueTool(server);
  registerEscalateAppErrorPositionIssueTool(server);
  registerEscalateSchemaPageflyIssueTool(server);
  registerEscalateAnimationBrokenIssueTool(server);
  registerEscalateJsPageflyIssueTool(server);
  registerEscalateVideoNotAutoIssueTool(server);
  registerEscalateElementNotShowIssueTool(server);
  registerEscalateBackgroundMobileIssueTool(server);
  registerEscalateProductNotAssignIssueTool(server);
  registerEscalateComparePriceIssueTool(server);
  registerEscalateBadgeIssueTool(server);
  registerEscalateApiFeatureIssueTool(server);
  registerEscalatePageflyAnalyticsIssueTool(server);
  registerEscalateAbTestingIssueTool(server);
  registerEscalateGtmIssueTool(server);
  registerEscalateSeoToolIssueTool(server);
  registerEscalateSourceRevertIssueTool(server);
  registerEscalateImagePreviewIssueTool(server);
  registerEscalateHeaderFooterIssueTool(server);
  registerEscalateUnderlineIssueTool(server);
  registerEscalateHerobannerIssueTool(server);
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerTools };
