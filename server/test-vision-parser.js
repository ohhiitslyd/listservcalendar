/**
 * Test script for vision-based event extraction from images
 *
 * Usage:
 *   node test-vision-parser.js [path-to-image]
 *
 * Example:
 *   node test-vision-parser.js ./test-poster.png
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("ERROR: OPENAI_API_KEY not set in .env");
  process.exit(1);
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.log("Usage: node test-vision-parser.js <path-to-image>");
  console.log("\nExample: node test-vision-parser.js ./test-poster.png");
  console.log("\nThis will test the vision API's ability to extract event details from a poster image.");
  process.exit(0);
}

const fullPath = path.resolve(imagePath);
if (!fs.existsSync(fullPath)) {
  console.error(`ERROR: File not found: ${fullPath}`);
  process.exit(1);
}

// Read and encode image
const imageBuffer = fs.readFileSync(fullPath);
const base64Image = imageBuffer.toString("base64");
const ext = path.extname(fullPath).toLowerCase();
const mimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const mimeType = mimeTypes[ext] || "image/png";

console.log(`\n📷 Testing vision parser with: ${fullPath}`);
console.log(`   MIME type: ${mimeType}`);
console.log(`   Size: ${(imageBuffer.length / 1024).toFixed(1)} KB\n`);

const visionPrompt = `Analyze this event poster/flyer image carefully. Extract ALL visible event information.

Return a JSON object with these fields (use null if not visible):
{
  "title": "Event title/name visible on the poster",
  "date": "Date in YYYY-MM-DD format (interpret month names, e.g., 'January 30' with context year ${new Date().getFullYear()})",
  "startTime": "Start time in HH:MM:SS 24-hour format (e.g., '6:00 PM' → '18:00:00')",
  "endTime": "End time in HH:MM:SS 24-hour format, or null if not shown",
  "location": "Venue/room/address if visible",
  "description": "Brief description if visible (what the event is about)"
}

TIME CONVERSION:
- 6:00 PM → "18:00:00"
- 7:30 PM → "19:30:00"
- 12:00 PM (noon) → "12:00:00"
- 9:00 AM → "09:00:00"

DATE INTERPRETATION:
- "January 30" → "${new Date().getFullYear()}-01-30"
- "Feb 14" → "${new Date().getFullYear()}-02-14"
- "1/30" → "${new Date().getFullYear()}-01-30"

Look carefully at ALL text in the image including stylized/decorative fonts. Return valid JSON only.`;

async function testVision() {
  console.log("🔄 Sending image to OpenAI Vision API...\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert at reading event posters and extracting structured event information. Always return valid JSON.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: visionPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: ${response.status}`);
      console.error(errorText);
      process.exit(1);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    console.log("✅ Vision API Response:\n");

    try {
      const parsed = JSON.parse(content);
      console.log("Extracted Event Details:");
      console.log("─".repeat(40));
      console.log(`  Title:       ${parsed.title || "(not found)"}`);
      console.log(`  Date:        ${parsed.date || "(not found)"}`);
      console.log(`  Start Time:  ${parsed.startTime || "(not found)"}`);
      console.log(`  End Time:    ${parsed.endTime || "(not found)"}`);
      console.log(`  Location:    ${parsed.location || "(not found)"}`);
      console.log(`  Description: ${parsed.description || "(not found)"}`);
      console.log("─".repeat(40));
      console.log("\nRaw JSON:");
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log("Raw response (could not parse as JSON):");
      console.log(content);
    }

    // Show token usage
    if (data.usage) {
      console.log(`\n📊 Token Usage:`);
      console.log(`   Prompt: ${data.usage.prompt_tokens}`);
      console.log(`   Completion: ${data.usage.completion_tokens}`);
      console.log(`   Total: ${data.usage.total_tokens}`);
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

testVision();
