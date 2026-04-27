/**
 * One-off: generate the Orca logo via Gemini 3.1 Flash Image (Nano Banana 2).
 * Run with: bun run apps/bot/scripts/gen-logo.ts
 */

import { GoogleGenAI } from "@google/genai";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY missing. Source .env first.");
  process.exit(1);
}

const PROMPT = `Minimalist modern brand logo of a stylised orca (killer whale).
Composition: circular badge. The orca's head (face, eye patch, mouth) is
inside the circle, rendered in clean bold flat-vector style with smooth
curves. The dorsal fin rises upward and clearly breaks through the top of
the circular border, extending beyond it so the fin tip is outside the ring.
Palette: crisp black body with white underside, subtle deep-teal accent on
the eye patch, solid flat white background. Thick confident outlines,
geometric balance, centred, high contrast, no text, no gradients, no
shadows, vector-like. 1024x1024 square.`;

async function main() {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const res = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: PROMPT,
  });
  const parts =
    res.candidates?.[0]?.content?.parts ?? [];
  let saved = 0;
  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
    if (inline?.data) {
      const ext = inline.mimeType?.includes("png") ? "png" : "jpg";
      const outDir = resolve(process.cwd(), "apps/web/public");
      mkdirSync(outDir, { recursive: true });
      const outPath = resolve(outDir, `orca-logo.${ext}`);
      writeFileSync(outPath, Buffer.from(inline.data, "base64"));
      console.log(`wrote ${outPath}`);

      // mirror to docs static
      const docsDir = resolve(process.cwd(), "apps/docs/static/img");
      mkdirSync(docsDir, { recursive: true });
      const docsPath = resolve(docsDir, `orca-logo.${ext}`);
      writeFileSync(docsPath, Buffer.from(inline.data, "base64"));
      console.log(`wrote ${docsPath}`);
      saved += 1;
    }
  }
  if (saved === 0) {
    console.error("No image returned. Raw response:", JSON.stringify(res, null, 2).slice(0, 2000));
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("gen-logo failed:", e);
  process.exit(1);
});
