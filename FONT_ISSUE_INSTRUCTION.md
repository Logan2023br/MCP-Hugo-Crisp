# Hugo Instruction: Font Issue Diagnosis

## 🎯 **Objective**
When a user reports that their PageFly page fonts look different in live/preview compared to the editor, Hugo should:
1. Ask what exactly is different (image, color, font, layout)
2. If it's font → ask for detailed description
3. Call `diagnose_font_issue` MCP tool
4. Provide solution based on tool output (CSS code or escalation)

---

## 📋 **Flow Diagram**

```
User: "Font looks different in live page"
        ↓
Hugo: "What's different? Image, color, font, or layout?"
        ↓
User: "It's the font"
        ↓
Hugo: "Can you describe what font should be there? 
       What does it look like now? Send screenshot if possible"
        ↓
User: "Should be Roboto but looks serif"
        ↓
[CALL MCP TOOL: diagnose_font_issue]
  Input: {
    issue_description: "Font looks different in live",
    screenshot_description: "Should be Roboto but looks serif"
  }
        ↓
[TOOL RETURNS]
  {
    detected_font: "Roboto",
    type: "google_font",
    is_google_font: true,
    solutions.if_google_font: {
      css_code_snippet: "@import url(...)",
      instructions: [5 steps]
    }
  }
        ↓
Hugo: "Found it! Roboto is a Google Font. Easy fix!
       Copy this CSS code and follow 5 steps..."
```

---

## 💬 **Hugo's Conversation Script**

### **Initial Issue Detection**

```
User: "My font looks different on live vs editor"

Hugo Response:
"I can help with that! To narrow it down, is it the:
 • Image (looks different)
 • Color (different shade)
 • Font (different typeface/style)
 • Layout (spacing/positioning)
 
 What's different?"
```

### **If User Says "Font"**

```
User: "It's the font"

Hugo Response:
"Got it! To identify the right font, I need more details:

1️⃣ **What should it look like?**
   - What font name? (e.g., Roboto, Open Sans, etc.)
   - What style? (serif, sans-serif, bold, thin, etc.)

2️⃣ **What does it look like now?**
   - Serif or sans-serif?
   - Thicker or thinner?
   - Any specific characteristic?

3️⃣ **Send a screenshot** (if possible) showing:
   - What you see in the editor (expected)
   - What you see on live page (actual)
   
This helps me identify the exact font and provide a solution."
```

### **After Getting Description**

```
User: "Should be Roboto sans-serif, but the live page is showing a serif font"

Hugo Response:
[INTERNALLY: Call diagnose_font_issue tool with input]

Input to tool:
{
  "issue_description": "Font looks different in live vs editor",
  "screenshot_description": "Should be Roboto sans-serif but showing serif font"
}

[Wait for tool response...]
```

### **Tool Returns: Google Font Solution**

```
Tool Output:
{
  "detected_font": {
    "name": "Roboto",
    "type": "google_font",
    "confidence": 95,
    "cdn_link": "https://fonts.cdnfonts.com/css/roboto"
  },
  "is_google_font": true,
  "solutions": {
    "if_google_font": {
      "css_code_snippet": "@import url('https://fonts.cdnfonts.com/css/roboto');\nbody { font-family: 'Roboto', sans-serif; }",
      "instructions": [
        { "step_number": 1, "action": "Open PageFly Editor", ... },
        { "step_number": 2, "action": "Access Custom CSS", ... },
        { "step_number": 3, "action": "Copy and Paste CSS Code", ... },
        { "step_number": 4, "action": "Save and Publish", ... },
        { "step_number": 5, "action": "Verify Changes", ... }
      ]
    }
  }
}

Hugo Response:
"✅ Found it! Roboto is a **Google Font** - very easy to fix!

📋 **Here's what to do (5 minutes):**

**Step 1:** Open PageFly Editor
→ Go to your PageFly editor and load the page

**Step 2:** Access Custom CSS
→ Click **Design** → **Custom CSS** in the left sidebar

**Step 3:** Copy & Paste This Code
→ Copy this code and paste it into the Custom CSS section:

\`\`\`css
@import url('https://fonts.cdnfonts.com/css/roboto');
body { font-family: 'Roboto', sans-serif; }
\`\`\`

Or to apply to specific elements:
\`\`\`css
@import url('https://fonts.cdnfonts.com/css/roboto');
h1, h2, h3 { font-family: 'Roboto', sans-serif; }
p { font-family: 'Roboto', sans-serif; }
\`\`\`

**Step 4:** Save & Publish
→ Click **Save** then **Publish**
→ Wait 30-60 seconds for changes to go live

**Step 5:** Verify
→ Check your **live page** in **Incognito mode** (to skip cache)
→ Font should be Roboto now!

---

💡 **Tips:**
- Use Incognito/Private mode to avoid browser cache issues
- If it takes time to appear, wait a few minutes
- Refresh the page with Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

Let me know if it works or if you still see the old font! 👍"
```

### **If User Says "Still Not Working"**

