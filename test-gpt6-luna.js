/**
 * Test GPT-6-Luna API via BYNARA/RADOX
 */

import 'dotenv/config';

async function testGPT6Luna() {
  console.log('\n🌙 Testing GPT-6-Luna API (BYNARA/RADOX)\n');
  
  const apiKey = process.env.BYNARA_API_KEY || process.env.RADOX_API_KEY;
  const baseURL = process.env.BYNARA_BASE_URL || process.env.RADOX_BASE_URL || 'https://coarena.ai/api/v1';
  const model = process.env.BYNARA_MODEL || process.env.RADOX_MODEL || 'gpt-6-luna';
  
  console.log(`API Key: ${apiKey ? '✅ Found' : '❌ MISSING!'}`);
  console.log(`Base URL: ${baseURL}`);
  console.log(`Model: ${model}\n`);
  
  if (!apiKey) {
    console.error('❌ No API key found! Check BYNARA_API_KEY or RADOX_API_KEY in .env');
    process.exit(1);
  }

  try {
    console.log('Test 1: Simple Sponsorship Question');
    console.log('─'.repeat(80));
    
    const prompt1 = `You are an AI assistant filling a job application.

QUESTION: "Will you now or in the future require sponsorship?"
OPTIONS: Yes | No

CANDIDATE PROFILE:
- Location: San Francisco, USA
- Work Authorization: US Citizen

Return ONLY valid JSON with this format:
{
  "answer": "your answer",
  "confidence": 0.95,
  "reasoning": "brief explanation"
}`;

    console.log('Sending request to GPT-6-Luna...');
    
    const response1 = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that helps fill job application forms. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt1
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response1.ok) {
      const errorText = await response1.text();
      console.error(`❌ API Error (${response1.status}):`, errorText);
      process.exit(1);
    }

    const data1 = await response1.json();
    const responseText1 = data1.choices?.[0]?.message?.content || '';
    
    console.log('\nRaw Response:');
    console.log(responseText1);
    
    const jsonMatch1 = responseText1.match(/\{[\s\S]*\}/);
    if (jsonMatch1) {
      const parsed1 = JSON.parse(jsonMatch1[0]);
      console.log('\nParsed JSON:');
      console.log(JSON.stringify(parsed1, null, 2));
      
      if (parsed1.confidence >= 0.7) {
        console.log('✅ HIGH CONFIDENCE - Perfect for auto-fill!');
      } else {
        console.log('⚠️  Low confidence');
      }
    } else {
      console.log('❌ Could not parse JSON from response');
    }

    console.log('\n\nTest 2: Complex Open-Ended Question');
    console.log('─'.repeat(80));
    
    const prompt2 = `You are an AI assistant filling a job application.

QUESTION: "Why do you want to work at our company?"

CANDIDATE PROFILE:
- Name: John Doe
- Experience: 5 years as Senior Software Engineer
- Skills: React, Node.js, Python, AWS, Kubernetes
- Company Applying To: Acme Corp (Tech Startup)

Return ONLY valid JSON:
{
  "answer": "your 2-3 sentence answer",
  "confidence": 0.85,
  "reasoning": "brief explanation"
}`;

    console.log('Sending request to GPT-6-Luna...');
    
    const response2 = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that helps fill job application forms. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt2
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response2.ok) {
      const errorText = await response2.text();
      console.error(`❌ API Error (${response2.status}):`, errorText);
      process.exit(1);
    }

    const data2 = await response2.json();
    const responseText2 = data2.choices?.[0]?.message?.content || '';
    
    console.log('\nRaw Response:');
    console.log(responseText2);
    
    const jsonMatch2 = responseText2.match(/\{[\s\S]*\}/);
    if (jsonMatch2) {
      const parsed2 = JSON.parse(jsonMatch2[0]);
      console.log('\nParsed JSON:');
      console.log(JSON.stringify(parsed2, null, 2));
      
      if (parsed2.confidence >= 0.7) {
        console.log('✅ HIGH CONFIDENCE - Perfect for auto-fill!');
      } else {
        console.log('⚠️  Low confidence');
      }
    } else {
      console.log('❌ Could not parse JSON from response');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ GPT-6-Luna API is working perfectly!');
    console.log('🚀 Ready for 100% job application automation!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test Failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testGPT6Luna();
