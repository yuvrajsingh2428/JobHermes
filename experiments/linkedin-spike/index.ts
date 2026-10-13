// ============================================================
// LinkedIn Public Job Search Spike Experiment
// Standalone feasibility script for LinkedIn public job listings
// ============================================================

import fs from 'fs';
import path from 'path';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';

// ─── Configuration ──────────────────────────────────────────

const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');

const MAX_SEARCH_REQUESTS = 3;
const MAX_JOB_DETAIL_REQUESTS = 10;
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// Target Search URLs
const PRIMARY_SEARCH_URL =
  'https://in.linkedin.com/jobs/sdet-jobs-gurugram?keywords=Sdet&location=Gurugram&geoId=106442238&distance=50&f_TPR=r86400&activeFilter=f_TPR&position=1&pageNum=0';

const GUEST_API_SEARCH_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Sdet&location=Gurugram&geoId=106442238&distance=50&f_TPR=r86400&start=0';

// ─── Interfaces ─────────────────────────────────────────────

interface ExtractedJobSummary {
  jobId: string;
  title: string;
  company: string;
  location: string;
  postedTimeText: string;
  jobUrl: string;
  sourceEndpoint: string;
}

interface JobDetailResult {
  jobId: string;
  title: string;
  company: string;
  location: string;
  postedDate?: string;
  descriptionSnippet: string;
  descriptionLength: number;
  fullUrl: string;
  fetchedVia: string;
  status: number;
}

interface RequestLog {
  url: string;
  status: number;
  responseSize: number;
  durationMs: number;
  blocked: boolean;
  blockReason?: string;
}

