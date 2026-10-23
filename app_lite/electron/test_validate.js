const groqService = require('./groqService');

async function test() {
  const key = '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';
  console.log('Testing key...');
  const result = await groqService.validateApiKey(key);
  console.log('Result:', result);
}

test();
