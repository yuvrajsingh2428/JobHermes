// ============================================================
// Email Pattern Inferrer – Deduces corporate email structures
// ============================================================

export type EmailPattern =
  | 'first.last'    // john.doe@domain.com
  | 'firstlast'     // johndoe@domain.com
  | 'flast'         // jdoe@domain.com
  | 'first_last'    // john_doe@domain.com
  | 'first'         // john@domain.com
  | 'lastf';        // doej@domain.com

export interface InferredProposal {
  email: string;
  pattern: EmailPattern;
  status: 'guessed';
}

function cleanNameParts(fullName: string): { first: string; last: string } {
  const parts = fullName
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const first = parts[0] || 'contact';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return { first, last };
}

export function detectDomainPattern(knownEmail: string, knownFullName?: string): EmailPattern | null {
  const [localPart] = knownEmail.toLowerCase().trim().split('@');
  if (!localPart) return null;

  if (knownFullName) {
    const { first, last } = cleanNameParts(knownFullName);
    if (last) {
      if (localPart === `${first}.${last}`) return 'first.last';
      if (localPart === `${first}${last}`) return 'firstlast';
      if (localPart === `${first.charAt(0)}${last}`) return 'flast';
      if (localPart === `${first}_${last}`) return 'first_last';
      if (localPart === `${last}${first.charAt(0)}`) return 'lastf';
      if (localPart === first) return 'first';
    }
  }

  // Fallback heuristics from localPart alone
  if (localPart.includes('.')) return 'first.last';
  if (localPart.includes('_')) return 'first_last';

  return null;
}

export function generateEmailFromPattern(
  fullName: string,
  domain: string,
  pattern: EmailPattern = 'first.last'
): string {
  const { first, last } = cleanNameParts(fullName);
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();

  let local = first;
  switch (pattern) {
    case 'first.last':
      local = last ? `${first}.${last}` : first;
      break;
    case 'firstlast':
      local = last ? `${first}${last}` : first;
      break;
    case 'flast':
      local = last ? `${first.charAt(0)}${last}` : first;
      break;
    case 'first_last':
      local = last ? `${first}_${last}` : first;
      break;
    case 'lastf':
      local = last ? `${last}${first.charAt(0)}` : first;
      break;
    case 'first':
      local = first;
      break;
  }

  return `${local}@${cleanDomain}`;
}

export function proposeContactEmails(
  fullName: string,
  domain: string,
  knownVerifiedEmail?: string,
  knownVerifiedFullName?: string
): InferredProposal[] {
  let detectedPattern: EmailPattern | null = null;
  if (knownVerifiedEmail) {
    detectedPattern = detectDomainPattern(knownVerifiedEmail, knownVerifiedFullName);
  }

  // If pattern was detected from a known email at the company, return that as top proposal
  if (detectedPattern) {
    return [
      {
        email: generateEmailFromPattern(fullName, domain, detectedPattern),
        pattern: detectedPattern,
        status: 'guessed',
      },
    ];
  }

  // Otherwise provide top common corporate guesses (first.last and flast)
  const commonPatterns: EmailPattern[] = ['first.last', 'flast', 'firstlast'];
  return commonPatterns.map((pat) => ({
    email: generateEmailFromPattern(fullName, domain, pat),
    pattern: pat,
    status: 'guessed',
  }));
}