interface SpikeResults {
  runTimestamp: string;
  searchRequestLogs: RequestLog[];
  jobDetailRequestLogs: RequestLog[];
  searchHtmlInfo: {
    primaryUrlStatus: number;
    primaryCardCount: number;
    guestApiStatus?: number;
    guestApiCardCount?: number;
    cardSourceUsed?: string;
  };
  extractedJobs: ExtractedJobSummary[];
  jobDetails: JobDetailResult[];
  summary: {
    totalSearchesMade: number;
    totalJobCardsFound: number;
    totalJobDetailsAttempted: number;
    totalJobDetailsParsed: number;
    blockEncountered: boolean;
    recommendation: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelay(): number {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
}

function ensureDirectories(): void {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
}

// Check for LinkedIn blocking response signals
function checkForBlock(status: number, html: string, finalUrl?: string): { blocked: boolean; reason?: string } {
  if (status === 429) return { blocked: true, reason: 'HTTP 429 Too Many Requests' };
  if (status === 999) return { blocked: true, reason: 'HTTP 999 LinkedIn Anti-Scraping Block' };
  if (status === 403) return { blocked: true, reason: 'HTTP 403 Forbidden' };
  
  if (finalUrl && (finalUrl.includes('/authwall') || finalUrl.includes('/login') || finalUrl.includes('/checkpoint'))) {
    return { blocked: true, reason: `Redirected to login/authwall: ${finalUrl}` };
  }

  if (html.includes('Security Verification') || html.includes('captcha') || html.includes('captcha-internal')) {
    return { blocked: true, reason: 'CAPTCHA challenge detected in HTML' };
  }

  if (html.includes('Sign in to view') && !html.includes('base-card') && !html.includes('job-search-card')) {
    return { blocked: true, reason: 'Login wall blocking main content' };
  }

  if (!html || html.trim().length === 0) {
    return { blocked: true, reason: 'Empty response body' };
  }

  return { blocked: false };
}

// Safe HTTP Fetcher with 1-time retry after 60s delay on block
async function fetchUrl(
  url: string,
  customHeaders?: Record<string, string>
): Promise<{ status: number; html: string; finalUrl: string; durationMs: number; blocked: boolean; blockReason?: string }> {
  const startTime = Date.now();
  const config: AxiosRequestConfig = {
    headers: { ...DEFAULT_HEADERS, ...customHeaders },
    timeout: 15000,
    validateStatus: () => true, // Don't throw on status codes
    maxRedirects: 5,
  };

  let response: AxiosResponse<string>;
  try {
    response = await axios.get<string>(url, config);
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    return {
      status: err.response?.status || 0,
      html: err.response?.data || '',
      finalUrl: url,
      durationMs,
      blocked: true,
      blockReason: `Network Error: ${err.message}`,
    };
  }

  const durationMs = Date.now() - startTime;
  const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const finalUrl = response.request?.res?.responseUrl || url;
  const blockCheck = checkForBlock(response.status, html, finalUrl);

  if (blockCheck.blocked) {
    console.warn(`⚠️ BLOCK SIGNAL DETECTED on ${url}: ${blockCheck.reason}`);
    console.log(`⏱️ Waiting 60 seconds before 1-time retry per spike rules...`);
    await sleep(60000);

    const retryStartTime = Date.now();
    try {
      const retryResponse = await axios.get<string>(url, config);
      const retryDurationMs = Date.now() - retryStartTime;
      const retryHtml = typeof retryResponse.data === 'string' ? retryResponse.data : JSON.stringify(retryResponse.data);
      const retryFinalUrl = retryResponse.request?.res?.responseUrl || url;
      const retryBlockCheck = checkForBlock(retryResponse.status, retryHtml, retryFinalUrl);

      return {
        status: retryResponse.status,
        html: retryHtml,
        finalUrl: retryFinalUrl,
        durationMs: retryDurationMs,
        blocked: retryBlockCheck.blocked,
        blockReason: retryBlockCheck.reason ? `[Post-retry] ${retryBlockCheck.reason}` : undefined,
      };
    } catch (retryErr: any) {
      return {
        status: retryErr.response?.status || 0,
        html: retryErr.response?.data || '',
        finalUrl: url,
        durationMs: Date.now() - retryStartTime,
        blocked: true,
        blockReason: `Retry failed: ${retryErr.message}`,
      };
    }
  }

  return {
    status: response.status,
    html,
    finalUrl,
    durationMs,
    blocked: false,
  };
}

// ─── Step A & B: Search Page Scraping & Parsing ─────────────

function parseJobCardsFromHtml(html: string, sourceEndpoint: string): ExtractedJobSummary[] {
  const $ = cheerio.load(html);
  const jobs: ExtractedJobSummary[] = [];

  // LinkedIn Public HTML Card Selectors
  // Pattern 1: <div class="base-card"> or <li class="result-card"> or <li> inside .jobs-search__results-list
  const cardElements = $('.base-card, .job-search-card, .result-card, li');

  cardElements.each((_, el) => {
    const elem = $(el);

    // Extract Job ID
    const entityUrn = elem.attr('data-entity-urn') || elem.find('[data-entity-urn]').attr('data-entity-urn');
    let jobId = '';
    if (entityUrn) {
      const match = entityUrn.match(/jobPosting:(\d+)/);
      if (match) jobId = match[1];
    }

    // Fallback: extract jobId from link href
    const linkElem = elem.find('a.base-card__full-link, a.job-search-card__link-title, a[href*="/jobs/view/"]');
    const href = linkElem.attr('href') || elem.attr('href') || '';
    if (!jobId && href) {
      const hrefMatch = href.match(/\/view\/.*?(\d+)/) || href.match(/currentJobId=(\d+)/) || href.match(/(\d{9,11})/);
      if (hrefMatch) jobId = hrefMatch[1];
    }

    // Extract Title
    const title =
      elem.find('.base-card__title, .job-search-card__title, h3, h4').text().trim() ||
      linkElem.text().trim();

    // Extract Company
    const company = elem
      .find('.base-card__subtitle, .job-search-card__subtitle, .result-card__subtitle-link, h4.base-search-card__subtitle')
      .text()
      .trim();

    // Extract Location
    const location = elem
      .find('.job-search-card__location, .job-result-card__location, .base-search-card__metadata span')
      .first()
      .text()
      .trim();

    // Extract Posted Time
    const postedTimeText = elem
      .find('time, .job-search-card__listdate, .job-search-card__listdate--new')
      .text()
      .trim();

    if (jobId && title) {
      // Deduplicate in list
      if (!jobs.some((j) => j.jobId === jobId)) {
        jobs.push({
          jobId,
          title,
          company: company || 'Unknown Company',
          location: location || 'Gurugram, HR, India',
          postedTimeText,
          jobUrl: `https://www.linkedin.com/jobs/view/${jobId}`,
          sourceEndpoint,
        });
      }
    }
  });

  return jobs;
}

// ─── Step C: Job Detail Scraping & Parsing ───────────────────

function parseJobDetailHtml(html: string): { title: string; company: string; location: string; description: string; postedDate?: string } {
  const $ = cheerio.load(html);

  const title = $('.top-card-layout__title, .job-details-jobs-unified-top-card__job-title, h1').text().trim();
  const company = $('.topcard__org-name-link, .top-card-layout__first-sub-text a, .job-details-jobs-unified-top-card__company-name').text().trim();
  const location = $('.topcard__flavor--bullet, .top-card-layout__first-sub-text span, .job-details-jobs-unified-top-card__bullet').text().trim();

  // Description container selectors for LinkedIn guest view
  const descElem = $('.show-more-less-html__markup, .description__text, .jobs-description__content, .job-details-module');
  const description = descElem.text().trim();

  const postedDate = $('time, .posted-time-ago__text').first().text().trim();

  return { title, company, location, description, postedDate };
}

// ─── Main Spike Execution ───────────────────────────────────

async function runSpike(): Promise<void> {
  console.log('🚀 Starting LinkedIn Public Job Search Spike Experiment...');
  ensureDirectories();

  const results: SpikeResults = {
    runTimestamp: new Date().toISOString(),
    searchRequestLogs: [],
    jobDetailRequestLogs: [],
    searchHtmlInfo: { primaryUrlStatus: 0, primaryCardCount: 0 },
    extractedJobs: [],
    jobDetails: [],
    summary: {
      totalSearchesMade: 0,
      totalJobCardsFound: 0,
      totalJobDetailsAttempted: 0,
      totalJobDetailsParsed: 0,
      blockEncountered: false,
      recommendation: '',
    },
  };

  let searchCount = 0;

  // 1. Fetch Primary Search URL (Step A)
  console.log(`\n--- Step A: Fetching Primary Search Page ---`);
  console.log(`URL: ${PRIMARY_SEARCH_URL}`);
  searchCount++;
  
  const searchRes1 = await fetchUrl(PRIMARY_SEARCH_URL);
  results.searchRequestLogs.push({
    url: PRIMARY_SEARCH_URL,
    status: searchRes1.status,
    responseSize: searchRes1.html.length,
    durationMs: searchRes1.durationMs,
    blocked: searchRes1.blocked,
    blockReason: searchRes1.blockReason,
  });

  const search1HtmlPath = path.join(RAW_DIR, 'search-1.html');
  fs.writeFileSync(search1HtmlPath, searchRes1.html, 'utf-8');
  console.log(`💾 Saved raw search HTML to: ${search1HtmlPath} (${searchRes1.html.length} bytes, HTTP ${searchRes1.status})`);

  if (searchRes1.blocked) {
    results.summary.blockEncountered = true;
    console.error(`❌ Block encountered on primary search page. Reason: ${searchRes1.blockReason}`);
  }

  // Parse job cards from search 1
  let jobsFound = parseJobCardsFromHtml(searchRes1.html, 'primary_search_url');
  results.searchHtmlInfo.primaryUrlStatus = searchRes1.status;
  results.searchHtmlInfo.primaryCardCount = jobsFound.length;
  results.searchHtmlInfo.cardSourceUsed = 'primary_search_url';

  console.log(`📊 Job cards found in primary search HTML: ${jobsFound.length}`);

  // 2. If primary HTML didn't return job cards and searchCount < MAX_SEARCH_REQUESTS, try Guest API endpoint (Step B)
  if (jobsFound.length === 0 && searchCount < MAX_SEARCH_REQUESTS && !results.summary.blockEncountered) {
    const delayMs = getRandomDelay();
    console.log(`\n⏳ Main search page contained 0 job cards. Waiting ${Math.round(delayMs / 1000)}s before investigating Guest API endpoint...`);
    await sleep(delayMs);

    console.log(`\n--- Step B: Fetching LinkedIn Guest API Search Endpoint ---`);
    console.log(`URL: ${GUEST_API_SEARCH_URL}`);
    searchCount++;

    const guestRes = await fetchUrl(GUEST_API_SEARCH_URL);
    results.searchRequestLogs.push({
      url: GUEST_API_SEARCH_URL,
      status: guestRes.status,
      responseSize: guestRes.html.length,
      durationMs: guestRes.durationMs,
      blocked: guestRes.blocked,
      blockReason: guestRes.blockReason,
    });

    const guestHtmlPath = path.join(RAW_DIR, 'search-guest-api.html');
    fs.writeFileSync(guestHtmlPath, guestRes.html, 'utf-8');
    console.log(`💾 Saved Guest API raw HTML to: ${guestHtmlPath} (${guestRes.html.length} bytes, HTTP ${guestRes.status})`);

    results.searchHtmlInfo.guestApiStatus = guestRes.status;
    if (guestRes.blocked) {
      results.summary.blockEncountered = true;
      console.error(`❌ Block encountered on guest API endpoint. Reason: ${guestRes.blockReason}`);
    } else {
      const guestJobs = parseJobCardsFromHtml(guestRes.html, 'guest_api_endpoint');
      results.searchHtmlInfo.guestApiCardCount = guestJobs.length;
      console.log(`📊 Job cards found in Guest API HTML: ${guestJobs.length}`);

      if (guestJobs.length > 0) {
        jobsFound = guestJobs;
        results.searchHtmlInfo.cardSourceUsed = 'guest_api_endpoint';
      }
    }
  }

  results.extractedJobs = jobsFound;
  results.summary.totalSearchesMade = searchCount;
  results.summary.totalJobCardsFound = jobsFound.length;

  // 3. Step C: Fetch Job Details for up to 10 jobs
  if (jobsFound.length > 0 && !results.summary.blockEncountered) {
    const jobsToFetch = jobsFound.slice(0, MAX_JOB_DETAIL_REQUESTS);
    console.log(`\n--- Step C: Fetching Details for ${jobsToFetch.length} Jobs ---`);

    for (let i = 0; i < jobsToFetch.length; i++) {
      const job = jobsToFetch[i];
      const delayMs = getRandomDelay();
      console.log(`\n[Job ${i + 1}/${jobsToFetch.length}] Waiting ${Math.round(delayMs / 1000)}s before fetching detail...`);
      await sleep(delayMs);

      // Attempt detail fetch using public guest API endpoint first (clean HTML), fallback to view URL
      const detailGuestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${job.jobId}`;
      console.log(`Fetching detail URL: ${detailGuestUrl}`);

      results.summary.totalJobDetailsAttempted++;
      const detailRes = await fetchUrl(detailGuestUrl);

      results.jobDetailRequestLogs.push({
        url: detailGuestUrl,
        status: detailRes.status,
        responseSize: detailRes.html.length,
        durationMs: detailRes.durationMs,
        blocked: detailRes.blocked,
        blockReason: detailRes.blockReason,
      });

      const detailRawPath = path.join(RAW_DIR, `job-${job.jobId}.html`);
      fs.writeFileSync(detailRawPath, detailRes.html, 'utf-8');

      if (detailRes.blocked) {
        results.summary.blockEncountered = true;
        console.error(`❌ Block encountered on job detail ${job.jobId}. Stopping further detail requests per spike rules.`);
        break;
      }

      const parsedDetail = parseJobDetailHtml(detailRes.html);
      results.jobDetails.push({
        jobId: job.jobId,
        title: parsedDetail.title || job.title,
        company: parsedDetail.company || job.company,
        location: parsedDetail.location || job.location,
        postedDate: parsedDetail.postedDate || job.postedTimeText,
        descriptionSnippet: parsedDetail.description.substring(0, 200).replace(/\s+/g, ' ') + '...',
        descriptionLength: parsedDetail.description.length,
        fullUrl: job.jobUrl,
        fetchedVia: detailGuestUrl,
        status: detailRes.status,
      });

      results.summary.totalJobDetailsParsed++;
      console.log(`✅ Job ${job.jobId} Parsed: "${parsedDetail.title || job.title}" @ "${parsedDetail.company || job.company}" (Desc length: ${parsedDetail.description.length} chars)`);
    }
  } else if (jobsFound.length === 0) {
    console.warn(`\n⚠️ No job cards could be extracted from search results.`);
  }

  // 4. Generate Final Recommendation
  if (results.summary.blockEncountered) {
    results.summary.recommendation =
      'UNRELIABLE WITHOUT ATHENTICATION: LinkedIn returned a block signal (HTTP 429/999/403 or authwall redirect) during logged-out HTTP requests. Direct HTTP scraping is not viable for long-term automated discovery.';
  } else if (results.summary.totalJobCardsFound > 0 && results.summary.totalJobDetailsParsed > 0) {
    results.summary.recommendation =
      `FEASIBLE AT LOW VOLUME: Successfully fetched and parsed ${results.summary.totalJobCardsFound} job cards and ${results.summary.totalJobDetailsParsed} full job descriptions logged-out via public guest endpoints without encountering block signals.`;
  } else {
    results.summary.recommendation =
      'INCONCLUSIVE / NO DATA: Public pages loaded with HTTP 200 but HTML layout did not match static server-rendered job selectors or returned empty content.';
  }

  // 5. Save Results JSON & Markdown Report
  const jsonPath = path.join(OUTPUT_DIR, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n💾 Saved detailed results JSON to: ${jsonPath}`);

  generateMarkdownReport(results);
}

function generateMarkdownReport(results: SpikeResults): void {
  const reportPath = path.join(OUTPUT_DIR, 'report.md');

  const reportContent = `# 🧪 LinkedIn Public Job Search Feasibility Spike Report

**Date**: ${results.runTimestamp}  
**Target Search**: SDET roles in Gurugram, India (\`f_TPR=r86400\` - Last 24 Hours)

---

## 📊 Summary of Results

| Metric | Result |
|---|---|
| **Total Search Requests** | ${results.summary.totalSearchesMade} |
| **Search Page Status Code** | ${results.searchHtmlInfo.primaryUrlStatus} |
| **Job Cards Extracted** | ${results.summary.totalJobCardsFound} |
| **Source Used** | ${results.searchHtmlInfo.cardSourceUsed || 'N/A'} |
| **Job Details Attempted** | ${results.summary.totalJobDetailsAttempted} |
| **Job Details Parsed** | ${results.summary.totalJobDetailsParsed} |
| **Block Signals Encountered** | ${results.summary.blockEncountered ? '⚠️ YES' : '✅ NONE'} |

---

## 💡 Finding & Recommendation

> **${results.summary.recommendation}**

---

## 🔍 Search Requests Log

${results.searchRequestLogs
  .map(
    (log, i) => `### Request ${i + 1}
- **URL**: \`${log.url}\`
- **Status Code**: \`${log.status}\`
- **Response Size**: \`${log.responseSize}\` bytes
- **Latency**: \`${log.durationMs}\` ms
- **Blocked**: \`${log.blocked ? 'YES (' + log.blockReason + ')' : 'NO'}\`
`
  )
  .join('\n')}

---

## 📄 Sample Extracted Jobs (${results.extractedJobs.length} Found)

${results.extractedJobs
  .slice(0, 5)
  .map(
    (j, i) => `${i + 1}. **${j.title}** @ **${j.company}**
   - **ID**: \`${j.jobId}\`
   - **Location**: ${j.location}
   - **Posted**: ${j.postedTimeText || 'Recent'}
   - **Link**: [${j.jobUrl}](${j.jobUrl})
`
  )
  .join('\n')}

---

## 📝 Sample Parsed Job Details (${results.jobDetails.length} Detailed)

${results.jobDetails
  .slice(0, 3)
  .map(
    (d, i) => `### ${i + 1}. ${d.title} @ ${d.company} (ID: ${d.jobId})
- **Location**: ${d.location}
- **Description Length**: ${d.descriptionLength} characters
- **Snippet**: *"${d.descriptionSnippet}"*
`
  )
  .join('\n')}
`;

  fs.writeFileSync(reportPath, reportContent, 'utf-8');
  console.log(`📄 Saved summary markdown report to: ${reportPath}`);
}

// Execute spike
runSpike().catch((err) => {
  console.error('Fatal error running spike:', err);
  process.exit(1);
});
