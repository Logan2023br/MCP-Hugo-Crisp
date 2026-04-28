/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  DiagnosizeFontInput,
  DiagnosizeFontOutput,
} from "@/mcp/tools/diagnose_font_issue/shapes.js";

/**************************************************************************
 * MOCK GOOGLE FONTS DATABASE
 * In production, this would fetch from Google Fonts API
 ***************************************************************************/

interface GoogleFont {
  name: string;
  family: string;
  variants: string[];
  cdnLink: string;
  cssImport: string;
  cssDeclaration: string;
}

const MOCK_GOOGLE_FONTS: Record<string, GoogleFont> = {
  roboto: {
    name: "Roboto",
    family: "Roboto, sans-serif",
    variants: ["400", "500", "700", "900"],
    cdnLink: "https://fonts.cdnfonts.com/css/roboto",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/roboto');",
    cssDeclaration: "font-family: 'Roboto', sans-serif;",
  },
  "open-sans": {
    name: "Open Sans",
    family: "Open Sans, sans-serif",
    variants: ["400", "600", "700"],
    cdnLink: "https://fonts.cdnfonts.com/css/open-sans",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/open-sans');",
    cssDeclaration: "font-family: 'Open Sans', sans-serif;",
  },
  lato: {
    name: "Lato",
    family: "Lato, sans-serif",
    variants: ["400", "700", "900"],
    cdnLink: "https://fonts.cdnfonts.com/css/lato",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/lato');",
    cssDeclaration: "font-family: 'Lato', sans-serif;",
  },
  montserrat: {
    name: "Montserrat",
    family: "Montserrat, sans-serif",
    variants: ["400", "500", "700", "800"],
    cdnLink: "https://fonts.cdnfonts.com/css/montserrat",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/montserrat');",
    cssDeclaration: "font-family: 'Montserrat', sans-serif;",
  },
  raleway: {
    name: "Raleway",
    family: "Raleway, sans-serif",
    variants: ["400", "700"],
    cdnLink: "https://fonts.cdnfonts.com/css/raleway",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/raleway');",
    cssDeclaration: "font-family: 'Raleway', sans-serif;",
  },
  "playfair-display": {
    name: "Playfair Display",
    family: "Playfair Display, serif",
    variants: ["400", "700", "900"],
    cdnLink: "https://fonts.cdnfonts.com/css/playfair-display",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/playfair-display');",
    cssDeclaration: "font-family: 'Playfair Display', serif;",
  },
  poppins: {
    name: "Poppins",
    family: "Poppins, sans-serif",
    variants: ["400", "600", "700"],
    cdnLink: "https://fonts.cdnfonts.com/css/poppins",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/poppins');",
    cssDeclaration: "font-family: 'Poppins', sans-serif;",
  },
  "inter-tight": {
    name: "Inter",
    family: "Inter, sans-serif",
    variants: ["400", "500", "600", "700"],
    cdnLink: "https://fonts.cdnfonts.com/css/inter",
    cssImport: "@import url('https://fonts.cdnfonts.com/css/inter');",
    cssDeclaration: "font-family: 'Inter', sans-serif;",
  },
};

/**************************************************************************
 * FONT DETECTION LOGIC
 ***************************************************************************/

/**
 * Detect font name from screenshot description
 * In production, this would use ML/OCR to analyze actual screenshots
 */
