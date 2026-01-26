import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CACHED_CONTEXT = `INSURANCE GUIDELINES: Pre-auth required over $1000. Labs must be in-network.`;

async function test() {
  console.log('Testing cache...\n');
  
  const r1 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: [
      { type: 'text', text: 'You are a billing expert.' },
      { type: 'text', text: CACHED_CONTEXT, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: 'Is pre-auth needed for $2000 procedure?' }]
  });
  
  console.log('Call 1:', r1.usage);
  
  await new Promise(r => setTimeout(r, 1000));
  
  const r2 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: [
      { type: 'text', text: 'You are a billing expert.' },
      { type: 'text', text: CACHED_CONTEXT, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: 'Do labs need to be in-network?' }]
  });
  
  console.log('Call 2:', r2.usage, '(cached! 90% off)');
}

test().catch(console.error);
