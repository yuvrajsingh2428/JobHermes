// ============================================================
// Demo Sandbox – Isolated Demo DB for dry-runs and testing
// ============================================================

import path from 'path';
import fs from 'fs';
import { StorageService } from '../storage/database';
import { ContactService } from '../contacts/contact-service';
import { logger } from './logger';

export function getDemoDbPath(): string {
  return path.resolve('./data/demo.db');
}

export function seedDemoSandbox(demoDbPath = getDemoDbPath()): StorageService {
  const resolved = path.resolve(demoDbPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const storage = new StorageService(resolved);
  const contactService = new ContactService(storage);

  // 1. Seed demo job
  storage.upsertJob({
    title: 'Software Development Engineer in Test II',
    company: 'HackerRank',
    location: 'Hybrid in Bangalore, India',
    isRemote: false,
    url: 'https://job-boards.greenhouse.io/hackerrank/jobs/8155938',
    description: 'Looking for SDET II with 2-4 years experience in Java, Selenium, Playwright, REST Assured, and CI/CD Jenkins.',
    salary: '22 - 28 LPA',
    rawSalary: '22 - 28 LPA',
    jobType: 'Full-time',
    skills: ['Java', 'Playwright', 'Selenium', 'REST Assured', 'Jenkins', 'Postman', 'Docker', 'API Testing'],
    source: 'greenhouse',
    scrapedAt: new Date().toISOString(),
    status: 'new',
    isApplied: false,
    score: 85,
    stretch: false,
    reasons: [
      'Title: Exact SDET title match "Software Development Engineer in Test II" (25/25)',
      'Skills: 8 skills matched (Playwright, Postman, Java, Jenkins) of 10 requested (25/30)',
      'Experience: Requirement fits candidate 1-3 YOE sweet spot (15/15)',
      'Location: Target location "Hybrid in Bangalore, India" (10/10)',
      'Freshness: Fresh posting (<3 days ago) (10/10)',
      'Signal: Demo signal recorded (0/10 real points)',
    ],
  });

  // 2. Seed demo companies and contacts
  const csvPath = path.resolve('./data/demo/sample-contacts.csv');
  if (fs.existsSync(csvPath)) {
    contactService.importContactsFromCsv(csvPath, {
      defaultStatus: 'unknown',
      source: 'demo',
    });
  }

  // 3. Mark one contact as verified for demo testing
  const allContacts = storage.getAllContacts();
  if (allContacts.length > 0 && allContacts[0].id) {
    storage.verifyContact(allContacts[0].id);
  }

  // 4. Seed demo signal marked with source: 'demo'
  const hackerrank = storage.getCompanyByName('HackerRank');
  if (hackerrank && hackerrank.id) {
    storage.addSignal({
      companyId: hackerrank.id,
      signalType: 'funding',
      detail: 'Series C $60M led by Tiger Global (Sample Demo Signal)',
      url: 'https://techcrunch.com/sample-hackerrank-funding',
      source: 'demo',
    });
  }

  logger.success(`Demo sandbox initialized in ${resolved}`);
  return storage;
}
