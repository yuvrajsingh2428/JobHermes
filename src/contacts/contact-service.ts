// ============================================================
// Contact Service – Contact rules, targeting heuristics, CSV import
// ============================================================

import fs from 'fs';
import path from 'path';
import { StorageService } from '../storage/database';
import { CompanyRecord, ContactRecord, ContactType, EmailStatus } from '../types';
import { logger } from '../utils/logger';

export interface TargetingRule {
  targetTitles: string[];
  priorityTypes: ContactType[];
  rationale: string;
}

export interface ResearchBrief {
  whatTheyBuild: string;
  recentSpecificThing: string;
  whyIFit: string;
}

export interface SendWindowCheck {
  allowed: boolean;
  localHour: number;
  localTime: string;
  weekday: string;
  timezone: string;
  reason?: string;
}

export function isWithinSendWindow(timezone = 'Asia/Kolkata', date = new Date()): SendWindowCheck {
  const targetTz = timezone || 'Asia/Kolkata';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTz,
      hour: 'numeric',
      hour12: false,
      minute: 'numeric',
      weekday: 'short',
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    const weekday = parts.find((p) => p.type === 'weekday')?.value || '';

    const localTime = `${weekday} ${String(hour).padStart(2, '0')}:${minute}`;

    // Business days: Mon-Fri
    if (weekday === 'Sat' || weekday === 'Sun') {
      return {
        allowed: false,
        localHour: hour,
        localTime,
        weekday,
        timezone: targetTz,
        reason: `Outside business days (${weekday}) in timezone ${targetTz}`,
      };
    }

    // Business hours: 09:00 to 18:00
    if (hour < 9 || hour >= 18) {
      return {
        allowed: false,
        localHour: hour,
        localTime,
        weekday,
        timezone: targetTz,
        reason: `Outside business hours (09:00 - 18:00) in timezone ${targetTz} (currently ${localTime})`,
      };
    }

    return {
      allowed: true,
      localHour: hour,
      localTime,
      weekday,
      timezone: targetTz,
    };
  } catch {
    // If invalid timezone, fallback to Asia/Kolkata
    return isWithinSendWindow('Asia/Kolkata', date);
  }
}

export class ContactService {
  private storage: StorageService;

  constructor(storage: StorageService) {
    this.storage = storage;
  }

  // ─── Contact Targeting Rules ───────────────────────────────

  getTargetingRule(company: CompanyRecord): TargetingRule {
    if (company.sizeBucket === 'startup') {
      return {
        targetTitles: [
          'Founder',
          'Co-Founder',
          'CTO',
          'Head of Engineering',
          'QA Lead',
          'Engineering Manager',
        ],
        priorityTypes: ['founder_cto', 'sdet_lead', 'eng_manager', 'qa_manager'],
        rationale:
          'In early-stage startups (<50 people), founders and CTOs hire engineers directly and respond fastest.',
      };
    }

    if (company.sizeBucket === 'large') {
      return {
        targetTitles: [
          'Technical Recruiter',
          'Talent Acquisition Partner',
          'QA Engineering Manager',
          'SDET Manager',
          'Director of QA',
        ],
        priorityTypes: ['recruiter', 'qa_manager', 'sdet_lead', 'eng_manager'],
        rationale:
          'In large enterprises, recruiters filter applications and QA engineering managers hold hiring headcount.',
      };
    }

    // Mid-size
    return {
      targetTitles: ['Engineering Manager', 'QA Manager', 'Lead SDET', 'Technical Recruiter'],
      priorityTypes: ['sdet_lead', 'qa_manager', 'eng_manager', 'recruiter'],
      rationale:
        'In growth-stage tech firms, engineering managers and QA leads make immediate interview decisions.',
    };
  }

  getTodoCompanies(): Array<{ company: CompanyRecord; rule: TargetingRule }> {
    const withoutContacts = this.storage.getCompaniesWithoutContacts();
    return withoutContacts.map((company) => ({
      company,
      rule: this.getTargetingRule(company),
    }));
  }

  // ─── Research Brief Management ─────────────────────────────

  saveResearchBrief(companyId: number, brief: ResearchBrief): void {
    const jsonStr = JSON.stringify(brief);
    this.storage.updateCompanyResearchBrief(companyId, jsonStr);
    logger.success(`Research brief saved for company ID ${companyId}`);
  }

  getResearchBrief(companyId: number): ResearchBrief | null {
    const comp = this.storage.getCompanyById(companyId);
    if (!comp || !comp.researchBrief) return null;
    try {
      return JSON.parse(comp.researchBrief) as ResearchBrief;
    } catch {
      return null;
    }
  }

