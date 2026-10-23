const groqService = require('./electron/groqService.js');
const fs = require('fs');

async function test() {
  console.log("Testing transcribeAudio...");
  try {
    const dummyBuffer = Buffer.from('RIFF$...');
    const result = await groqService.transcribeAudio(dummyBuffer, 'ru');
    console.log("Result:", result);
  } catch(e) {
    console.error("Caught error:", e);
  }
}

test();
