const https = require('https');
const FormData = require('form-data');
const fs = require('fs');

// Создаем пустой фейковый аудиофайл для теста
const dummyAudio = Buffer.from('dummy audio content');

const form = new FormData();
form.append('file', dummyAudio, {
  filename: 'test.webm',
  contentType: 'audio/webm',
});
form.append('model', 'whisper-large-v3-turbo');
form.append('response_format', 'json');

const reqOptions = {
  hostname: 'n8n.fond-hub.ru',
  path: '/webhook/transcribe',
  method: 'POST',
  headers: {'Authorization': 'Bearer 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', ...form.getHeaders()}
};

console.log("Отправляем тестовый аудиофайл на webhook-test...");

const req = https.request(reqOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
});

form.pipe(req);