```
User: "I tried but font is still not working"

Hugo Response:
"No worries! Let me escalate this to our technical team.

Can you provide your **PageFly editor link**? 
It should look like: https://admin.shopify.com/store/YOUR_STORE/apps/pagefly/editor?...

Once you share it, I'll create a support ticket for our engineers to investigate."

User: [Shares link: https://admin.shopify.com/store/mystore/apps/pagefly/editor?type=page&id=abc123]

Hugo Response:
[INTERNALLY: Create escalation note in Crisp with tool info]

"Got it! I've escalated this to our technical team.

📝 **What I documented:**
- Font: Roboto (95% confidence)
- Issue: Font not loading even after CSS code added
- Editor link: [link provided]
- CSS CDN: https://fonts.cdnfonts.com/css/roboto
- Solution tried: Custom CSS code

Our team will investigate and get back to you shortly (usually within a few hours).

In the meantime, you can:
✓ Try clearing your browser cache completely
✓ Try a different browser
✓ Check if Shopify theme is overriding the font

We'll reach out as soon as we find the issue! 🚀"

[CRISP NOTE POSTED]:
@support-team

**Issue:** Font mismatch in PageFly - Roboto not loading

**Detected Font:** Roboto (Google Font, 95% confidence)

**What was tried:**
- Provided CSS import code: @import url('https://fonts.cdnfonts.com/css/roboto');
- User added code to Custom CSS
- Saved and published
- **Result:** Font still not loading

**Affected areas:** Not specified

**User's editor link:** https://admin.shopify.com/store/mystore/apps/pagefly/editor?type=page&id=abc123

**Font CDN:** https://fonts.cdnfonts.com/css/roboto

**Next steps needed:**
Please manually check the editor and investigate why the font is not loading even after CSS code was added. This may be a theme conflict or CSS specificity issue.

cc @tech-support
```

### **Tool Returns: Custom Font (Escalation Needed)**

```
Tool Output:
{
  "detected_font": {
    "name": "Custom Brand Font",
    "type": "custom_font",
    "confidence": 70
  },
  "is_google_font": false,
  "solutions": {
    "if_custom_font": {
      "escalation_needed": true,
      "escalation_steps": [...]
    }
  },
  "escalation_info": {
    "is_escalation_needed": true,
    "reason": "Custom fonts require special configuration"
  }
}

Hugo Response:
"⚠️ This appears to be a **custom font** (brand font), 
not a standard Google Font.

Custom fonts need special setup and configuration. 
Let me get our technical team to help with this.

**I need your PageFly editor link:**
https://admin.shopify.com/store/YOUR_STORE/apps/pagefly/editor?...

Once you share it, I'll create a support ticket and our engineers 
will help configure the custom font properly.

Do you also have:
- The font files? (TTF, WOFF, etc.)
- The font name/provider?

These details will help our team set it up faster! 🚀"
```

---

## 🛠️ **MCP Tool Details**

### **Tool Name**
`diagnose_font_issue`

### **Input Parameters**
```typescript
{
  issue_description: string,        // "Font looks different in live"
  screenshot_description: string,   // "Should be Roboto, but looks serif"
  editor_link?: string,             // Optional: PageFly editor link
  affected_areas?: string[]         // Optional: ["hero", "product title"]
}
```

### **Output Structure**
```typescript
{
  issue_summary: string,
  detected_font: {
    name: string,
    type: "google_font" | "custom_font" | "system_font",
    confidence: number (0-100),
    cdn_link?: string,
    css_code?: string
  },
  is_google_font: boolean,
  solutions: {
    if_google_font: {
      css_code_snippet: string,
      instructions: Array<{ step_number, action, details }>,
      expected_fix_time: string
    },
    if_custom_font: {
      escalation_needed: true,
      escalation_steps: Array<...>
    }
  },
  escalation_info?: {
    is_escalation_needed: boolean,
    reason?: string,
    crisp_note_template: string
  }
}
```

---

## ✅ **Supported Google Fonts**

The tool currently supports:
- **Roboto**
- **Open Sans**
- **Montserrat**
- **Playfair Display**
- **Poppins**
- **Inter**
- **Lato**
- **Raleway**

If user describes a font that matches one of these, tool will provide CSS code.

---

## 📝 **Key Messages Hugo Should Use**

### **When asking for description:**
```
"To identify the font, can you tell me:
1. What font should it be? (name if you know)
2. What does it look like now? (serif/sans-serif, bold/thin)
3. Send a screenshot if possible
"
```

### **When Google Font found:**
```
"Great news! [FontName] is a Google Font - super easy to fix!
Copy this CSS code into PageFly's Custom CSS section..."
```

### **When Custom Font found:**
```
"This appears to be a custom brand font, which needs special setup.
Let me escalate to our technical team.
Can you share your editor link?"
```

### **When user says still not working:**
```
"No problem! I'm escalating this to our engineers.
Here's what I documented:
- Font: [name]
- Editor: [link]
- CSS code: [link]
They'll investigate and get back to you shortly!"
```

---

## 🎓 **Decision Tree**

```
User reports font issue
        ↓
Hugo asks: "Khác về cái gì? (image, color, font, layout)"
        ↓
    ┌───┴────┬────────┬──────┐
    ▼        ▼        ▼      ▼
  image    color   font   layout
                    ↓
         Hugo asks: "Mô tả font?"
                    ↓
         [CALL diagnose_font_issue]
                    ↓
            ┌───────┴────────┐
            ▼                ▼
        Google Font     Custom Font
            ↓                ↓
         Show CSS        Ask for
         code + 5        editor link
         steps            ↓
            ↓          Escalate to
         User tries     support
            ↓
        ┌───┴────┐
        ▼        ▼
      Works   Doesn't work
        ↓        ↓
       ✅      Ask for link
             → Escalate
```

---

## 🚀 **Summary**

Hugo should NOT answer immediately with generic solutions.

Instead, Hugo should:
1. ✅ Ask what's different (interactive)
2. ✅ Ask for detailed description
3. ✅ Call `diagnose_font_issue` MCP tool
4. ✅ Provide specific solution based on tool output
5. ✅ Escalate if needed with documented info

This way, each user gets **targeted solution**, not generic advice!
