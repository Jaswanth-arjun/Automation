/**
 * Test script for Full Auto Mode AI Engine
 * Tests the /api/vault/infer-answer-v2 endpoint with realistic data
 */

const testProfile = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '+1-555-0123',
  location: 'San Francisco, CA',
  workAuthorization: 'US Citizen',  // AI engine checks this field
  requireSponsorship: false,  // AI engine checks this field (not "requiresSponsorship")
  skills: ['React', 'Node.js', 'Python', 'AWS', 'Kubernetes'],
  experience: [
    {
      title: 'Senior Software Engineer',
      company: 'Tech Corp',
      duration: '3 years 2 months',
      current: true
    },
    {
      title: 'Software Engineer',
      company: 'StartupCo',
      duration: '2 years',
      current: false
    }
  ],
  education: [
    {
      degree: 'Bachelor of Science in Computer Science',
      institution: 'Stanford University',
      graduationYear: 2018
    }
  ]
};

const testCases = [
  {
    name: 'Work Authorization',
    question: 'Are you legally authorized to work in the United States?',
    fieldType: 'select',
    options: ['Yes', 'No'],
    expectedSource: 'profile-inference'
  },
  {
    name: 'Sponsorship',
    question: 'Will you now or in the future require sponsorship?',
    fieldType: 'select',
    options: ['Yes', 'No'],
    expectedSource: 'profile-explicit'  // Now will find requireSponsorship=false
  },
  {
    name: 'Salary Expectation',
    question: 'What is your expected salary?',
    fieldType: 'text',
    expectedSource: 'profile-inference'
  },
  {
    name: 'Notice Period',
    question: 'What is your notice period?',
    fieldType: 'select',
    options: ['Immediate', '2 weeks', '1 month', '2 months', '3 months'],
    expectedSource: 'profile-inference'
  },
  {
    name: 'Years of Experience',
    question: 'How many years of experience do you have?',
    fieldType: 'number',
    expectedSource: 'profile-calculated'  // Will calculate from experience array
  },
  {
    name: 'Willing to Relocate',
    question: 'Are you willing to relocate?',
    fieldType: 'select',
    options: ['Yes', 'No'],
    expectedSource: 'profile-inference'
  },
  {
    name: 'Veteran Status',
    question: 'Are you a veteran?',
    fieldType: 'select',
    options: ['Yes', 'No', 'Prefer not to say'],
    expectedSource: 'profile-inference'
  },
  {
    name: 'Education Level',
    question: 'What is your highest level of education?',
    fieldType: 'select',
    options: ['High School', 'Bachelor\'s Degree', 'Master\'s Degree', 'PhD'],
    expectedSource: 'profile-inference'
  },
  {
    name: 'Unknown Question (should use AI)',
    question: 'Tell us about a time you solved a complex problem',
    fieldType: 'textarea',
    expectedSource: 'enhanced-reasoning'  // Will use enhanced reasoning without Gemini
  },
  {
    name: 'Unknown Select (should use AI)',
    question: 'Which programming paradigm do you prefer?',
    fieldType: 'select',
    options: ['Object-Oriented', 'Functional', 'Procedural', 'Mixed'],
    expectedSource: 'middle-option'  // Will fall back to safe default
  }
];

async function runTest(testCase, index) {
  const body = {
    question: testCase.question,
    options: testCase.options || [],
    profile: testProfile,
    resumeText: 'Senior Software Engineer with 5 years of experience in full-stack development. Expertise in React, Node.js, Python. Built scalable microservices at tech companies.',
    jobTitle: 'Senior Software Engineer',
    company: 'Acme Corp'
  };

  try {
    const response = await fetch('http://localhost:3000/api/vault/infer-answer-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${index + 1}/${testCases.length}: ${testCase.name}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Question: ${testCase.question}`);
    console.log(`Answer: ${result.answer}`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`Source: ${result.source}`);
    console.log(`Reasoning: ${result.reasoning}`);
    
    if (testCase.expectedSource && result.source !== testCase.expectedSource) {
      console.log(`⚠️  WARNING: Expected source '${testCase.expectedSource}' but got '${result.source}'`);
    }
    
    if (result.confidence >= 0.85) {
      console.log(`✅ HIGH CONFIDENCE - Would auto-fill`);
    } else if (result.confidence >= 0.5) {
      console.log(`⚠️  MEDIUM CONFIDENCE - Would fill with caution`);
    } else {
      console.log(`❌ LOW CONFIDENCE - Might skip or use default`);
    }

    return result;
  } catch (error) {
    console.error(`❌ Test ${index + 1} failed:`, error.message);
    return null;
  }
}

async function runAllTests() {
  console.log('\n🚀 Starting Full Auto Mode AI Engine Tests\n');
  console.log('Testing endpoint: http://localhost:3000/api/vault/infer-answer-v2\n');

  const results = [];
  for (let i = 0; i < testCases.length; i++) {
    const result = await runTest(testCases[i], i);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 TEST SUMMARY');
  console.log(`${'='.repeat(80)}`);
  
  const validResults = results.filter(r => r !== null);
  const highConfidence = validResults.filter(r => r.confidence >= 0.85).length;
  const mediumConfidence = validResults.filter(r => r.confidence >= 0.5 && r.confidence < 0.85).length;
  const lowConfidence = validResults.filter(r => r.confidence < 0.5).length;
  
  const avgConfidence = validResults.reduce((sum, r) => sum + r.confidence, 0) / validResults.length;
  
  console.log(`Total Tests: ${testCases.length}`);
  console.log(`Successful: ${validResults.length}`);
  console.log(`Failed: ${testCases.length - validResults.length}`);
  console.log(`\nConfidence Distribution:`);
  console.log(`  High (≥85%): ${highConfidence} - ${((highConfidence/validResults.length)*100).toFixed(1)}%`);
  console.log(`  Medium (50-84%): ${mediumConfidence} - ${((mediumConfidence/validResults.length)*100).toFixed(1)}%`);
  console.log(`  Low (<50%): ${lowConfidence} - ${((lowConfidence/validResults.length)*100).toFixed(1)}%`);
  console.log(`\nAverage Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  
  const sources = validResults.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  
  console.log(`\nSources Used:`);
  Object.entries(sources).forEach(([source, count]) => {
    console.log(`  ${source}: ${count} (${((count/validResults.length)*100).toFixed(1)}%)`);
  });
  
  console.log(`\n${'='.repeat(80)}`);
  
  if (avgConfidence >= 0.85) {
    console.log('✅ EXCELLENT - System ready for full automation!');
  } else if (avgConfidence >= 0.7) {
    console.log('⚠️  GOOD - System working but may need some tuning');
  } else {
    console.log('❌ NEEDS IMPROVEMENT - Review AI engine configuration');
  }
}

// Check if server is running first
fetch('http://localhost:3000')
  .then(() => runAllTests())
  .catch(err => {
    console.error('❌ Server not running on port 3000!');
    console.error('Please start the backend first: cd d:\\Automation && npm start');
    process.exit(1);
  });