function detectFontFromDescription(description: string): {
  fontName: string;
  confidence: number;
  type: "google_font" | "custom_font" | "system_font";
} {
  const descLower = description.toLowerCase();

  // Simple keyword matching for demo purposes
  if (
    descLower.includes("roboto") ||
    descLower.includes("geometric sans")
  ) {
    return {
      fontName: "Roboto",
      confidence: 95,
      type: "google_font",
    };
  }

  if (
    descLower.includes("open sans") ||
    descLower.includes("open-sans")
  ) {
    return {
      fontName: "Open Sans",
      confidence: 90,
      type: "google_font",
    };
  }

  if (descLower.includes("montserrat")) {
    return {
      fontName: "Montserrat",
      confidence: 92,
      type: "google_font",
    };
  }

  if (
    descLower.includes("playfair") ||
    descLower.includes("serif elegant")
  ) {
    return {
      fontName: "Playfair Display",
      confidence: 88,
      type: "google_font",
    };
  }

  if (descLower.includes("poppins")) {
    return {
      fontName: "Poppins",
      confidence: 93,
      type: "google_font",
    };
  }

  if (descLower.includes("inter")) {
    return {
      fontName: "Inter",
      confidence: 91,
      type: "google_font",
    };
  }

  if (
    descLower.includes("custom font") ||
    descLower.includes("proprietary") ||
    descLower.includes("brand font")
  ) {
    return {
      fontName: "Custom Font",
      confidence: 70,
      type: "custom_font",
    };
  }

  if (
    descLower.includes("system font") ||
    descLower.includes("arial") ||
    descLower.includes("helvetica") ||
    descLower.includes("verdana")
  ) {
    return {
      fontName: "System Font",
      confidence: 60,
      type: "system_font",
    };
  }

  // Default guess
  return {
    fontName: "Roboto (estimated)",
    confidence: 40,
    type: "google_font",
  };
}

/**
 * Get Google Font details
 */
