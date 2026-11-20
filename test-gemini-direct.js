/**
 * Direct test of Gemini API integration
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

async function testGemini() {
  console.log('\n🧪 Testing Gemini API Direct Integration\n');
  console.log(`API Key: ${process.env.GEMINI_API_KEY ? 'Found' : 'MISSING!'}`);
  
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not found in environment!');
    process.exit(1);
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
      }
    });

    console.log('✅ Gemini client initialized\n');

    // Test 1: Simple question
    console.log('Test 1: Simple Yes/No Question');
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

    console.log('Sending prompt to Gemini...');
    const result1 = await model.generateContent(prompt1);
    const response1 = result1.response.text();
    
    console.log('\nRaw Response:');
    console.log(response1);
    
    const jsonMatch1 = response1.match(/\{[\s\S]*\}/);
    if (jsonMatch1) {
      const parsed1 = JSON.parse(jsonMatch1[0]);
      console.log('\nParsed JSON:');
      console.log(JSON.stringify(parsed1, null, 2));
      
      if (parsed1.confidence >= 0.7) {
        console.log('✅ High confidence - would use this answer');
      } else {
        console.log('⚠️  Low confidence - would fall back to default');
      }
    } else {
      console.log('❌ Could not parse JSON from response');
    }

    // Test 2: Complex question
    console.log('\n\nTest 2: Complex Open-Ended Question');
    console.log('─'.repeat(80));
    
    const prompt2 = `You are an AI assistant filling a job application.

QUESTION: "Tell us about a time you solved a complex technical problem"

CANDIDATE PROFILE:
- Name: John Doe
- Experience: 5 years as Senior Software Engineer
- Skills: React, Node.js, Python, AWS
- Resume: Built scalable microservices handling 1M+ requests/day. Led migration from monolith to microservices architecture.

Return ONLY valid JSON:
{
  "answer": "your answer (2-3 sentences)",
  "confidence": 0.85,
  "reasoning": "brief explanation"
}`;

    console.log('Sending prompt to Gemini...');
    const result2 = await model.generateContent(prompt2);
    const response2 = result2.response.text();
    
    console.log('\nRaw Response:');
    console.log(response2);
    
    const jsonMatch2 = response2.match(/\{[\s\S]*\}/);
    if (jsonMatch2) {
      const parsed2 = JSON.parse(jsonMatch2[0]);
      console.log('\nParsed JSON:');
      console.log(JSON.stringify(parsed2, null, 2));
      
      if (parsed2.confidence >= 0.7) {
        console.log('✅ High confidence - would use this answer');
      } else {
        console.log('⚠️  Low confidence - would fall back to default');
      }
    } else {
      console.log('❌ Could not parse JSON from response');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Gemini API is working correctly!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Gemini API Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testGemini();
