// ============================================================
// Experience & Salary Parsers – Extracts structured metrics from JDs
// ============================================================

export interface ParsedExperience {
  minYears: number | null;
  maxYears: number | null;
  rawMatch: string | null;
  isFresher: boolean;
}

export interface ParsedSalary {
  minLpa: number | null;
  maxLpa: number | null;
  rawMatch: string | null;
}

export function parseExperienceRequirement(text: string): ParsedExperience {
  if (!text) {
    return { minYears: null, maxYears: null, rawMatch: null, isFresher: false };
  }

  const lower = text.toLowerCase();

  // Check for fresher / entry level
  if (/\b(freshers?|entry[- ]level|college graduate|intern(ship)?)\b/i.test(lower)) {
    return { minYears: 0, maxYears: 1, rawMatch: 'fresher / entry-level', isFresher: true };
  }

  // Range match: "1-3 years", "2 to 4 yrs", "1 - 3 yrs of experience"
  const rangeMatch = lower.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:\+?\s*)?(?:yrs?|years?)(?:\s*(?:of\s*)?experience)?/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return { minYears: min, maxYears: max, rawMatch: rangeMatch[0], isFresher: false };
  }

  // Minimum / at least match: "minimum 2 years", "at least 3 yrs", "2+ years"
  const minMatch = lower.match(/(?:minimum|at least|min\.?)\s*(\d+)\s*(?:\+?\s*)?(?:yrs?|years?)/i);
  if (minMatch) {
    const min = parseInt(minMatch[1], 10);
    return { minYears: min, maxYears: null, rawMatch: minMatch[0], isFresher: false };
  }

  // Plus match: "2+ years", "3 + yrs"
  const plusMatch = lower.match(/(\d+)\s*\+\s*(?:yrs?|years?)/i);
  if (plusMatch) {
    const min = parseInt(plusMatch[1], 10);
    return { minYears: min, maxYears: null, rawMatch: plusMatch[0], isFresher: false };
  }

  // Generic single year requirement: "3 years of experience", "2 yrs experience"
  const singleMatch = lower.match(/(\d+)\s*(?:yrs?|years?)(?:\s*(?:of\s*)?experience)/i);
  if (singleMatch) {
    const min = parseInt(singleMatch[1], 10);
    return { minYears: min, maxYears: null, rawMatch: singleMatch[0], isFresher: false };
  }

  return { minYears: null, maxYears: null, rawMatch: null, isFresher: false };
}

export function parseSalaryLPA(salaryText?: string): ParsedSalary {
  if (!salaryText) {
    return { minLpa: null, maxLpa: null, rawMatch: null };
  }

  const text = salaryText.trim();

  // LPA format: "12-18 LPA", "15 LPA", "20 L.P.A."
  const lpaRange = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*lpa/i);
  if (lpaRange) {
    return {
      minLpa: parseFloat(lpaRange[1]),
      maxLpa: parseFloat(lpaRange[2]),
      rawMatch: lpaRange[0],
    };
  }

  const singleLpa = text.match(/(\d+(?:\.\d+)?)\s*lpa/i);
  if (singleLpa) {
    const val = parseFloat(singleLpa[1]);
    return { minLpa: val, maxLpa: val, rawMatch: singleLpa[0] };
  }

  // Lakhs format: "15-20 Lakhs", "12 Lakhs"
  const lakhMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*lakh/i);
  if (lakhMatch) {
    const min = parseFloat(lakhMatch[1]);
    const max = lakhMatch[2] ? parseFloat(lakhMatch[2]) : min;
    return { minLpa: min, maxLpa: max, rawMatch: lakhMatch[0] };
  }

  // Raw INR in millions / hundreds of thousands (e.g. 1,500,000 - 2,500,000)
  const numbers = text.replace(/,/g, '').match(/\b(\d{6,8})\b/g);
  if (numbers && numbers.length > 0) {
    const min = Math.round((parseInt(numbers[0], 10) / 100000) * 10) / 10;
    const max = numbers[1] ? Math.round((parseInt(numbers[1], 10) / 100000) * 10) / 10 : min;
    return { minLpa: min, maxLpa: max, rawMatch: text };
  }

  return { minLpa: null, maxLpa: null, rawMatch: null };
}
