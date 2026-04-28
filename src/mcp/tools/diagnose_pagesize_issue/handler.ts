/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  DiagnosizePageSizeInput,
  DiagnosizePageSizeOutput,
} from "@/mcp/tools/diagnose_pagesize_issue/shapes.js";

/**************************************************************************
 * MOCK DATABASE - Simulating PageFly page data
 * In production, this would come from PageFly API
 ***************************************************************************/

interface MockPageData {
  page_id: string;
  page_name: string;
  elements: Array<{
    id: string;
    name: string;
    size_kb: number;
  }>;
}

// Mock database of pages with their element breakdown
const MOCK_PAGES_DATABASE: Record<string, MockPageData> = {
  "dc35f312-e929-4e59-b117-1ab6b74ce8da": {
    page_id: "dc35f312-e929-4e59-b117-1ab6b74ce8da",
    page_name: "Product Showcase",
    elements: [
      {
        id: "product-detail-section",
        name: "Product Detail Section",
        size_kb: 180,
      },
      {
        id: "product-list",
        name: "Product List",
        size_kb: 95,
      },
      {
        id: "hero-banner",
        name: "Hero Banner",
        size_kb: 45,
      },
      {
        id: "footer",
        name: "Footer",
        size_kb: 20,
      },
      {
        id: "navigation",
        name: "Navigation",
        size_kb: 10,
      },
    ],
  },
};

/**************************************************************************
 * HELPER FUNCTIONS
 ***************************************************************************/

/**
 * Extract page ID from PageFly editor link
 * Example: https://admin.shopify.com/store/loganpagefly/apps/pagefly/editor?type=page&id=dc35f312-e929-4e59-b117-1ab6b74ce8da
 */
function extractPageIdFromLink(editorLink: string): string | null {
  try {
    const url = new URL(editorLink);
    const pageId = url.searchParams.get("id");
    return pageId;
  } catch {
    return null;
  }
}

/**
 * COMMENTED OUT - API Call to PageFly (to be implemented later)
 * 
 * This is where we would make the actual API call to PageFly
 * to fetch real page data instead of using mock data.
 * 
 * async function fetchPageDataFromPageFlyAPI(pageId: string): Promise<MockPageData> {
 *   const PAGEFLY_API_BASE_URL = "https://api.pagefly.io";
 *   const PAGEFLY_API_KEY = process.env.PAGEFLY_API_KEY;
 * 
 *   try {
 *     const response = await fetch(
 *       `${PAGEFLY_API_BASE_URL}/pages/${pageId}`,
 *       {
 *         headers: {
 *           "Authorization": `Bearer ${PAGEFLY_API_KEY}`,
 *           "Content-Type": "application/json",
 *         },
 *       }
 *     );
 * 
 *     if (!response.ok) {
 *       throw new Error(`PageFly API error: ${response.statusText}`);
 *     }
 * 
 *     const data = await response.json();
 *     return transformPageFlyDataToMockFormat(data);
 *   } catch (error) {
 *     console.error("Failed to fetch from PageFly API:", error);
 *     throw error;
 *   }
 * }
 */

/**
 * Get page data - currently using mock, but can be replaced with API call
 */
function getPageData(pageId: string): MockPageData | null {
  // TODO: Replace this with API call once PageFly API is integrated
  return MOCK_PAGES_DATABASE[pageId] || null;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

function diagnosizePageSizeIssueHandler(
  input: DiagnosizePageSizeInput
): DiagnosizePageSizeOutput {
  const { editor_link } = input;

  // Step 1: Extract page ID from editor link
  const pageId = extractPageIdFromLink(editor_link);
  if (!pageId) {
    throw new Error("Invalid editor link format. Could not extract page ID.");
  }

  // Step 2: Fetch page data (mock or real)
  const pageData = getPageData(pageId);
  if (!pageData) {
    throw new Error(`Page not found for ID: ${pageId}`);
  }

  // Step 3: Calculate total size
  const totalSize = pageData.elements.reduce((sum, el) => sum + el.size_kb, 0);
  const SIZE_LIMIT_KB = 256;
  const isOverLimit = totalSize > SIZE_LIMIT_KB;

  // Step 4: Calculate percentages and sort by size (largest first)
  const elementsWithPercentage = pageData.elements
    .map((el) => ({
      ...el,
      percentage: (el.size_kb / totalSize) * 100,
    }))
    .sort((a, b) => b.size_kb - a.size_kb);

  // Step 5: Get largest element
  const largestElement = elementsWithPercentage[0];

  // Step 6: Generate recommendation based on largest element
  let recommendation = "";
  if (!isOverLimit) {
    recommendation = "Your page is within the size limit. No action needed.";
  } else {
    const excessSize = totalSize - SIZE_LIMIT_KB;
    const largestElementName = largestElement.name;

    if (largestElementName.toLowerCase().includes("product detail")) {
      recommendation = `Your page exceeds the limit by ${excessSize.toFixed(1)}KB. The "Product Detail Section" is consuming ${largestElement.size_kb}KB (${largestElement.percentage.toFixed(1)}% of total). 

**Recommendation:** Remove or simplify the Product Detail section and replace it with the lighter Product List component (${elementsWithPercentage.find((el) => el.name.includes("Product List"))?.size_kb || 95}KB). This should bring your page well under the 256KB limit.`;
    } else {
      recommendation = `Your page exceeds the limit by ${excessSize.toFixed(1)}KB. The "${largestElementName}" section is the largest at ${largestElement.size_kb}KB (${largestElement.percentage.toFixed(1)}% of total). Consider removing or simplifying this section.`;
    }
  }

  return {
    page_id: pageId,
    current_size_kb: totalSize,
    size_limit_kb: SIZE_LIMIT_KB,
    is_over_limit: isOverLimit,
    elements: elementsWithPercentage.map((el) => ({
      id: el.id,
      name: el.name,
      size_kb: el.size_kb,
      percentage: el.percentage,
    })),
    largest_element: {
      id: largestElement.id,
      name: largestElement.name,
      size_kb: largestElement.size_kb,
      percentage: largestElement.percentage,
    },
    recommendation,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { diagnosizePageSizeIssueHandler };
