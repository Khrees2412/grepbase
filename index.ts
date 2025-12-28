import OpenAI from 'openai';

// Configure OpenAI client to use your local LM Studio server
const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:1234/v1',
  apiKey: 'not-needed-for-local', // LM Studio doesn't require an API key
});

async function chatWithLocalModel() {
  try {
    // Get available models
    const models = await openai.models.list();
    console.log('Available models:', models.data.map(m => m.id));

    // Chat completion
    const completion = await openai.chat.completions.create({
      model: models.data[0]?.id || 'local-model', // Use first available model
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Explain quantum computing in simple terms.' },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    console.log('Response:', completion.choices[0].message.content);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Streaming example
async function streamingChat() {
  try {
    const stream = await openai.chat.completions.create({
      model: 'local-model',
      messages: [
        { role: 'user', content: 'Tell me a short story about a robot.' }
      ],
      stream: true,
      max_tokens: 300,
    });

    console.log('Streaming response:');
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        process.stdout.write(content);
      }
    }
    console.log('\n--- Stream ended ---');
  } catch (error) {
    console.error('Streaming error:', error);
  }
}

// Run examples
chatWithLocalModel();
setTimeout(() => streamingChat(), 3000); // Run streaming example after 3 seconds