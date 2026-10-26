const groqService = require('./groqService');
const secureStore = require('./secureStore');

groqService.init(secureStore);

async function test() {
  const key = secureStore.getGroqApiKey();
  console.log('Testing stored key:', key ? `${key.substring(0, 8)}...` : 'None');
  const result = await groqService.testConnection();
  console.log('Result:', result);
}

test();
