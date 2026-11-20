import 'dotenv/config';
import { readFileSync } from 'fs';

async function testLunaModal() {
  const apiKey = process.env.BYNARA_API_KEY || process.env.RADOX_API_KEY;
  const baseURL = process.env.BYNARA_BASE_URL || 'https://coarena.ai/api/v1';
  const model = process.env.BYNARA_MODEL || 'gpt-6-luna';

  const imgPath = 'C:/Users/tejan/.gemini/antigravity/brain/55bab6ed-072a-424f-b5ca-ed0a76e4fd5d/.user_uploaded/media_1795111868096_618ba71b.png';
  const imgBuffer = readFileSync(imgPath);
  const base64 = `data:image/png;base64,${imgBuffer.toString('base64')}`;

  const prompt = `You are an AI browser automation agent inspecting a screenshot of LinkedIn.
Look at this screenshot. What is the current state?
Is there a modal open? Is it currently loading or ready?
What should the automation agent do right now?

Return ONLY a JSON response:
{
  "modalOpen": true/false,
  "isLoading": true/false,
  "stateDescription": "description",
  "recommendedAction": "wait" / "fill" / "click" / "retry",
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

  const data = await res.json();
  console.log('Luna Response:', data.choices?.[0]?.message?.content);
}

testLunaModal().catch(console.error);

