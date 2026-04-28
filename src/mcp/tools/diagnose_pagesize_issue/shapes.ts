/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA - Define what Hugo needs to ask the user
 ***************************************************************************/

const DIAGNOSE_PAGESIZE_INPUT_SHAPE = z.object({
  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor link (e.g., https://admin.shopify.com/store/YOUR_STORE/apps/pagefly/editor?type=page&id=PAGE_ID)"
    ),
});

type DiagnosizePageSizeInput = z.infer<
  typeof DIAGNOSE_PAGESIZE_INPUT_SHAPE
>;

/**************************************************************************
 * OUTPUT SCHEMA - Define what the tool returns to Hugo
 ***************************************************************************/

const ELEMENT_BREAKDOWN = z.object({
  id: z.string().describe("Unique identifier of the element"),
  name: z.string().describe("Name or type of the element (e.g., 'Product Detail')"),
  size_kb: z.number().describe("Size in kilobytes"),
  percentage: z.number().describe("Percentage of total page size"),
});

const DIAGNOSE_PAGESIZE_OUTPUT_SHAPE = z.object({
  page_id: z.string().describe("The PageFly page ID extracted from the link"),
  current_size_kb: z
    .number()
    .describe("Current page size in kilobytes"),
  size_limit_kb: z
    .number()
    .describe("Page size limit in kilobytes"),
  is_over_limit: z
    .boolean()
    .describe("Whether the page exceeds the size limit"),
  elements: z
    .array(ELEMENT_BREAKDOWN)
    .describe("Breakdown of page size by elements, sorted by size (largest first)"),
  largest_element: ELEMENT_BREAKDOWN.describe(
    "The element consuming the most space"
  ),
  recommendation: z.string().describe("Recommendation on what to do to reduce page size"),
});

type DiagnosizePageSizeOutput = z.infer<
  typeof DIAGNOSE_PAGESIZE_OUTPUT_SHAPE
>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  DIAGNOSE_PAGESIZE_INPUT_SHAPE,
  DIAGNOSE_PAGESIZE_OUTPUT_SHAPE,
  type DiagnosizePageSizeInput,
  type DiagnosizePageSizeOutput,
};
