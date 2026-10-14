import { fetchAllTargets } from '../src/sources';
import { scoringService } from '../src/scoring/scorer';
import { readJsonFile } from '../src/utils/helpers';
import { CandidateProfile, CompanyTarget } from '../src/types';

async function main() {
  const targets = readJsonFile<CompanyTarget[]>('./config/company-targets.json').filter(
    (t) => t.enabled && t.verified
  );
  const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
  console.log(`Scanning across ${targets.length} verified targets...`);
  const rawJobs = await fetchAllTargets(targets);
  console.log(`Fetched ${rawJobs.length} raw jobs`);

  const scored = scoringService.scoreAll(rawJobs, profile);

  console.log('\n============================================================');
  console.log('                   SCORE DISTRIBUTION                       ');
  console.log('============================================================');
  const buckets = [
    { range: '60-100', count: scored.filter((j) => (j.score || 0) >= 60).length },
    { range: '50-59', count: scored.filter((j) => (j.score || 0) >= 50 && (j.score || 0) < 60).length },
    { range: '40-49', count: scored.filter((j) => (j.score || 0) >= 40 && (j.score || 0) < 50).length },
    { range: '30-39', count: scored.filter((j) => (j.score || 0) >= 30 && (j.score || 0) < 40).length },
    { range: '20-29', count: scored.filter((j) => (j.score || 0) >= 20 && (j.score || 0) < 30).length },
    { range: 'Below 20', count: scored.filter((j) => (j.score || 0) < 20).length },
  ];
  console.table(buckets);

  console.log('\n============================================================');
  console.log('                  TOP 10 SCORED JOBS                        ');
  console.log('============================================================');
  const top10 = scored.slice(0, 10);
  top10.forEach((j, i) => {
    console.log(`\n#${i + 1} [Score: ${j.score}] [Stretch: ${j.stretch}] ${j.title} @ ${j.company} (${j.location})`);
    console.log(`  Source: ${j.source} | URL: ${j.url}`);
    console.log(`  Matched Skills: ${j.scoreBreakdown?.matchedSkills.join(', ') || 'None'}`);
    console.log(`  Missing Skills: ${j.scoreBreakdown?.missingSkills.join(', ') || 'None'}`);
    console.log('  Breakdown Reasons:');
    j.reasons?.forEach((r) => console.log(`    • ${r}`));
  });
}

main().catch(console.error);
