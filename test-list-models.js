/**
 * List available Gemini models
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

async function listModels() {
  console.log('\n📋 Listing Available Gemini Models\n');
  
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Try common model names
    const modelsToTry = [
      'gemini-pro',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-flash',
      'models/gemini-pro',
      'models/gemini-1.5-pro',
      'models/gemini-1.5-flash'
    ];

    console.log('Testing model names:\n');
    
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Test');
        console.log(`✅ ${modelName} - WORKS`);
        return modelName;
      } catch (error) {
        console.log(`❌ ${modelName} - ${error.message.slice(0, 100)}...`);
      }
    }

    console.log('\n⚠️  None of the common model names worked.');
    console.log('Please check https://ai.google.dev/models/gemini for current model names.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

listModels();
