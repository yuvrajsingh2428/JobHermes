import { StorageService } from '../src/storage/database';
import { FollowUpService, FollowUpEvaluation } from '../src/outreach/follow-up-service';
import { CandidateProfile } from '../src/types';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('./data/demo.db');
const storage = new StorageService(dbPath);
const followUpService = new FollowUpService(storage, 2);

const profile: CandidateProfile = JSON.parse(
  fs.readFileSync('./config/candidate-profile.json', 'utf-8')
);

console.log('\n======================================================');
console.log('DEMONSTRATION OF FOLLOW-UP CADENCE & INTEGRITY CHECKS');
console.log('======================================================\n');

console.log('--- Step 1: Simulating a sent email 6 days old for Contact #2 (Arjun Mehta) ---');
const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
const coldId = storage.addOutreach({
  contactId: 2,
  jobId: 1,
  type: 'cold',
  subject: 'SDET test automation @ HackerRank',
  body: 'Hi Arjun,\n\nReaching out regarding test automation at HackerRank.\n\nBest,\nCandidate',
  status: 'sent',
  sentAt: sixDaysAgo,
  source: 'demo'
});
console.log(`Created sent outreach #${coldId} (sentAt: ${sixDaysAgo})\n`);

console.log('--- Step 2: Running checkAndCreateFollowUps ---');
const evals1 = followUpService.checkAndCreateFollowUps(profile);
const arjunEval1 = evals1.find((e: FollowUpEvaluation) => e.outreachId === coldId);
console.log('Evaluation result for Contact #2:', arjunEval1);

if (arjunEval1?.createdFollowUpId) {
  const draft = storage.getOutreachById(arjunEval1.createdFollowUpId);
  console.log(`\nFollow-up draft #${arjunEval1.createdFollowUpId} properties:`);
  console.log(`- Status: "${draft?.status}" (strictly 'draft')`);
  console.log(`- Type: "${draft?.type}"`);
  console.log(`- Subject: "${draft?.subject}"`);
  console.log(`- Body:\n${draft?.body}\n`);
}

console.log('--- Step 3: Running checkAndCreateFollowUps again (Testing Max Cap of 2) ---');
const evals2 = followUpService.checkAndCreateFollowUps(profile);
const arjunEval2 = evals2.filter((e: FollowUpEvaluation) => e.contactId === 2);
console.log('Evaluation result on 2nd run (Testing Cap of 2):', arjunEval2);

console.log('\n--- Step 4: Simulating reply recording ---');
followUpService.recordReply(coldId, 'positive');
const coldOutreach = storage.getOutreachById(coldId);
console.log(`Outreach #${coldId} status after reply: "${coldOutreach?.status}", replyAt: "${coldOutreach?.replyAt}", outcome: "${coldOutreach?.outcome}"`);

console.log('\n--- Step 5: Running checkAndCreateFollowUps after reply (Testing Reply Stoppage) ---');
const evals3 = followUpService.checkAndCreateFollowUps(profile);
const arjunEval3 = evals3.filter((e: FollowUpEvaluation) => e.contactId === 2);
console.log('Evaluation result after reply received:', arjunEval3);

console.log('\n--- Step 6: Testing Suppression List Stoppage ---');
const coldId3 = storage.addOutreach({
  contactId: 3,
  jobId: 1,
  type: 'cold',
  subject: 'SDET role at Cred',
  body: 'Hi Rohan',
  status: 'sent',
  sentAt: sixDaysAgo,
  source: 'demo'
});
console.log(`Created sent outreach #${coldId3} for Contact #3`);
const contact3 = storage.getContactById(3)!;
storage.addToSuppressionList(contact3.email!, 'unsubscribed');
const evals4 = followUpService.checkAndCreateFollowUps(profile);
const rohanEval = evals4.filter((e: FollowUpEvaluation) => e.contactId === 3);
console.log('Evaluation result for suppressed contact #3:', rohanEval);
console.log('\n======================================================\n');
storage.close();
