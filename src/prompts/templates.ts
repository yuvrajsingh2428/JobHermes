// ============================================================
// AI Prompts – Structured prompt templates for all AI tasks
// ============================================================

import { JobPosting, CandidateProfile } from '../types';

export const Prompts = {
  // ─── Job Relevance Filter ─────────────────────────────────

  jobRelevanceFilter(job: JobPosting, profile: CandidateProfile): string {
    return `You are a job relevance evaluator for a software engineer candidate.

CANDIDATE PROFILE:
- Name: ${profile.name}
- Title: ${profile.title}
- Target Roles: ${profile.targetRoles.join(', ')}
- Skills: ${[...profile.skills.languages, ...profile.skills.backend, ...profile.skills.frontend].join(', ')}
- Preferred Locations: ${profile.preferredLocations.join(', ')}
- Open to Remote: ${profile.openToRemote}
- Minimum Salary: ${profile.minSalaryLPA} LPA

JOB POSTING:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Salary: ${job.salary || 'Not specified'}
- Description: ${(job.description || '').slice(0, 800)}

Task: Determine if this job is relevant for this candidate.
Return ONLY a JSON object with this exact shape:
{
  "relevant": true/false,
  "confidence": 0-100,
  "reason": "brief reason (max 2 sentences)",
  "keyRequirements": ["requirement1", "requirement2"]
}`;
  },

  // ─── Resume Generation ────────────────────────────────────

  generateResume(job: JobPosting, profile: CandidateProfile): string {
    const allSkills = [
      ...profile.skills.languages,
      ...profile.skills.frontend,
      ...profile.skills.backend,
      ...profile.skills.databases,
      ...profile.skills.cloud,
      ...profile.skills.tools,
    ];

    const experienceStr = profile.experience
      .map(
        (e) =>
          `${e.role} at ${e.company} (${e.duration}):\n${e.highlights.map((h) => `  - ${h}`).join('\n')}`
      )
      .join('\n\n');

    return `You are an expert resume writer specializing in tech industry resumes.

TARGET JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${(job.description || '').slice(0, 1200)}

CANDIDATE PROFILE:
Name: ${profile.name}
Email: ${profile.email} | Phone: ${profile.phone}
LinkedIn: ${profile.linkedin || 'N/A'} | GitHub: ${profile.github || 'N/A'}
Location: ${profile.location}

PROFESSIONAL SUMMARY (to be tailored):
${profile.summary}

SKILLS: ${allSkills.join(', ')}

EXPERIENCE:
${experienceStr}

EDUCATION:
${profile.education.map((e) => `${e.degree} – ${e.institution} (${e.year})`).join('\n')}

CERTIFICATIONS: ${profile.certifications.join(', ')}

Task: Generate a highly tailored, ATS-optimized resume for the role of "${job.title}" at ${job.company}.

Requirements:
1. Tailor the professional summary to match the job description
2. Highlight the most relevant skills first
3. Rewrite experience bullets to match job requirements
4. Use strong action verbs and quantify impact where possible
5. Format as clean HTML with inline CSS for email/PDF compatibility
6. Include all sections: Header, Summary, Skills, Experience, Education, Certifications
7. ATS-friendly: include keywords from the job description naturally
8. Keep it to 1 page equivalent (max ~600 words of content)

Return ONLY the HTML markup, no explanations.`;
  },

  // ─── Cover Letter Generation ──────────────────────────────

  generateCoverLetter(
    job: JobPosting,
    profile: CandidateProfile,
    tone: 'professional' | 'enthusiastic' | 'concise' = 'professional'
  ): string {
    const toneInstructions = {
      professional: 'formal, polished, and confident. Use industry-standard language.',
      enthusiastic: 'warm, energetic, and passionate about the role. Show genuine excitement.',
      concise: 'brief and to the point. Maximum 3 paragraphs, no filler words.',
    };

    const recentExp = profile.experience[0];

    return `You are a professional cover letter writer for tech professionals.

TARGET JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Job Description: ${(job.description || '').slice(0, 1000)}

CANDIDATE:
- Name: ${profile.name}
- Current Role: ${recentExp?.role || profile.title} at ${recentExp?.company || 'current employer'}
- Key Achievements: ${recentExp?.highlights?.slice(0, 2).join(' | ') || profile.summary}
- Target Location: ${profile.preferredLocations[0] || profile.location}

TONE: ${toneInstructions[tone]}

Task: Write a compelling cover letter for the "${job.title}" role at ${job.company}.

Requirements:
1. Start with a strong opening hook (NOT "I am writing to apply for...")
2. Connect candidate's specific achievements to the company's needs
3. Show knowledge of the company and why it excites the candidate
4. Address the most critical job requirements
5. End with a confident call to action
6. Keep it to 3-4 paragraphs maximum
7. Format as clean HTML with inline CSS
8. Include proper salutation and closing

Return ONLY the HTML markup, no explanations.`;
  },

  // ─── Job Analysis ─────────────────────────────────────────

  analyzeJob(job: JobPosting): string {
    return `Analyze this job posting and extract structured information.

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description: ${(job.description || '').slice(0, 2000)}

Extract and return ONLY a JSON object with this shape:
{
  "requiredSkills": ["skill1", "skill2"],
  "niceToHaveSkills": ["skill1"],
  "experienceYears": { "min": 0, "max": 0 },
  "jobType": "full-time|part-time|contract|remote",
  "seniorityLevel": "junior|mid|senior|lead|principal",
  "keyResponsibilities": ["responsibility1", "responsibility2"],
  "benefits": ["benefit1"],
  "salaryRange": "estimated if not mentioned",
  "companyStage": "startup|growth|enterprise",
  "interviewInsights": "typical interview process for this role"
}`;
  },

  // ─── Daily Summary ────────────────────────────────────────

  generateDailySummary(
    jobs: JobPosting[],
    totalScraped: number,
    companiesCovered: string[]
  ): string {
    const topJobs = jobs.slice(0, 5);
    const topJobsList = topJobs
      .map((j, i) => `${i + 1}. ${j.title} at ${j.company} (Score: ${j.score})`)
      .join('\n');

    return `You are JobHermes, an AI job hunting agent. Write a friendly, concise daily job scan summary.

SCAN STATS:
- Total jobs scraped: ${totalScraped}
- Jobs after filtering: ${jobs.length}
- Companies covered: ${companiesCovered.join(', ')}
- Date: ${new Date().toLocaleDateString('en-IN')}

TOP 5 MATCHES:
${topJobsList}

Write a 3-4 sentence executive summary of today's job scan. Be encouraging, mention the best opportunities, and suggest an action (e.g., which job to apply to first).

Return plain text, no HTML.`;
  },
};
