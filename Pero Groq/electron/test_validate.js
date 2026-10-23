const groqService = require('./groqService');

async function test() {
  const key = 'gsk_YOUR_GROQ_API_KEY_HERE';
  console.log('Testing key...');
  const result = await groqService.validateApiKey(key);
  console.log('Result:', result);
}

test();
