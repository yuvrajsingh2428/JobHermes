// ============================================================
// Staging Pusher Script – Automates staging commit & push
// ============================================================

const { execSync } = require('child_process');

function runCommand(command) {
  try {
    console.log(`> ${command}`);
    execSync(command, { encoding: 'utf-8', stdio: 'inherit' });
  } catch (err) {
    console.error(`❌ Command failed: ${command}`);
    process.exit(1);
  }
}

function main() {
  console.log('🚀 Starting JobHermes Staging Pusher...');

  // 1. Check current branch
  let currentBranch = 'main';
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    console.error('❌ Could not determine current git branch. Is git initialized?');
    process.exit(1);
  }

  if (currentBranch !== 'staging') {
    console.log(`Currently on '${currentBranch}'. Switching to 'staging'...`);
    try {
      execSync('git checkout staging', { stdio: 'ignore' });
    } catch {
      console.log('Staging branch does not exist locally. Creating it...');
      runCommand('git checkout -b staging');
    }
  }

  // 2. Stage changes
  console.log('Staging changes...');
  runCommand('git add .');

  // 3. Commit changes
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const commitMsg = process.argv.slice(2).join(' ') || `chore: staging update - ${timestamp}`;
  console.log(`Committing changes: "${commitMsg}"`);
  
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
    console.log('⚠️ No changes detected. Nothing to commit.');
  } catch {
    runCommand(`git commit -m "${commitMsg}"`);
  }

  // 4. Push staging
  console.log('Pushing to remote staging branch...');
  runCommand('git push origin staging');

  console.log('✅ Successfully pushed to staging branch! You can now merge this into main.');
}

main();
