/**
 * AI Vision Detection Router
 * Uses Gemini 2.5 Flash (multimodal) for accurate object detection and classification.
 * The client sends a base64 frame, the server returns detected objects with bounding boxes.
 */

import { z } from 'zod';
import { publicProcedure, router } from '../_core/trpc';
import { invokeLLM } from '../_core/llm';

const DETECTION_SYSTEM_PROMPT = `You are a wildlife conservation surveillance AI. Analyze the camera frame and detect all visible objects.

For each detected object, return:
- type: "human", "animal", "vehicle", or "anonymous" (unknown/unclear object)
- confidence: 0.0 to 1.0
- bbox: normalized bounding box [x, y, width, height] where all values are 0.0 to 1.0 relative to image dimensions
  - x = left edge position (0=left, 1=right)
  - y = top edge position (0=top, 1=bottom)
  - width = box width as fraction of image width
  - height = box height as fraction of image height
- label: descriptive label like "Person walking", "Bird on branch", "Motorcycle", "Unidentified shadow"

Rules:
- Only detect ACTUAL objects, not walls, floors, ceilings, furniture, or static background
- A "human" must clearly show a person (body, face, limbs visible)
- An "animal" must clearly show a living creature (bird, mammal, reptile, etc.)
- A "vehicle" must be a car, motorcycle, bicycle, truck, boat, etc.
- "anonymous" is for moving/unclear objects that don't fit the above categories
- If the image is too dark to see anything, return type "dark_environment" with no bbox
- If the image is too blurry, return type "blurry_image" with no bbox
- Do NOT detect static objects like walls, doors, windows, furniture, lights, or ceiling
- Be conservative: if unsure, don't detect it
- Maximum 5 objects per frame

Return ONLY valid JSON array. No markdown, no explanation.`;

export const aiVisionRouter = router({
  // Analyze a frame using AI vision
  analyzeFrame: publicProcedure
    .input(
      z.object({
        frameBase64: z.string(), // base64 encoded JPEG image
        width: z.number().optional(),
        height: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await invokeLLM({
          messages: [
            {
              role: 'system',
              content: DETECTION_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this surveillance camera frame. Return a JSON array of detected objects. If no objects are detected, return an empty array [].',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${input.frameBase64}`,
                    detail: 'low', // Use low detail for faster processing
                  },
                },
              ],
            },
          ],
          maxTokens: 1024,
          responseFormat: { type: 'json_object' },
        });

        const content = result.choices?.[0]?.message?.content;
        if (!content) {
          return { detections: [], error: null };
        }

        // Parse the response - handle both string and array content
        const textContent = typeof content === 'string' ? content : 
          Array.isArray(content) ? content.find(c => c.type === 'text')?.text || '[]' : '[]';

        // Extract JSON from the response (handle markdown code blocks)
        let jsonStr = typeof textContent === 'string' ? textContent : '[]';
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }

        // Try to parse as array or object with detections field
        let detections: any[] = [];
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            detections = parsed;
          } else if (parsed.detections && Array.isArray(parsed.detections)) {
            detections = parsed.detections;
          } else if (parsed.objects && Array.isArray(parsed.objects)) {
            detections = parsed.objects;
          }
        } catch {
          // Try to find array in the string
          const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            try {
              detections = JSON.parse(arrayMatch[0]);
            } catch { /* ignore */ }
          }
        }

        // Normalize detections
        const normalized = detections.slice(0, 5).map((d: any) => ({
          type: ['human', 'animal', 'vehicle', 'anonymous', 'dark_environment', 'blurry_image'].includes(d.type) 
            ? d.type : 'anonymous',
          confidence: Math.min(1, Math.max(0, Number(d.confidence) || 0.5)),
          bbox: Array.isArray(d.bbox) && d.bbox.length === 4
            ? {
                x: Math.min(1, Math.max(0, Number(d.bbox[0]) || 0)),
                y: Math.min(1, Math.max(0, Number(d.bbox[1]) || 0)),
                width: Math.min(1, Math.max(0.05, Number(d.bbox[2]) || 0.2)),
                height: Math.min(1, Math.max(0.05, Number(d.bbox[3]) || 0.2)),
              }
            : d.bbox && typeof d.bbox === 'object'
              ? {
                  x: Math.min(1, Math.max(0, Number(d.bbox.x) || 0)),
                  y: Math.min(1, Math.max(0, Number(d.bbox.y) || 0)),
                  width: Math.min(1, Math.max(0.05, Number(d.bbox.width) || 0.2)),
                  height: Math.min(1, Math.max(0.05, Number(d.bbox.height) || 0.2)),
                }
              : null,
          label: String(d.label || d.type || 'Unknown').substring(0, 50),
        })).filter((d: any) => d.bbox !== null);

        return { detections: normalized, error: null };

      } catch (error: any) {
        console.error('[AIVision] Error:', error.message);
        return { detections: [], error: error.message };
      }
    }),
});