  // ─── CSV Contact Importer ──────────────────────────────────

  importContactsFromCsv(
    csvFilePath: string,
    options?: { defaultStatus?: EmailStatus; source?: string }
  ): { imported: number; failed: number; errors: string[] } {
    const resolved = path.resolve(csvFilePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`CSV file not found at: ${resolved}`);
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      return { imported: 0, failed: 0, errors: ['CSV file is empty or missing data rows'] };
    }

    // Header parser: company, name, title, linkedin_url, email, timezone
    const header = lines[0]
      .toLowerCase()
      .split(',')
      .map((h) => h.trim().replace(/^["']|["']$/g, ''));
    const compIdx = header.indexOf('company');
    const nameIdx =
      header.indexOf('name') >= 0 ? header.indexOf('name') : header.indexOf('full_name');
    const titleIdx = header.indexOf('title');
    const linkedinIdx =
      header.indexOf('linkedin_url') >= 0
        ? header.indexOf('linkedin_url')
        : header.indexOf('linkedin');
    const emailIdx = header.indexOf('email');
    const tzIdx = header.indexOf('timezone');

    if (compIdx === -1 || nameIdx === -1) {
      throw new Error(
        `CSV must contain at least 'company' and 'name' columns. Found: ${header.join(', ')}`
      );
    }

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quoted commas
      const cols = line
        .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .map((c) => c.trim().replace(/^["']|["']$/g, ''));

      const companyName = cols[compIdx];
      const fullName = cols[nameIdx];
      const title = (titleIdx >= 0 ? cols[titleIdx] : '') || 'Software Professional';
      const linkedinUrl = linkedinIdx >= 0 ? cols[linkedinIdx] : undefined;
      const email = emailIdx >= 0 ? cols[emailIdx] : undefined;
      const timezone = tzIdx >= 0 && cols[tzIdx] ? cols[tzIdx] : 'Asia/Kolkata';

      if (!companyName || !fullName) {
        failed++;
        errors.push(`Row ${i + 1}: Missing company name or contact name`);
        continue;
      }

      try {
        // Ensure company exists
        let company = this.storage.getCompanyByName(companyName);
        if (!company) {
          const compId = this.storage.upsertCompany({
            name: companyName,
            domain: `${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
            sizeBucket: 'mid',
            ats: 'custom',
            notes: 'Created via CSV contact import',
          });
          company = this.storage.getCompanyById(compId);
        }

        if (!company || !company.id) {
          failed++;
          errors.push(`Row ${i + 1}: Failed to resolve company ${companyName}`);
          continue;
        }

        // Infer contact type from title
        const contactType = this.inferContactType(title);
        const emailStatus: EmailStatus = options?.defaultStatus || 'unknown';

        this.storage.addContact({
          companyId: company.id,
          fullName,
          title,
          contactType,
          linkedinUrl: linkedinUrl || undefined,
          email: email || undefined,
          emailStatus,
          timezone,
          source: options?.source || 'csv_import',
        });

        imported++;
      } catch (err: any) {
        failed++;
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    logger.success(`CSV Import finished: ${imported} contacts imported, ${failed} failed.`);
    return { imported, failed, errors };
  }

  inferContactType(title: string): ContactType {
    const t = title.toLowerCase();
    if (/\b(founder|co-founder|ceo|cto)\b/i.test(t)) return 'founder_cto';
    if (
      /\b(lead sdet|sdet lead|lead qa|qa lead|lead test|test lead|principal sdet|staff sdet)\b/i.test(
        t
      )
    ) {
      return 'sdet_lead';
    }
    if (
      /\b(qa manager|test manager|qa engineering manager|head of qa|director of qa|quality manager)\b/i.test(
        t
      )
    ) {
      return 'qa_manager';
    }
    if (/\b(recruiter|talent|sourcer|staffing|ta partner)\b/i.test(t)) return 'recruiter';
    if (
      /\b(engineering manager|eng manager|em|director of engineering|vp of engineering)\b/i.test(t)
    )
      return 'eng_manager';
    return 'generic_careers';
  }

  verifyContact(contactId: number): void {
    this.storage.verifyContact(contactId);
    logger.success(`Contact ID #${contactId} email marked as verified.`);
  }

  getContacts(companyName?: string): ContactRecord[] {
    if (companyName) {
      const comp = this.storage.getCompanyByName(companyName);
      if (!comp || !comp.id) return [];
      return this.storage.getContactsForCompany(comp.id);
    }
    return this.storage.getAllContacts();
  }

  getStorage(): StorageService {
    return this.storage;
  }
}