function getGoogleFontDetails(fontName: string): GoogleFont | null {
  const key = fontName.toLowerCase().replace(/\s+/g, "-");
  return MOCK_GOOGLE_FONTS[key] || null;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

function diagnosizeFontIssueHandler(
  input: DiagnosizeFontInput
): DiagnosizeFontOutput {
  const { issue_description, screenshot_description, editor_link, affected_areas } =
    input;

  // Step 1: Detect font from description
  const fontDetection = detectFontFromDescription(screenshot_description);

  // Step 2: Get font details
  const fontDetails = getGoogleFontDetails(fontDetection.fontName);

  // Step 3: Generate solutions based on font type
  let isEscalationNeeded = false;
  let escalationReason = "";

  if (fontDetection.type === "custom_font") {
    isEscalationNeeded = true;
    escalationReason =
      "This appears to be a custom font. PageFly support may need to assist with proper font loading configuration.";
  }

  if (fontDetection.confidence < 60) {
    isEscalationNeeded = true;
    escalationReason =
      "Font detection confidence is low. Manual review by support team recommended.";
  }

  // Step 4: Generate CSS code snippet
  let cssCodeSnippet = "";
  if (fontDetails) {
    cssCodeSnippet = `
/* Add this to your PageFly Custom CSS */

/* 1. Import the font */
${fontDetails.cssImport}

/* 2. Apply the font to desired elements */
/* For all text: */
body {
  ${fontDetails.cssDeclaration}
}

/* Or target specific elements: */
h1, h2, h3 {
  ${fontDetails.cssDeclaration}
}

p {
  ${fontDetails.cssDeclaration}
}

/* Or use it as font-family in other rules */
.my-custom-class {
  ${fontDetails.cssDeclaration}
}
    `.trim();
  }

  // Step 5: Generate instructions
  const instructions = [
    {
      step_number: 1,
      action: "Open PageFly Editor",
      details: "Go to your PageFly editor and navigate to the page with the font issue.",
      expected_result: "Editor is open and page is loaded",
    },
    {
      step_number: 2,
      action: "Access Custom CSS",
      details:
        'Click on "Design" → "Custom CSS" in the left sidebar. This is where you add custom styles.',
      expected_result: "Custom CSS editor is visible and ready for input",
    },
    {
      step_number: 3,
      action: "Copy and Paste the CSS Code",
      details: `Copy the CSS code below and paste it into the Custom CSS section:\n\n${cssCodeSnippet}`,
      expected_result: "CSS code is pasted into the Custom CSS editor",
    },
    {
      step_number: 4,
      action: "Save and Publish",
      details:
        "Click 'Save' and then 'Publish'. Wait 30-60 seconds for the changes to propagate to the live site.",
      expected_result: "The font should now appear correctly on both preview and live page",
    },
    {
      step_number: 5,
      action: "Verify the Changes",
      details:
        "Check both the preview in PageFly editor and the live page on your Shopify store. Open in Incognito mode to bypass browser cache.",
      expected_result: "Font displays correctly everywhere",
    },
  ];

  // Step 6: Escalation info
  const escalationInfo = isEscalationNeeded
    ? {
        is_escalation_needed: true,
        reason: escalationReason,
        information_to_provide: [
          `Font detected: ${fontDetection.fontName}`,
          `Affected areas: ${affected_areas?.join(", ") || "Not specified"}`,
          `Editor link: ${editor_link || "Not provided"}`,
          `Screenshot description: ${screenshot_description}`,
          `Issue description: ${issue_description}`,
        ],
        crisp_note_template: `**Issue:** Font mismatch in live/preview - ${fontDetection.fontName}

**Affected areas:** ${affected_areas?.join(", ") || "Not specified"}

**Font type:** ${fontDetection.type}

**Confidence level:** ${fontDetection.confidence}%

**What I tried:**
- Identified font as: ${fontDetection.fontName}
- Provided CSS CDN code for import (if Google Font)
- User to try adding code to custom CSS

**Next steps needed:**
Please review and provide manual assistance. 

**Reference links:**
- Editor: ${editor_link || "Link not provided"}
- Font: ${fontDetails?.cdnLink || "N/A"}

cc @support-team`,
      }
    : undefined;

  // Step 7: Generate summary
  let summary =
    `We detected that your page is showing "${fontDetection.fontName}" differently than expected. ` +
    `This is a font loading issue (${fontDetection.confidence}% confidence).`;

  if (fontDetails) {
    summary += `\n\nThe good news: "${fontDetection.fontName}" is a Google Font, which is easy to fix!`;
  } else {
    summary += `\n\nThis appears to be a custom font that may need special handling.`;
  }

  return {
    issue_summary: summary,

    detected_font: {
      name: fontDetection.fontName,
      type: fontDetection.type,
      confidence: fontDetection.confidence,
      cdn_link: fontDetails?.cdnLink,
      css_code: fontDetails?.cssDeclaration,
    },

    font_type_description:
      fontDetection.type === "google_font"
        ? `"${fontDetection.fontName}" is a Google Font - a free, web-safe font that can be easily imported via CDN. It's widely used and highly compatible with Shopify and PageFly.`
        : fontDetection.type === "custom_font"
          ? `"${fontDetection.fontName}" appears to be a custom brand font. Custom fonts require specific setup and may need PageFly support team assistance.`
          : `This appears to be a system font (pre-installed on user's computer). System fonts may display differently across browsers and devices.`,

    is_google_font: fontDetection.type === "google_font",

    solutions: {
      if_google_font: {
        title: "Fix: Add Google Font via CSS",
        description:
          'The simplest solution is to import the Google Font via CSS. PageFly allows custom CSS which is perfect for this.',
        instructions: instructions,
        css_code_snippet: cssCodeSnippet,
        expected_fix_time: "5-10 minutes",
      },

      if_custom_font: {
        title: "Custom Font Issue - Escalation Required",
        description:
          "This appears to be a custom font, which may require special setup. PageFly support team can help configure it properly.",
        escalation_needed: true,
        escalation_steps: [
          {
            step_number: 1,
            action: "Gather Information",
            details:
              "Note down: font name, where it's used, and what you expect it to look like",
            expected_result: "You have all the details ready",
          },
          {
            step_number: 2,
            action: "Contact Support",
            details:
              "Provide the PageFly editor link and screenshots showing the issue",
            expected_result: "Support team receives your request",
          },
          {
            step_number: 3,
            action: "Provide Font Files",
            details:
              "If it's a custom font, you may need to provide font files (TTF, WOFF, etc.) to support",
            expected_result: "Support team can properly configure the font",
          },
        ],
      },
    },

    escalation_info: escalationInfo,

    summary_recommendation:
      fontDetails
        ? `
✅ **Quick Fix Available:**
1. Copy the CSS code above
2. Open PageFly → Design → Custom CSS
3. Paste the code
4. Publish
5. Verify in incognito mode (to avoid cache)

This should fix your font issue in 5-10 minutes!

If it still doesn't work after trying this, please provide your editor link so we can escalate to the technical team.
        `.trim()
        : `
⚠️ **Escalation Recommended:**
This custom font requires more investigation. Please share:
1. Your PageFly editor link
2. Where this font should be used
3. Any font files you have

Once you provide the editor link, we'll create an escalation note for the technical team.
        `.trim(),
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { diagnosizeFontIssueHandler };
