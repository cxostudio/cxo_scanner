// src/app/api/analyze_image/route.tsx – OpenRouter (Gemini via OpenRouter)
import { NextResponse, NextRequest } from 'next/server';
import { analyzeWebsiteStream } from '@/lib/analyzeWebsiteStream';
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer';
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// --- Configuration: OpenRouter (Gemini via OpenRouter) ---
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY ?? process.env.GEMINI_API_KEY ?? '').trim();
const rawModel = (process.env.OPENROUTER_MODEL ?? process.env.GEMINI_MODEL ?? 'google/gemini-2.5-flash-lite').trim();
const OPENROUTER_MODEL = rawModel.startsWith('google/') ? rawModel : `google/${rawModel}`;
const OPENROUTER_REFERER = (process.env.OPENROUTER_REFERER ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://github.com')).trim();
const OPENROUTER_TITLE = (process.env.OPENROUTER_TITLE ?? 'Image Reading').trim();
if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY or GEMINI_API_KEY is not set in environment variables.");
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// --- Interfaces for Request/Response and Data ---

interface ApiRequestBody {
    url: string;
}

/** POST body: `url` or `websiteUrl`, optional `stream` for NDJSON preview capture via AnalyzeWebsite. */
interface AnalyzeImagePostBody {
    url?: string;
    websiteUrl?: string;
    stream?: boolean;
}

interface PredefineRule {
    id: string;
    title: string;
    description: string;
}

interface RuleResult {
    id: string;
    title: string;
    status: 'pass' | 'fail';
    reason?: string;
}

interface ApiResponse {
    message?: string;
    screenshot?: string;
    analysis?: string;
    url?: string;
    redirectWarning?: string;
    ruleResults?: RuleResult[];
    overall?: 'pass' | 'fail'; // pass = sab rules meet, fail = koi bhi fail
    error?: string;
    details?: string;
}


async function loadPredefineRulesFromCheckpoints(): Promise<PredefineRule[]> {
    const result = await getConversionCheckpointRules();
    if (!result.ok) {
        console.warn('[analyze_image] conversion-checkpoints failed:', result.body);
        return [];
    }
    console.log('[analyze_image] conversion-checkpoints rules:', result.rules.length);
    return result.rules.map((r) => ({ id: r.id, title: r.title, description: r.description }));
}

async function analyzeScreenshotWithRules(
    screenshotDataUrl: string,
    pageUrl: string,
    rules: PredefineRule[]
): Promise<{ analysis: string; ruleResults: RuleResult[] }> {
    const rulesText = rules.length === 0
        ? '(No rules provided.)'
        : rules.map((r, i) => `${i + 1}. [${r.id}] ${r.title}\n   ${r.description}`).join('\n\n');

    const prompt = `You are evaluating a webpage screenshot against a list of rules.

1) First, briefly describe what you see on the page: layout, main sections, key elements (2-3 short paragraphs).

2) Then, for EACH rule below, decide if the page MEETS the rule (PASS) or NOT (FAIL), based ONLY on what is visible in the screenshot. Consider it a product/page screenshot.

RULES TO CHECK:
${rulesText}

Respond with valid JSON only, no other text. Use this exact structure:
{"analysis":"Your description here","ruleResults":[{"id":"rule-id","title":"Rule title","status":"pass" or "fail","reason":"one line reason"}, ...]}
- "analysis": your brief page description (string).
- "ruleResults": array with one object per rule, in the SAME ORDER as the rules above. Each object must have: "id" (rule id), "title" (rule title), "status" ("pass" or "fail"), "reason" (one line).`;

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': OPENROUTER_REFERER,
            'X-OpenRouter-Title': OPENROUTER_TITLE,
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: screenshotDataUrl } },
                    ],
                },
            ],
        }),
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${errText}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text == null) throw new Error('OpenRouter returned no content');

    try {
        const jsonStr = text.replace(/```json\s*|\s*```/g, '').trim();
        const parsed = JSON.parse(jsonStr) as { analysis?: string; ruleResults?: RuleResult[] };
        const analysis = typeof parsed.analysis === 'string' ? parsed.analysis : text;
        const ruleResults = Array.isArray(parsed.ruleResults) ? parsed.ruleResults : [];
        return { analysis, ruleResults };
    } catch {
        return { analysis: text, ruleResults: [] };
    }
}

