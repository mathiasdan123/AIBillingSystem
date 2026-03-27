import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// YOUR COMPLETE ACTIVITIES DATABASE from SOAP template
const ALL_ACTIVITIES = `
PEDIATRIC OT - COMPLETE ACTIVITIES DATABASE

97110 – THERAPEUTIC EXERCISE:
Resistive Putty – Squeeze, Resistive Putty – Pinch/Pinch-Drag, Theraband – Shoulder Flex/Abd, Theraband – Rows, Grip Strengthener, Finger Web / Digi-Flex, Wall Push-Ups, Table Push-Ups, Chair/Bench Dips, Crab Walk, Bear Walk, Plank Hold, Side Plank, Wheelbarrow Walk, Prone Extension, Bridging, Sit-to-Stand Reps, Medicine Ball Press, Thera-egg Squeezes, Finger Isolation Taps, Clothespin Pinch Lines, Pinch-Flip Coins, Rice Scoop

97112 – NEUROMUSCULAR RE-EDUCATION:
Balance Board – Static, Balance Board – Dynamic, Foam Beam – Tandem Walk, Cross-Crawl, Animal Walks – Bunny Hops, Animal Walks – Bear Walk, Animal Walks – Crab Walk, Bilateral Ball Toss, Balloon Volleyball, Ladder Drills, Step-Stool Sequencing, Prone on Scooter Board, Supine Flexion Tucks, Swing – Prone Superman, Swing – Seated Linear, Target Toss While Balancing, Midline Crossing – Bean Bag Sort, Finger-to-Nose Alternation, Simon Says Sequencing, Theraband Isometrics with Balance, Yoga Flow, One-Leg Stance

97530 – THERAPEUTIC ACTIVITIES:
Obstacle Course, Pegboard – Pattern Copy, Puzzles 12-24 pieces, Mazes, Cutting Lines, Coloring In-Lines, Block Design, Lacing Cards/Shoes, Buttoning/Zipping, Feeding Practice, Writing Name/Letters, Drawing Shapes, Coin Bank, Tweezers Transfer, Stickers Placement, Playdough, Beading Patterns, Puzzle Lite, ADL Handwashing, ADL Coat On/Off, ADL Shoes/S
cat > testRealSOAP.js << 'ENDFILE'
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ALL_ACTIVITIES = 'PEDIATRIC OT DATABASE\n97110 EXERCISE: Resistive Putty Squeeze, Resistive Putty Pinch/Pinch-Drag, Theraband Shoulder Flex/Abd, Theraband Rows, Grip Strengthener, Finger Web Digi-Flex, Wall Push-Ups, Table Push-Ups, Chair/Bench Dips, Crab Walk, Bear Walk, Plank Hold, Side Plank, Wheelbarrow Walk, Prone Extension, Bridging, Sit-to-Stand Reps, Medicine Ball Press, Thera-egg Squeezes, Finger Isolation Taps, Clothespin Pinch Lines, Pinch-Flip Coins, Rice Scoop\n97112 NEUROMUSCULAR: Balance Board Static, Balance Board Dynamic, Foam Beam Tandem Walk, Cross-Crawl, Animal Walks Bunny Hops, Animal Walks Bear Walk, Animal Walks Crab Walk, Bilateral Ball Toss, Balloon Volleyball, Ladder Drills, Step-Stool Sequencing, Prone Scooter Board Pulls, Supine Flexion Tucks, Swing Prone Superman, Swing Seated Linear, Target Toss While Balancing, Midline Crossing Bean Bag Sort, Finger-to-Nose Alternation, Simon Says Sequencing, Theraband Isometrics with Balance, Yoga Flow, One-Leg Stance\n97530 THERAPEUTIC: Obstacle Course, Pegboard Pattern Copy, Puzzles 12-24 pieces, Mazes, Cutting Lines, Coloring In-Lines, Block Design, Lacing Cards/Shoes, Buttoning/Zipping, Feeding Practice, Writing Name/Letters, Drawing Shapes, Coin Bank, Tweezers Transfer, Stickers Placement, Playdough, Beading Patterns, Puzzle Lite, ADL Handwashing, ADL Coat On/Off, ADL Shoes/Socks, Pencil Grasp Practice\n97533 SENSORY: Rice Bin Bury/Find, Beans Bin Scoop/Pour, Kinetic Sand, Brushing Protocol, Joint Compressions, Crash Pad Jumps, Weighted Vest Trial, Body Sock, Sensory Swing Platform, Sensory Swing Lycra/Cuddle, Sensory Swing Bolster, Trampoline Jumps, Deep Pressure Roller, Oral Motor Chewelry, Oral Motor Crunchy Snacks, Fidgets Heavy Work, Proprioceptive Carry, Tactile Shaving Cream, Vibration Z-vibe, Auditory Headphones, Visual Low Lighting, Calming Corner\nSKILLS: Postural Control, Bilateral Coordination, Crossing Midline, Fine Motor Precision, Grasp Strength, Hand Endurance, Visual Motor Integration, Ocular Motor Control, Sensory Regulation calming/alerting, Core Strength, Attention/Focus, Motor Planning, Body Awareness, Balance/Equilibrium, ADL Independence, Graphomotor, Tool Use, Praxis/Sequencing, Self-Advocacy/Interoception';
async function test() { console.log('🧸 OT AI - Caching Test\n'); const p1 = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: [{ type: 'text', text: 'Pediatric OT' }, { type: 'text', text: ALL_ACTIVITIES, cache_control: { type: 'ephemeral' }}], messages: [{ role: 'user', content: '4yo poor grasp. Recommend 3 activities with CPT codes.' }] }); console.log('P1:', p1.usage, '\n'); await new Promise(r => setTimeout(r, 2000)); const p2 = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: [{ type: 'text', text: 'Pediatric OT' }, { type: 'text', text: ALL_ACTIVITIES, cache_control: { type: 'ephemeral' }}], messages: [{ role: 'user', content: '6yo sensory seeking. Heavy work activities?' }] }); console.log('P2 (CACHED!):', p2.usage); console.log(`\n💰 ${p2.usage.cache_read_input_tokens || 0} tokens at 90% off!`); }
test().catch(console.error);
ENDFILE
node testRealSOAP.js

node testRealSOAP.js
cd ~/Documents/GitHub/AIBillingSystem
node testRealSOAP.js

zsh -f
