import 'dotenv/config';
import { readFileSync } from 'fs';

async function testLunaVision() {
  const apiKey = process.env.BYNARA_API_KEY || process.env.RADOX_API_KEY;
  const baseURL = process.env.BYNARA_BASE_URL || 'https://coarena.ai/api/v1';
  const model = process.env.BYNARA_MODEL || 'gpt-6-luna';

  console.log('Testing GPT-6 Luna Vision with an actual screenshot...');
  // We have user uploaded media in artifacts:
  // C:/Users/tejan/.gemini/antigravity/brain/55bab6ed-072a-424f-b5ca-ed0a76e4fd5d/.user_uploaded/media_1795111274671_2cb8828b.jpg
  const imgPath = 'C:/Users/tejan/.gemini/antigravity/brain/55bab6ed-072a-424f-b5ca-ed0a76e4fd5d/.user_uploaded/media_1795111274671_2cb8828b.jpg';
  const imgBuffer = readFileSync(imgPath);
  const base64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;

  const prompt = `You are an AI browser automation agent inspecting a screenshot of a job posting on LinkedIn.
Look at this screenshot. Is there an "Easy Apply" button visible on the screen?
If yes, describe where it is located (relative coordinates or description) and what action should be taken.

Return ONLY a JSON response:
{
  "hasEasyApply": true/false,
  "description": "where it is located",
  "recommendedAction": "click_easy_apply",
  "reasoning": "why"
}`;

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: base64 } }
          ]
        }
      ],
      temperature: 0.2
    })
  });

  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Luna Response:', data.choices?.[0]?.message?.content);
}

testLunaVision().catch(console.error);