// --- API Route Handler ---
export async function POST(request: NextRequest): Promise<Response> {
    let parsed: AnalyzeImagePostBody;
    try {
        parsed = (await request.json()) as AnalyzeImagePostBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const raw = (parsed.url ?? parsed.websiteUrl ?? '').trim();
    if (!raw) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    if (parsed.stream === true) {
        const streamReq = new NextRequest(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url } satisfies ApiRequestBody),
        });
        return analyzeWebsiteStream(streamReq);
    }

    let browser: Awaited<ReturnType<typeof launchPuppeteerBrowser>> | null = null;
    try {
        browser = await launchPuppeteerBrowser({ windowSizeArg: '--window-size=1280,800' });
        const page = await browser.newPage();

        // Stealth: bot detection kam karne ke liye (puppeteer-extra Next.js me 500 de raha tha)
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
        });

        await page.setDefaultNavigationTimeout(35000);
        await page.setDefaultTimeout(40000);
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-GB,en;q=0.9',
        });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        try {
            await page.goto(url, { waitUntil: 'load', timeout: 35000 });
        } catch (navErr: unknown) {
            const isTimeout = String(navErr).includes('timeout') || (navErr as Error)?.message?.includes('timeout');
            if (isTimeout) {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                } catch {
                    throw navErr;
                }
            } else {
                throw navErr;
            }
        }

        await new Promise(r => setTimeout(r, 3000));

        const finalUrl = page.url();
        let wasRedirected = false;
        try {
            const requestedHost = new URL(url).hostname.replace(/^www\./, '');
            const finalHost = new URL(finalUrl).hostname.replace(/^www\./, '');
            wasRedirected = requestedHost !== finalHost;
        } catch {
            // ignore
        }

        const screenshotBase64 = await page.screenshot({
            fullPage: true,
            encoding: 'base64',
            type: 'png',
        }) as string;

        await browser.close();
        browser = null;

        const screenshotDataUrl = `data:image/png;base64,${screenshotBase64}`;

        const rules = await loadPredefineRulesFromCheckpoints();
        const { analysis, ruleResults } = await analyzeScreenshotWithRules(screenshotDataUrl, url, rules);
        const overall = rules.length > 0
            ? (ruleResults.every(r => r.status === 'pass') ? 'pass' : 'fail')
            : undefined;

        return NextResponse.json({
            message: 'Screenshot analysis complete',
            screenshot: screenshotDataUrl,
            analysis,
            url: finalUrl,
            ruleResults,
            overall,
            redirectWarning: wasRedirected
                ? `Site aapke requested URL par nahi, redirect ho kar "${finalUrl}" par chali gayi (geo-block ya login ho sakta hai). Screenshot usi page ka hai. VPN/proxy use karte waqt app ko bhi usi network par chalaayein: .env me PUPPETEER_PROXY set karein ya VPN on karke local par npm run dev chalaayein.`
                : undefined,
        });

    } catch (error: any) {
        console.error('Error in API route:', error);
        if (!browser && error?.message?.includes('Could not find Chrome')) {
            console.error('Chromium binary not found. On Vercel this route must use @sparticuz/chromium via launchPuppeteerBrowser.');
        }
        return NextResponse.json({
            error: 'Failed to analyze images',
            details: error?.message ?? 'An unknown error occurred',
        }, { status: 500 });
    } finally {
        // Ensure the browser is closed to free up resources
        if (browser) {
            await browser.close();
        }
    }
}
