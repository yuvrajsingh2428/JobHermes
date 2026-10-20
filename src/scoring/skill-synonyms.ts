// ============================================================
// Skill Synonyms Map – Normalizes varied SDET tool spellings
// ============================================================

export interface SkillSynonym {
  canonical: string;
  patterns: RegExp[];
  weight: number; // 1-3 (3 for primary SDET tools)
}

export const SDET_SKILL_SYNONYMS: SkillSynonym[] = [
  // Primary Automation Tools & Frameworks
  {
    canonical: 'Selenium',
    patterns: [/\bselenium\b/i, /\bselenium webdriver\b/i],
    weight: 3,
  },
  {
    canonical: 'Playwright',
    patterns: [/\bplaywright\b/i],
    weight: 3,
  },
  {
    canonical: 'REST Assured',
    patterns: [/\brest[- ]?assured\b/i, /\brestassured\b/i],
    weight: 3,
  },
  {
    canonical: 'Cypress',
    patterns: [/\bcypress\b/i],
    weight: 2,
  },
  {
    canonical: 'TestNG',
    patterns: [/\btestng\b/i],
    weight: 3,
  },
  {
    canonical: 'JUnit',
    patterns: [/\bjunit\b/i, /\bjunit5\b/i],
    weight: 2,
  },
  {
    canonical: 'Cucumber (BDD)',
    patterns: [/\bcucumber\b/i, /\bgherkin\b/i, /\bbdd\b/i, /\bbehavior[- ]driven\b/i],
    weight: 2,
  },
  {
    canonical: 'Postman',
    patterns: [/\bpostman\b/i],
    weight: 2,
  },
  {
    canonical: 'Appium',
    patterns: [/\bappium\b/i],
    weight: 2,
  },
  {
    canonical: 'JMeter',
    patterns: [/\bjmeter\b/i],
    weight: 2,
  },
  {
    canonical: 'PyTest',
    patterns: [/\bpytest\b/i],
    weight: 2,
  },

  // Languages
  {
    canonical: 'Java',
    patterns: [/\bjava\b(?!script)/i, /\bcore java\b/i],
    weight: 3,
  },
  {
    canonical: 'Python',
    patterns: [/\bpython\b/i],
    weight: 2,
  },
  {
    canonical: 'JavaScript',
    patterns: [/\bjavascript\b/i, /\bjs\b/i],
    weight: 2,
  },
  {
    canonical: 'TypeScript',
    patterns: [/\btypescript\b/i, /\bts\b/i],
    weight: 2,
  },
  {
    canonical: 'SQL',
    patterns: [/\bsql\b/i, /\bpostgresql\b/i, /\bmysql\b/i],
    weight: 2,
  },

  // CI/CD & DevOps
  {
    canonical: 'Jenkins',
    patterns: [/\bjenkins\b/i],
    weight: 3,
  },
  {
    canonical: 'Git',
    patterns: [/\bgit\b/i, /\bgithub\b/i, /\bgitlab\b/i],
    weight: 2,
  },
  {
    canonical: 'CI/CD Integration',
    patterns: [/\bci\/?cd\b/i, /\bcontinuous integration\b/i, /\bpipelines?\b/i],
    weight: 2,
  },
  {
    canonical: 'Docker',
    patterns: [/\bdocker\b/i, /\bcontainers?\b/i],
    weight: 2,
  },

  // Methodologies & Paradigms
  {
    canonical: 'API Testing',
    patterns: [/\bapi test(ing)?\b/i, /\brest api\b/i, /\bweb services\b/i, /\bmicroservices\b/i],
    weight: 3,
  },
  {
    canonical: 'Framework Design',
    patterns: [
      /\bframework design\b/i,
      /\bautomation framework\b/i,
      /\bhybrid framework\b/i,
      /\bpage object model\b/i,
      /\bpom\b/i,
    ],
    weight: 3,
  },
  {
    canonical: 'Performance Testing',
    patterns: [/\bperformance test(ing)?\b/i, /\bload test(ing)?\b/i],
    weight: 1,
  },
];

export function matchSkillInText(skillName: string, text: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerSkill = skillName.toLowerCase();

  // 1. Literal substring match
  if (lowerText.includes(lowerSkill)) return true;

  // 2. Specific tool-to-concept equivalences for SDET keyword gap analysis
  if (lowerSkill === 'api testing') {
    if (
      /\b(api test(ing)?|rest api|web services|microservices|rest[- ]?assured|postman)\b/i.test(
        text
      )
    ) {
      return true;
    }
  }

  if (lowerSkill === 'ci/cd integration' || lowerSkill === 'ci/cd') {
    if (
      /\b(ci\/?cd|continuous integration|pipelines?|jenkins|github actions|gitlab)\b/i.test(text)
    ) {
      return true;
    }
  }

  // 3. Exact match with canonical entry in SDET_SKILL_SYNONYMS
  const canonicalEntry = SDET_SKILL_SYNONYMS.find(
    (item) => item.canonical.toLowerCase() === lowerSkill
  );
  if (canonicalEntry) {
    for (const pattern of canonicalEntry.patterns) {
      if (pattern.test(text)) return true;
    }
  }

  // 4. Pattern match: if skillName matches any pattern of an entry whose patterns match text
  for (const item of SDET_SKILL_SYNONYMS) {
    const isThisSkill =
      item.canonical.toLowerCase() === lowerSkill || item.patterns.some((p) => p.test(skillName));
    if (isThisSkill) {
      for (const pattern of item.patterns) {
        if (pattern.test(text)) return true;
      }
    }
  }

  return false;
}

export function extractSkillsFromText(text: string): {
  canonicalSkills: string[];
  totalWeightedScore: number;
} {
  const found = new Set<string>();
  let score = 0;

  for (const item of SDET_SKILL_SYNONYMS) {
    for (const pattern of item.patterns) {
      if (pattern.test(text)) {
        if (!found.has(item.canonical)) {
          found.add(item.canonical);
          score += item.weight;
        }
        break;
      }
    }
  }

  return { canonicalSkills: [...found], totalWeightedScore: score };
}
