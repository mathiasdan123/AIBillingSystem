import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const THERAPY_ACTIVITIES = `
OCCUPATIONAL THERAPY ACTIVITIES:
1. Bead Threading - Fine motor, hand-eye coordination (3-8 years)
2. Playdough Activities - Hand strengthening, sensory (2-10 years)
3. Pegboard Activities - Fine motor precision (3-7 years)
4. Scissor Skills - Bilateral coordination (3-8 years)
5. Animal Walks - Core strength, motor planning (2-8 years)
6. Obstacle Course - Balance, sequencing (3-10 years)
7. Sensory Bins - Tactile processing (2-10 years)

SPEECH THERAPY ACTIVITIES:
8. Mirror Work - Articulation practice (3+ years)
9. Story Sequencing - Narrative skills (3-10 years)
10. Following Directions - Receptive language (2-8 years)
11. Turn-Taking Games - Social communication (3-10 years)
12. Emotion Recognition - Social awareness (3-10 years)
`;

async function test() {
  console.log('🧸 THERAPY AI - Prompt Caching Demo\n');

  const r1 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: [
      { type: 'text', text: 'You are a pediatric therapist.' },
      { type: 'text', text: THERAPY_ACTIVITIES, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: 'Patient: 5yo with /r/ and /s/ sound errors. Recommend 3 activities.' }]
  });

  console.log('Patient 1:', r1.usage);
  console.log(r1.content[0].type === 'text' ? r1.content[0].text : '');
  
  await new Promise(r => setTimeout(r, 2000));

  const r2 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: [
      { type: 'text', text: 'You are a pediatric therapist.' },
      { type: 'text', text: THERAPY_ACTIVITIES, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: 'Patient: 4yo with poor pencil grasp. What activities help?' }]
  });

  console.log('\nPatient 2 (CACHED!):', r2.usage);
  console.log(r2.content[0].type === 'text' ? r2.content[0].text : '');
  
  console.log(`\n💰 Cached ${r2.usage.cache_read_input_tokens || 0} tokens at 90% discount!`);
}

test().catch(console.error);
