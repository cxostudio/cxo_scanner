"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Cog } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import { toast } from "react-toastify";
import emailjs from "@emailjs/browser";
import {
  DualViewportLoader,
  type InstantPreviewHint,
} from "../components/DualViewportLoader";
import { api, asset, START_URL } from "@/lib/base";
import { detectPageTypeFromUrl } from "@/lib/conversionCheckpoints/pageType";
import { QuadrantScanSequence } from "../components/QuadrantScanSequence";

interface Rule {
  id: string;
  title: string;
  description: string;
}

interface CheckpointPresentation {
  requiredActions?: string;
  justificationsBenefits: string;
  examples: Array<{ url: string; filename: string; thumbnailUrl: string }>;
}

interface ScanResult {
  ruleId: string;
  ruleTitle: string;
  passed: boolean;
  reason: string;
  checkpoint?: CheckpointPresentation;
}

interface BatchData {
  batchId: string;
  url: string;
  rules: Rule[];
  batchIndex: number;
  totalBatches: number;
  timestamp: number;
}

type NdComplete = {
  type: "complete";
  message?: string;
  quadrants?: string[];
  quadrantLabels?: string[];
  url?: string;
  previewDesktop?: string;
  previewMobile?: string;
  redirectWarning?: string;
};

/** sessionStorage often hits quota after lastScreenshot; fall back to localStorage for scan previews */
function persistScanPreview(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
    return;
  } catch {
    /* QuotaExceeded or private mode */
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
const LOADER_MESSAGES = [
  "Capturing page screenshots",
  "Scanning sections",
  "Almost ready",
] as const;

/** Favicon + host for instant loading UI before the first streamed screenshot (desktop first, then mobile). */
function instantPreviewFromWebsiteUrl(raw: string): InstantPreviewHint | null {
  try {
    const t = raw.trim();
    if (!t) return null;
    const abs = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(abs);
    const host = (u.hostname || "").replace(/^www\./, "") || u.hostname;
    if (!host) return null;
    return {
      host,
      faviconUrl: `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`,
    };
  } catch {
    return null;
  }
}

const EMAILJS_SERVICE_ID = "service_j08d36o";
const EMAILJS_TEMPLATE_ID = "template_fiqbjw9";
const EMAILJS_PUBLIC_KEY = "gnuaIRx_bs0IdMu7r";

const RuleSchema = z.object({
  id: z.string().min(1, "Rule ID is required"),
  title: z
    .string()
    .min(1, "Rule title is required")
    .max(200, "Rule title must be less than 200 characters"),
  description: z
    .string()
    .min(1, "Rule description is required")
    .max(5000, "Rule description must be less than 5000 characters"),
});

const URLSchema = z
  .string()
  .min(1, "URL is required")
  .max(2048, "URL is too long")
  .refine((url) => !/\s/.test(url), "URL must not contain spaces")
  .refine((url) => {
    try {
      const validUrl =
        url.startsWith("http://") || url.startsWith("https://")
          ? url
          : `https://${url}`;
      const parsed = new URL(validUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return false;
      const host = parsed.hostname.toLowerCase();
      if (!host || host.length < 4) return false;
      const hasDot = host.includes(".");
      const isLocalhost = host === "localhost" || host.startsWith("localhost.");
      if (!hasDot && !isLocalhost) return false;
      if (hasDot) {
        const parts = host.split(".");
        const tld = parts[parts.length - 1];
        if (!tld || tld.length < 2) return false;
      }
      return true;
    } catch {
      return false;
    }
  }, "Please enter a valid website URL (e.g. https://example.com or www.mystore.com)");

const EmailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email address");

export default function Home() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(
    null,
  );
  const [selectedRevenue, setSelectedRevenue] = useState<string | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [urlError, setUrlError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(
    null,
  );
  const [currentBatchNumber, setCurrentBatchNumber] = useState<number>(0);
  const [iframeError, setIframeError] = useState<boolean>(false);
  const [removedSteps, setRemovedSteps] = useState<Set<number>>(new Set());
  const [quadrants, setQuadrants] = useState<string[]>([]);
  const [quadrantLabels, setQuadrantLabels] = useState<string[]>([]);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [redirectWarning, setRedirectWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loaderMsgIndex, setLoaderMsgIndex] = useState(0);
  const [previewDesktop, setPreviewDesktop] = useState<string | null>(null);
  const [previewMobile, setPreviewMobile] = useState<string | null>(null);
  const [displayedMounted, setDisplayedMounted] = useState(0);
  const [displayProgressPercent, setDisplayProgressPercent] = useState(0);
  const displayProgressRafRef = useRef<number | null>(null);
  const displayProgressTsRef = useRef<number | null>(null);
  const displayedMountedRef = useRef(0);
  const removedStepsCountRef = useRef(0);
  const displayProgressPercentRef = useRef(0);

  const analyzeInstantPreview = useMemo(
    () =>
      showAnalyze && websiteUrl.trim()
        ? instantPreviewFromWebsiteUrl(websiteUrl)
        : null,
    [showAnalyze, websiteUrl],
  );

  /** Step removal timeouts must not be cleared when `mounted` advances (that was preventing rows from removing). */
  const analysisStepRemoveTimeoutsRef = useRef<number[]>([]);
  const analysisStepRemovalScheduledRef = useRef<Set<number>>(new Set());
  const analyzeTopRef = useRef<HTMLElement | null>(null);
  const totalSteps = 3;

  // Step 1 buttons data
  const step1Buttons = [
    { value: "Low Conversion Rates", label: "Low conversion rates" },
    { value: "Low Average Order Value", label: "Low average order value" },
    { value: "Both", label: "Both" },
  ];

  // Step 2 buttons data
  const step2Buttons = [
    { value: "Under €10,000 / month", label: "Under €10,000 / month" },
    { value: "€10,000–€50,000 / month", label: "€10,000–€50,000 / month" },
    { value: "€50,000–€100,000 / month", label: "€50,000–€100,000 / month" },
    { value: "Over €100,000 / month", label: "Over €100,000 / month" },
  ];

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  /** Shown during analyze; progress + row exits follow rule batch scanning (`progress`), not the X-Ray preview stream. */
  const analysisSteps = [
    "Crawling your product page structure",
    "Analyzing user experience and interface",
    "Analyzing content and copy effectiveness",
    "Generating conversion recommendations",
    "Finalizing your scan report",
  ] as const;
  const ANALYSIS_STEP_COUNT = analysisSteps.length;
  /** Virtual ticks per /api/scan batch so the bar & step rows keep moving during long requests (not stuck at 5/6). */
  const SCAN_PROGRESS_UNITS_PER_BATCH = 40;
  /**
   * After /api/scan/combine, advance `current` in small steps so % and mounted don’t jump 66→100 on one frame
   * (slow main thread / Vercel). Total tail slots = 1 + SCAN_PROGRESS_TAIL_TICKS.
   */
  const SCAN_PROGRESS_TAIL_TICKS = 3;
  const SCAN_PROGRESS_FINAL_TICK_MS = 260;
  /**
   * Use timestamp-based smoothing instead of timer chains so production/main-thread variance
   * (Vercel build, throttling, render batching) doesn't skip late-stage progress.
   */
  const PROGRESS_MAX_PERCENT_PER_SEC = 14;
  const PROGRESS_SNAP_EPSILON = 0.12;
  /** Ensure each row remains visible briefly before next step mounts. */
  const ANALYSIS_STEP_MIN_ADVANCE_MS = 380;

  /**
   * Progress uses display units: each batch spans SCAN_PROGRESS_UNITS_PER_BATCH ticks while /api/scan runs,
   * plus tail ticks after combine for a smooth finish.
   */
  const targetProgressPercent = useMemo(() => {
    if (!showAnalyze || !progress || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  }, [showAnalyze, progress]);

  /** Long enough to read "Finished" before the row exits; keep modest so scans still feel responsive. */
  const ANALYSIS_STEP_REMOVE_DELAY_MS = 650;
  /** Keep tiny pause so scanner route appears almost immediately. */
  const POST_SCAN_UI_BEFORE_REDIRECT_MS = 120;
  /** Cap UI-completion wait aggressively; this is UX-only and does not affect rule evaluation. */
  const ANALYSIS_UI_COMPLETION_MAX_WAIT_MS = 2_500;
  /** Keep a tiny stagger so users can see finish/remove sequence. */
  const ANALYSIS_STEP_REMOVE_STAGGER_MS = 170;

  const targetMounted = useMemo(() => {
    if (!showAnalyze) return 0;
    if (displayProgressPercent >= 100) return ANALYSIS_STEP_COUNT;
    return Math.min(
      ANALYSIS_STEP_COUNT - 1,
      Math.floor((displayProgressPercent / 100) * ANALYSIS_STEP_COUNT),
    );
  }, [showAnalyze, displayProgressPercent, ANALYSIS_STEP_COUNT]);

  const waitForAnalyzeUiCompletion = async () => {
    const started = performance.now();
    while (performance.now() - started < ANALYSIS_UI_COMPLETION_MAX_WAIT_MS) {
      const allMounted = displayedMountedRef.current >= ANALYSIS_STEP_COUNT;
      const progressReady = displayProgressPercentRef.current >= 99.5;
      if (allMounted && progressReady) return;
      await new Promise<void>((r) => window.setTimeout(r, 120));
    }
  };

  // Warm the /scanner route while the user sees the analyze UI so client navigation is faster after the scan.
  useEffect(() => {
    if (!showAnalyze) return;
    router.prefetch("/results");
  }, [showAnalyze, router]);

  // While analyze UI is hidden, reset step row removal state.
  useEffect(() => {
    displayedMountedRef.current = displayedMounted;
  }, [displayedMounted]);

  useEffect(() => {
    removedStepsCountRef.current = removedSteps.size;
  }, [removedSteps]);

  useEffect(() => {
    displayProgressPercentRef.current = displayProgressPercent;
  }, [displayProgressPercent]);

  useEffect(() => {
    if (!showAnalyze) {
      setRemovedSteps(new Set());
      setDisplayedMounted(0);
      setDisplayProgressPercent(0);
      displayedMountedRef.current = 0;
      removedStepsCountRef.current = 0;
      displayProgressPercentRef.current = 0;
      displayProgressTsRef.current = null;
      if (displayProgressRafRef.current != null) {
        window.cancelAnimationFrame(displayProgressRafRef.current);
        displayProgressRafRef.current = null;
      }
    }
  }, [showAnalyze]);

  // Timestamp-based progress interpolation keeps production and local behavior aligned.
  useEffect(() => {
    if (!showAnalyze) return;

    const animate = (ts: number) => {
      setDisplayProgressPercent((prev) => {
        const lastTs = displayProgressTsRef.current ?? ts;
        const dtSec = Math.max(0, (ts - lastTs) / 1000);
        displayProgressTsRef.current = ts;
        const maxDelta = PROGRESS_MAX_PERCENT_PER_SEC * dtSec;
        const remaining = targetProgressPercent - prev;

        if (Math.abs(remaining) <= PROGRESS_SNAP_EPSILON) {
          return targetProgressPercent;
        }
        if (remaining > 0) {
          return prev + Math.min(remaining, maxDelta);
        }
        return targetProgressPercent;
      });
      displayProgressRafRef.current = window.requestAnimationFrame(animate);
    };

    if (displayProgressRafRef.current == null) {
      displayProgressTsRef.current = null;
      displayProgressRafRef.current = window.requestAnimationFrame(animate);
    }

    return () => {
      if (displayProgressRafRef.current != null) {
        window.cancelAnimationFrame(displayProgressRafRef.current);
        displayProgressRafRef.current = null;
      }
      displayProgressTsRef.current = null;
    };
  }, [
    showAnalyze,
    targetProgressPercent,
    PROGRESS_MAX_PERCENT_PER_SEC,
    PROGRESS_SNAP_EPSILON,
  ]);

  // Step activation follows progress thresholds with a minimum dwell per row.
  useEffect(() => {
    if (!showAnalyze) return;
    if (displayedMounted >= targetMounted) return;
    const id = window.setTimeout(() => {
      setDisplayedMounted((prev) => {
        if (prev >= targetMounted) return prev;
        return prev + 1;
      });
    }, ANALYSIS_STEP_MIN_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [
    showAnalyze,
    displayedMounted,
    targetMounted,
    ANALYSIS_STEP_MIN_ADVANCE_MS,
  ]);

  // On mobile, ensure analyze screen starts from the CXO logo.
  useEffect(() => {
    if (!showAnalyze) return;
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return;

    const id = window.requestAnimationFrame(() => {
      const el = analyzeTopRef.current;
      if (!el) return;
      const top = window.scrollY + el.getBoundingClientRect().top - 18;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [showAnalyze]);

  // After each batch, show “Finished” briefly (ANALYSIS_STEP_REMOVE_DELAY_MS), then remove the row.
  useEffect(() => {
    if (!showAnalyze || displayedMounted <= 0) return;

    for (let k = 0; k < displayedMounted; k++) {
      if (analysisStepRemovalScheduledRef.current.has(k)) continue;
      analysisStepRemovalScheduledRef.current.add(k);

      const idx = k;
      const applyRemove = () => {
        setRemovedSteps((prev) => {
          if (prev.has(idx)) return prev;
          return new Set([...prev, idx]);
        });
      };
      if (ANALYSIS_STEP_REMOVE_DELAY_MS <= 0) {
        applyRemove();
      } else {
        const delay =
          ANALYSIS_STEP_REMOVE_DELAY_MS + idx * ANALYSIS_STEP_REMOVE_STAGGER_MS;
        const id = window.setTimeout(applyRemove, delay);
        analysisStepRemoveTimeoutsRef.current.push(id);
      }
    }
  }, [displayedMounted, showAnalyze]);

  const prepareBatches = (
    urlToScan: string,
    rulesToScan: Rule[],
  ): BatchData[] => {
    const batches: BatchData[] = [];
    const timestamp = Date.now();
    const totalRules = rulesToScan.length;

    if (totalRules === 0) {
      localStorage.setItem("scanBatches", JSON.stringify([]));
      localStorage.setItem("scanResults", JSON.stringify([]));
      return [];
    }

    // One /api/scan call = one Puppeteer session. Default: all rules in one batch (fastest).
    // On Vercel Hobby (60s function cap), set NEXT_PUBLIC_SCAN_BATCH_RULES=8 (or similar) to chunk.
    const configuredChunk = parseInt(
      process.env.NEXT_PUBLIC_SCAN_BATCH_RULES ?? "",
      10,
    );
    const chunkSize =
      Number.isFinite(configuredChunk) && configuredChunk > 0
        ? Math.min(configuredChunk, totalRules)
        : totalRules;

    const totalBatches = Math.ceil(totalRules / chunkSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * chunkSize;
      const batchRules = rulesToScan.slice(start, start + chunkSize);

      batches.push({
        batchId: `batch-${timestamp}-${batchIndex}`,
        url: urlToScan,
        rules: batchRules,
        batchIndex: batchIndex,
        totalBatches: totalBatches,
        timestamp: timestamp,
      });
    }

    localStorage.setItem("scanBatches", JSON.stringify(batches));
    localStorage.setItem("scanResults", JSON.stringify([]));

    return batches;
  };

  const BATCH_MAX_ATTEMPTS = 2; // initial run + one repeat if any error occurs

  const processBatches = async (
    batches: BatchData[],
    scanMeta: { email: string; scanId: string },
  ) => {
    const allResults: ScanResult[] = [];

    const progressTotalUnits = Math.max(
      1,
      batches.length * SCAN_PROGRESS_UNITS_PER_BATCH +
        1 +
        SCAN_PROGRESS_TAIL_TICKS,
    );
    const scanBaseCompleteUnits =
      batches.length * SCAN_PROGRESS_UNITS_PER_BATCH;

    const tickProgressAfterCombine = async () => {
      for (let s = 1; s <= SCAN_PROGRESS_TAIL_TICKS + 1; s++) {
        setProgress({
          current: scanBaseCompleteUnits + s,
          total: progressTotalUnits,
        });
        await new Promise((r) => setTimeout(r, SCAN_PROGRESS_FINAL_TICK_MS));
      }
    };

    setProgress({ current: 0, total: progressTotalUnits });

    const ScanResultsSchema = z.array(
      z.object({
        ruleId: z.string(),
        ruleTitle: z.string(),
        passed: z.boolean(),
        reason: z.string(),
        checkpoint: z
          .object({
            requiredActions: z.string(),
            justificationsBenefits: z.string(),
            examples: z.array(
              z.object({
                url: z.string(),
                filename: z.string(),
                thumbnailUrl: z.string(),
              }),
            ),
          })
          .passthrough()
          .optional(),
      }),
    );

    const parseApiErrorMessage = async (
      response: Response,
      fallback: string,
    ) => {
      let message = fallback;
      try {
        const errorData = await response.json();
        message = (errorData as { error?: string }).error || message;
      } catch {
        /* ignore JSON parse errors */
      }
      return message;
    };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const segmentStart = i * SCAN_PROGRESS_UNITS_PER_BATCH;
      const segmentPulseCap = segmentStart + SCAN_PROGRESS_UNITS_PER_BATCH - 1;
      setProgress({ current: segmentStart, total: progressTotalUnits });

      let batchSucceeded = false;
      let lastBatchError: unknown = null;

      for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
        const pulseMs = Math.min(
          6500,
          Math.max(
            700,
            Math.floor(
              (batch.rules.length * 3200) / SCAN_PROGRESS_UNITS_PER_BATCH,
            ),
          ),
        );
        let pulseId: number | null = null;
        try {
          pulseId = window.setInterval(() => {
            setProgress((prev) => {
              if (!prev) return prev;
              const next = Math.min(prev.current + 1, segmentPulseCap);
              return {
                current: Math.max(prev.current, next),
                total: prev.total,
              };
            });
          }, pulseMs);

          const response = await fetch(api("/scan"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: batch.url,
              rules: batch.rules,
              // Capture once for preview; doing this every batch increases timeout risk on Vercel.
              captureScreenshot: i === 0,
              email: scanMeta.email,
              scanId: scanMeta.scanId,
            }),
          });

          if (!response.ok) {
            const message = await parseApiErrorMessage(
              response,
              `Failed to scan batch ${i + 1}`,
            );
            throw new Error(message);
          }

          const data = await response.json();
          const batchResults = ScanResultsSchema.parse(data.results);

          // Remove duplicates before adding (check by ruleId)
          const existingRuleIds = new Set(allResults.map((r) => r.ruleId));
          const newResults = batchResults.filter((result) => {
            if (existingRuleIds.has(result.ruleId)) {
              console.warn(
                `Duplicate ruleId found: ${result.ruleId}, skipping duplicate`,
              );
              return false;
            }
            existingRuleIds.add(result.ruleId);
            return true;
          });

          allResults.push(...newResults);

          // Store screenshot from every batch to show what AI is seeing
          // Store in both state and sessionStorage for results page
          if (data.screenshot) {
            console.log(
              `Screenshot received from batch ${i + 1}, length: ${data.screenshot.length}`,
            );
            setWebsiteScreenshot(data.screenshot);
            setCurrentBatchNumber(i + 1);
            try {
              sessionStorage.setItem("lastScreenshot", data.screenshot);
              console.log(
                `Screenshot updated from batch ${i + 1} and stored in sessionStorage`,
              );
            } catch (e) {
              console.warn("Could not store screenshot in sessionStorage:", e);
            }
          } else {
            console.warn(
              `No screenshot received from batch ${i + 1}. This may be due to Vercel timeout.`,
            );
          }

          batchSucceeded = true;
          break;
        } catch (err) {
          lastBatchError = err;
          console.error(
            `Error processing batch ${i + 1} (attempt ${attempt}/${BATCH_MAX_ATTEMPTS}):`,
            err,
          );
          if (attempt < BATCH_MAX_ATTEMPTS) {
            console.warn(`Retrying batch ${i + 1} once after error...`);
            await new Promise((r) => setTimeout(r, 1500));
          }
        } finally {
          if (pulseId != null) {
            window.clearInterval(pulseId);
            pulseId = null;
          }
        }
      }

      if (!batchSucceeded) {
        console.error(
          `Batch ${i + 1} failed after ${BATCH_MAX_ATTEMPTS} attempts`,
        );
        // Fallback: split into single-rule scans so one heavy batch doesn't fail entirely.
        if (batch.rules.length > 1) {
          console.warn(`Attempting single-rule fallback for batch ${i + 1}...`);
          // 6 at a time: one by one, 42 checks took ~19 minutes; in parallel it stays ~2-3
          const FALLBACK_CONCURRENCY = 6;
          const queue = [...batch.rules];
          const checkOne = async (rule: (typeof batch.rules)[number]) => {
            let singleRuleSucceeded = false;
            let singleRuleError: unknown = null;
            for (
              let singleAttempt = 1;
              singleAttempt <= BATCH_MAX_ATTEMPTS;
              singleAttempt++
            ) {
              try {
                const singleRes = await fetch(api("/scan"), {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    url: batch.url,
                    rules: [rule],
                    captureScreenshot: false,
                    email: scanMeta.email,
                    scanId: scanMeta.scanId,
                  }),
                });
                if (!singleRes.ok) {
                  const msg = await parseApiErrorMessage(
                    singleRes,
                    `Failed single-rule scan for ${rule.id}`,
                  );
                  throw new Error(msg);
                }
                const singleData = await singleRes.json();
                const parsed = ScanResultsSchema.parse(singleData.results);
                const result = parsed[0];
                if (!result) {
                  throw new Error("No single-rule result returned");
                }
                if (!allResults.some((r) => r.ruleId === result.ruleId)) {
                  allResults.push(result);
                }
                singleRuleSucceeded = true;
                break;
              } catch (singleErr) {
                singleRuleError = singleErr;
                console.error(
                  `Single-rule fallback failed for ${rule.id} (attempt ${singleAttempt}/${BATCH_MAX_ATTEMPTS}):`,
                  singleErr,
                );
                if (singleAttempt < BATCH_MAX_ATTEMPTS) {
                  await new Promise((r) => setTimeout(r, 800));
                }
              }
            }
            if (!singleRuleSucceeded) {
              allResults.push({
                ruleId: rule.id,
                ruleTitle: rule.title,
                passed: false,
                reason: `Error processing rule ${rule.id} in fallback: ${singleRuleError instanceof Error ? singleRuleError.message : "Unknown error"}`,
              });
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(FALLBACK_CONCURRENCY, queue.length) }, async () => {
              while (queue.length) await checkOne(queue.shift()!);
            }),
          );
        } else {
          batch.rules.forEach((rule) => {
            allResults.push({
              ruleId: rule.id,
              ruleTitle: rule.title,
              passed: false,
              reason: `Error processing batch ${i + 1}: ${lastBatchError instanceof Error ? lastBatchError.message : "Unknown error"}`,
            });
          });
        }
      }

      const remainingBatches = batches.slice(i + 1);
      if (remainingBatches.length > 0) {
        localStorage.setItem("scanBatches", JSON.stringify(remainingBatches));
      } else {
        localStorage.removeItem("scanBatches");
      }

      localStorage.setItem("scanResults", JSON.stringify(allResults));

      setProgress({
        current: (i + 1) * SCAN_PROGRESS_UNITS_PER_BATCH,
        total: progressTotalUnits,
      });
    }

    try {
      const finalResponse = await fetch(api("/scan/combine"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          results: allResults,
        }),
      });

      if (finalResponse.ok) {
        const finalData = await finalResponse.json();
        const validatedResults = z
          .array(
            z.object({
              ruleId: z.string(),
              ruleTitle: z.string(),
              passed: z.boolean(),
              reason: z.string(),
              checkpoint: z
                .object({
                  requiredActions: z.string(),
                  justificationsBenefits: z.string(),
                  examples: z.array(
                    z.object({
                      url: z.string(),
                      filename: z.string(),
                      thumbnailUrl: z.string(),
                    }),
                  ),
                })
                .passthrough()
                .optional(),
            }),
          )
          .parse(finalData.results);

        localStorage.setItem("scanResults", JSON.stringify(validatedResults));
        localStorage.setItem("scanUrl", batches[0]?.url || websiteUrl);
        if (websiteScreenshot) {
          try {
            sessionStorage.setItem("lastScreenshot", websiteScreenshot);
          } catch (e) {
            console.warn("Could not store screenshot in sessionStorage:", e);
          }
        }
        localStorage.removeItem("scanBatches");
      } else {
        localStorage.setItem("scanResults", JSON.stringify(allResults));
        localStorage.setItem("scanUrl", batches[0]?.url || websiteUrl);
        localStorage.removeItem("scanBatches");
      }
      await tickProgressAfterCombine();
    } catch (finalErr) {
      console.error("Final request error:", finalErr);
      localStorage.setItem("scanResults", JSON.stringify(allResults));
      localStorage.setItem("scanUrl", batches[0]?.url || websiteUrl);
      localStorage.removeItem("scanBatches");
      await tickProgressAfterCombine();
    }

    // Don't set progress to null here (would reset the batch progress bar and step UI)
    // Toast + redirect happen in handleStartScan right after this returns
  };

  /**
   * POST /api/preview_website — NDJSON desktop/mobile preview + quadrants.
   * `onReadyForRuleScan` fires once when a usable preview exists (or on error / stream end) so rule-scan
   * progress stays aligned with the left preview on slow networks (e.g. Vercel).
   */
  const startWebsitePreviewStream = async (
    captureUrl: string,
    gateHooks?: { onReadyForRuleScan?: () => void },
  ) => {
    const trimmed = captureUrl.trim();
    if (!trimmed) {
      setError("Please enter a URL.");
      return;
    }
    const urlParam = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    setIsLoading(true);
    setError(null);
    setQuadrants([]);
    setQuadrantLabels([]);
    setAnalyzedUrl(null);
    setRedirectWarning(null);
    setLoaderMsgIndex(0);
    setPreviewDesktop(null);
    setPreviewMobile(null);

    let gateReleased = false;
    const releaseRuleScanGate = () => {
      if (gateReleased) return;
      gateReleased = true;
      gateHooks?.onReadyForRuleScan?.();
    };

    const previewLooksReady = (s: unknown) =>
      typeof s === "string" && s.length > 80;

    try {
      const response = await fetch(api("/preview_website"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: urlParam }),
      });
      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        throw new Error(
          errJson.details || errJson.error || `HTTP ${response.status}`,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body.");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      const streamState = { complete: null as NdComplete | null, blocked: false };
      const handleNdjsonLine = (line: string) => {
        if (!line.trim()) return;
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg.type === "meta") return;
        if (msg.type === "preview") {
          if (msg.blocked === true && !streamState.blocked) {
            streamState.blocked = true;
            // Persist so the /scanner results page can show the static placeholder.
            try { sessionStorage.setItem("previewUnavailable", "1"); } catch {}
            // Preview is blocked — release the gate so the rule scan still proceeds.
            releaseRuleScanGate();
          }
          // When the capture is blocked (bot-wall / rate-limit / error / empty page),
          // ignore the screenshot frames so the UI stays on the logo loading screen
          // instead of replacing it with the block/white page.
          if (streamState.blocked) return;
          if (typeof msg.previewDesktop === "string") {
            setPreviewDesktop(msg.previewDesktop);
            persistScanPreview("scanPreviewDesktop", msg.previewDesktop);
            if (previewLooksReady(msg.previewDesktop)) releaseRuleScanGate();
          }
          if (typeof msg.preview === "string" && !msg.previewDesktop) {
            setPreviewDesktop(msg.preview);
            persistScanPreview("scanPreviewDesktop", msg.preview);
            if (previewLooksReady(msg.preview)) releaseRuleScanGate();
          }
          if (typeof msg.previewMobile === "string") {
            setPreviewMobile(msg.previewMobile);
            persistScanPreview("scanPreviewMobile", msg.previewMobile);
            if (previewLooksReady(msg.previewMobile)) releaseRuleScanGate();
          }
        }
        if (msg.type === "error") {
          throw new Error(
            typeof msg.details === "string"
              ? msg.details
              : typeof msg.error === "string"
                ? msg.error
                : "Capture failed",
          );
        }
        if (msg.type === "complete") {
          streamState.complete = msg as NdComplete;
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleNdjsonLine(line);
        }
        if (done) {
          if (buffer.trim()) {
            handleNdjsonLine(buffer);
          }
          break;
        }
      }
      const gotComplete = streamState.complete;
      // When blocked, don't set/persist the block screenshots — the /scanner page
      // shows the static placeholder via the previewUnavailable flag instead.
      if (!streamState.blocked) {
        if (
          typeof gotComplete?.previewDesktop === "string" &&
          gotComplete.previewDesktop.length > 0
        ) {
          setPreviewDesktop(gotComplete.previewDesktop);
          persistScanPreview("scanPreviewDesktop", gotComplete.previewDesktop);
          if (previewLooksReady(gotComplete.previewDesktop))
            releaseRuleScanGate();
        }
        if (typeof gotComplete?.previewMobile === "string") {
          setPreviewMobile(gotComplete.previewMobile);
          persistScanPreview("scanPreviewMobile", gotComplete.previewMobile);
          if (previewLooksReady(gotComplete.previewMobile)) releaseRuleScanGate();
        }
      }
      if (gotComplete?.quadrants != null && gotComplete.quadrants.length > 0) {
        setQuadrants(gotComplete.quadrants);
        setQuadrantLabels(gotComplete.quadrantLabels ?? []);
        setAnalyzedUrl(gotComplete.url ?? urlParam);
        setRedirectWarning(gotComplete.redirectWarning ?? null);
      } else {
        setError("No capture data returned.");
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
      console.error("Website preview stream error:", err);
      releaseRuleScanGate();
    } finally {
      setIsLoading(false);
      releaseRuleScanGate();
    }
  };

  // Arriving from the cxo.studio onboarding (/start): the questions were already
  // answered there, so prefill URL, email and revenue, jump to the last step and
  // start the scan right away when `start=1`.
  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const u = q.get("url");
    const e = q.get("email");
    // no answers: the questions live on cxo.studio/start
    if (!u || !e) {
      const fr = q.get("locale") === "fr" || navigator.language?.startsWith("fr");
      window.location.replace(fr ? START_URL.replace("/start", "/fr/start") : START_URL);
      return;
    }
    setWebsiteUrl(u);
    setEmail(e);
    setSelectedChallenge(q.get("challenge") || "Both");
    const rev = q.get("revenue");
    if (rev) setSelectedRevenue(rev);
    // order value + conversion rate let the results page estimate visitors and revenue per visitor
    try {
      localStorage.setItem("scanAov", q.get("aov") || "");
      localStorage.setItem("scanCr", q.get("cr") || "");
      localStorage.setItem("scanLocale", q.get("locale") || "en");
    } catch {}
    setCurrentStep(3);
    setAutoStart(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => {
    if (autoStart && websiteUrl && email) {
      setAutoStart(false);
      handleStartScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, websiteUrl, email]);

  const handleStartScan = async () => {
    // the results page picks its next step from the revenue band (components/NextStep)
    try { localStorage.setItem("scanRevenue", selectedRevenue ?? ""); } catch {}
    setUrlError("");
    setEmailError("");

    const urlTrimmed = websiteUrl.trim();
    const emailTrimmed = email.trim();

    // ✅ Basic validation
    if (!urlTrimmed) return setUrlError("Website URL is required");
    if (!emailTrimmed) return setEmailError("Email address is required");

    const urlResult = URLSchema.safeParse(urlTrimmed);
    if (!urlResult.success) {
      return setUrlError(urlResult.error.errors[0]?.message || "Invalid URL");
    }

    const emailResult = EmailSchema.safeParse(emailTrimmed);
    if (!emailResult.success) {
      return setEmailError(
        emailResult.error.errors[0]?.message || "Invalid email",
      );
    }

    // One id per scan; shared by every /api/scan request (batches, retries,
    // fallback) so the daily limit counts a scan once, not per request.
    const scanId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Daily per-email scan-limit gate. If blocked, stop before any scanning
    // (no AI spend). Fails open if the check itself errors.
    try {
      const limitRes = await fetch(api("/scan/limit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTrimmed, scanId }),
      });
      if (limitRes.status === 429) {
        const info = (await limitRes.json().catch(() => ({}))) as {
          error?: string;
        };
        return setEmailError(
          info.error ||
            "You've reached today's scan limit. Please try again tomorrow.",
        );
      }
    } catch (limitErr) {
      console.warn("Scan limit check failed, allowing scan:", limitErr);
    }

    try {
      setIsStartingScan(true);

      // ✅ Normalize URL (used for server-filtered checkpoints + scan)
      let validUrl = urlResult.data!;
      if (!/^https?:\/\//i.test(validUrl)) {
        validUrl = `https://${validUrl}`;
      }

      // ✅ Rules depend only on page type — request by `pageType` so all domains' homepages
      //    (product / category / other) share ONE 3-day browser cache entry, not one per URL.
      const pageTypeKey = detectPageTypeFromUrl(validUrl);
      const cpRes = await fetch(
        api(`/conversion-checkpoints?pageType=${encodeURIComponent(pageTypeKey)}`),
      );
      const cpRaw = await cpRes.text();
      if (!cpRes.ok) {
        let detail = "";
        try {
          const errJson = JSON.parse(cpRaw) as {
            error?: string;
            errors?: Array<{ message?: string; error?: string }>;
          };
          const first = errJson.errors?.[0];
          detail =
            (typeof errJson.error === "string" && errJson.error) ||
            (typeof first?.message === "string" && first.message) ||
            (typeof first?.error === "string" && first.error) ||
            "";
        } catch {
          detail = cpRaw.slice(0, 120);
        }
        throw new Error(
          detail
            ? `Failed to load conversion checkpoints: ${detail}`
            : "Failed to load conversion checkpoints",
        );
      }
      const cpData = JSON.parse(cpRaw) as {
        rules?: unknown;
        records?: unknown;
        detectedPageType?: string;
        requiredPageTypeIds?: string[];
        filteredRulesCount?: number;
        filterUsedFallback?: boolean;
      };
      console.log("[conversion-checkpoints] for scan (server-filtered):", {
        url: validUrl,
        detectedPageType: cpData.detectedPageType,
        requiredPageTypeIds: cpData.requiredPageTypeIds,
        filteredRulesCount: cpData.filteredRulesCount,
        filterUsedFallback: cpData.filterUsedFallback,
        fullPayload: cpData,
      });

      const rulesToUse = z.array(RuleSchema).parse(cpData.rules ?? []);
      setRules(rulesToUse);

      if (!rulesToUse.length) {
        throw new Error("No rules available for this URL");
      }

      // ✅ Browser info
      const browser = navigator.userAgent;
      const screenSize = `${window.screen.width}x${window.screen.height}`;
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";

      const browserData = [
        `ua=${browser}`,
        `platform=${navigator.platform}`,
        `language=${navigator.language}`,
        `screen=${screenSize}`,
        `timezone=${timeZone}`,
      ].join(" | ");

      // ✅ Get IP (safe)
      let ipAddress = "Unknown";
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        if (res.ok) {
          const data = await res.json();
          ipAddress = data?.ip || "Unknown";
        }
      } catch {
        console.warn("IP fetch failed");
      }

      // ✅ UI setup
      setShowAnalyze(true);
      setProgress(null);
      setWebsiteScreenshot(null);
      setCurrentBatchNumber(0);
      setIframeError(false);
      setRemovedSteps(new Set());
      setDisplayedMounted(0);
      try {
        sessionStorage.removeItem("scanPreviewMobile");
        sessionStorage.removeItem("scanPreviewDesktop");
        sessionStorage.removeItem("previewUnavailable");
      } catch {
        /* ignore */
      }
      try {
        localStorage.removeItem("scanPreviewMobile");
        localStorage.removeItem("scanPreviewDesktop");
      } catch {
        /* ignore */
      }
      analysisStepRemoveTimeoutsRef.current.forEach((tid) =>
        window.clearTimeout(tid),
      );
      analysisStepRemoveTimeoutsRef.current = [];
      analysisStepRemovalScheduledRef.current = new Set();

      // One frame so the analyze panel paints before heavy work (avoid extra 200ms delay )
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      let resolvePreviewGate!: () => void;
      const previewReadyPromise = new Promise<void>((r) => {
        resolvePreviewGate = r;
      });
      let previewGateSettled = false;
      let previewGateTimeoutId = 0;
      const settlePreviewGate = () => {
        if (previewGateSettled) return;
        previewGateSettled = true;
        if (previewGateTimeoutId !== 0)
          window.clearTimeout(previewGateTimeoutId);
        resolvePreviewGate();
      };
      previewGateTimeoutId = window.setTimeout(settlePreviewGate, 35_000);

      const streamPromise = startWebsitePreviewStream(validUrl, {
        onReadyForRuleScan: settlePreviewGate,
      });
      void streamPromise.catch((e) => console.error("Preview stream:", e));

      // Website screenshot is no longer captured separately here. /api/scan already
      // returns a screenshot (handled in processBatches) that populates the same
      // setWebsiteScreenshot state + sessionStorage 'lastScreenshot'. Dropping the
      // extra /api/screenshot call removes one redundant full-page Puppeteer capture
      // per scan; the results page prefers the preview image anyway and falls back to
      // this same 'lastScreenshot' value.

      // Main scan: POST /api/scan per batch, then /api/scan/combine. Fires
      // immediately — in parallel with the preview stream and screenshot capture
      // above — instead of waiting for the website preview to be ready first.
      const batches = prepareBatches(validUrl, rulesToUse);
      await processBatches(batches, { email: emailTrimmed, scanId });

      // The preview capture ran alongside the scan; make sure its gate has settled
      // (bounded by the 35s timeout) before finishing the analyze UI and redirecting.
      await previewReadyPromise;
      await waitForAnalyzeUiCompletion();

      await new Promise<void>((r) =>
        window.setTimeout(r, POST_SCAN_UI_BEFORE_REDIRECT_MS),
      );
      router.replace("/results");

      setTimeout(() => {
        let passResult: string | number = "N/A";
        let failResult: string | number = "N/A";

        try {
          const stored = localStorage.getItem("scanResults");
          if (stored) {
            const parsed = z
              .array(
                z
                  .object({
                    ruleId: z.string(),
                    ruleTitle: z.string(),
                    passed: z.boolean(),
                    reason: z.string(),
                  })
                  .passthrough(),
              )
              .parse(JSON.parse(stored));

            const pass = parsed.filter((r) => r.passed).length;
            passResult = `${pass}/${parsed.length}`;
            failResult = `${parsed.length - pass}/${parsed.length}`;
          }
        } catch {
          console.warn("Summary parsing failed");
        }

        emailjs
          .send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            {
              level: selectedChallenge ?? "",
              price: selectedRevenue ?? "",
              url: validUrl,
              email: emailTrimmed,
              ip_address: ipAddress,
              browser,
              screen_size: screenSize,
              time_zone: timeZone,
              browser_data: browserData,
              pass_result: passResult,
              fail_result: failResult,
            },
            { publicKey: EMAILJS_PUBLIC_KEY },
          )
          .catch((err) => console.error("EmailJS failed:", err));

      }, 0);
    } catch (err) {
      console.error(err);
      // back to the card with "Try again" instead of a dead loader
      setUrlError(err instanceof Error && err.message ? err.message : "Something went wrong during the scan.");
      setShowAnalyze(false);
    } finally {
      // Only reset button loading. Do NOT setShowAnalyze(false) here on success —
      // router.replace is async; flipping showAnalyze would flash the form before /scanner mounts.
      setIsStartingScan(false);
    }
  };

  const progressPercentage = (currentStep / totalSteps) * 100;

  // Check if current step has required value
  const isStepValid = () => {
    if (currentStep === 1) {
      return selectedChallenge !== null;
    }
    if (currentStep === 2) {
      return selectedRevenue !== null;
    }
    if (currentStep === 3) {
      return websiteUrl.trim() !== "" && email.trim() !== "";
    }
    return false;
  };

  const handleAccessResultsEnter = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key !== "Enter") return;
    if (currentStep !== totalSteps) return;
    e.preventDefault();
    if (isStartingScan) return;
    void handleStartScan();
  };

  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => {
      setLoaderMsgIndex((i) => (i + 1) % LOADER_MESSAGES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const host = instantPreviewFromWebsiteUrl(websiteUrl)?.host ?? "";
  // the label never runs ahead of the bar: both read the same clamped value, the label rounds down
  const barPct = Math.min(100, Math.max(0, displayProgressPercent));
  const pct = Math.floor(barPct);
  const blocking = urlError || emailError;

  return (
    <main className="cxo-page" ref={analyzeTopRef}>
      <a className="cxo-logo" href="https://cxo.studio" aria-label="CXO studio">
        <img src={asset("/cxo-logo.png")} alt="CXO studio" />
      </a>

      <div className="cxo-head">
        <h1 className="cxo-reveal">
          {blocking ? "We couldn’t start your scan" : showAnalyze ? "Scanning your product page" : "Preparing your scan"}
        </h1>
        <p className="cxo-reveal cxo-reveal-1">
          {blocking
            ? "Check the details below, then try again."
            : <>{host && <strong className="font-semibold text-[var(--text)]">{host}</strong>}{host && " · "}About a minute. Keep this tab open.</>}
        </p>
      </div>

      {!showAnalyze ? (
        <div className="cxo-card cxo-reveal cxo-reveal-2 mx-auto max-w-[720px]">
          {blocking ? (
            <>
              <p className="cxo-q">{urlError || emailError}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a className="cxo-btn cxo-btn-primary sm:flex-1" href={START_URL}>Change my answers<Chevron /></a>
                {!emailError.toLowerCase().includes("limit") && (
                  <button type="button" className="cxo-btn cxo-btn-ghost sm:flex-1" onClick={() => void handleStartScan()}>Try again</button>
                )}
              </div>
            </>
          ) : (
            <div className="cxo-rows">
              <div className="cxo-row is-active">
                <span className="cxo-icon"><Spinner /></span>
                <span className="cxo-row-text">
                  <span className="cxo-row-label">Loading the checkpoints for your page</span>
                  <span className="cxo-row-hint">{host || "Your product page"}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mx-auto grid w-full min-w-0 max-w-[1180px] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* live preview of the page being scanned; on phones it comes first, with a compact
              progress line on top so the visitor still sees the scan moving */}
          <section className="cxo-reveal cxo-reveal-2 min-w-0" aria-label="Live preview">
            <div className="mb-5 flex items-center gap-3 lg:hidden" aria-hidden="true">
              <Spinner />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">
                {STEP_LABELS[Math.min(displayedMounted, STEP_LABELS.length - 1)]}
              </span>
              <span className="text-sm font-semibold tabular-nums text-[var(--text)]">{pct}%</span>
            </div>
            <div className="cxo-progress mb-6 lg:hidden" aria-hidden="true"><span style={{ width: `${barPct}%`, transition: 'none' }} /></div>
            {error && (
              <div className="mb-4 rounded-[var(--radius-md)] bg-[var(--status-critical-bg)] px-3 py-2 text-sm text-[var(--status-critical-fg)]">{error}</div>
            )}
            {(quadrants.length === 0 || !previewDesktop) && (
              <DualViewportLoader
                align="start"
                previewDesktop={previewDesktop}
                previewMobile={previewDesktop ? previewMobile : null}
                instantPreview={analyzeInstantPreview}
                scanning
                statusText={`${LOADER_MESSAGES[loaderMsgIndex]}…`}
              />
            )}
            {quadrants.length > 0 && previewDesktop && (
              <div className="w-full min-w-0">
                <div className="mb-6">
                  <DualViewportLoader align="start" previewDesktop={previewDesktop} previewMobile={previewMobile} scanning={false} />
                </div>
                {redirectWarning && (
                  <div className="mb-4 rounded-[var(--radius-md)] bg-[var(--status-finding-bg)] p-3 text-sm text-[var(--status-finding-fg)]">{redirectWarning}</div>
                )}
                <QuadrantScanSequence quadrants={quadrants} quadrantLabels={quadrantLabels} previewDesktop={previewDesktop} previewMobile={previewMobile} />
              </div>
            )}
          </section>

          {/* progress: the same bar and rows as the questions on /start */}
          <aside className="cxo-card cxo-reveal cxo-reveal-1 min-w-0 lg:sticky lg:top-6" aria-label="Scan progress">
            <div className="mb-[var(--space-6)] flex items-center gap-[14px]">
              <div className="cxo-progress flex-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${barPct}%`, transition: 'none' }} />
              </div>
              <span className="w-10 text-right text-sm font-semibold tabular-nums text-[var(--text)]">{pct}%</span>
            </div>
            <p className="cxo-q">What we’re checking</p>
            <div className="cxo-rows">
              {analysisSteps.map((title, index) => {
                const done = index < displayedMounted;
                const active = index === displayedMounted;
                return (
                  <div key={title} className={`cxo-row ${active ? "is-active" : ""} ${!done && !active ? "is-pending" : ""}`}>
                    <span className="cxo-icon">{STEP_ICONS[index]}</span>
                    <span className="cxo-row-text"><span className="cxo-row-label text-[15px]">{STEP_LABELS[index] ?? title}</span></span>
                    <span className="grid h-6 w-6 shrink-0 place-items-center">
                      {done ? <span className="cxo-ok"><CheckMark /></span> : active ? <Spinner /> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

// ── small inline icons, same stroke style as the answers on /start ──
const Line = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);
const STEP_LABELS = [
  "Opening your page on desktop and mobile",
  "Reading prices, buttons and reviews",
  "Checking the conversion checkpoints",
  "Ranking what to fix first",
  "Writing your report",
];
const STEP_ICONS = [
  <Line key="0" d='<rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M6 18h6M9 14v4"/><rect x="17" y="8" width="5" height="12" rx="1.2"/>' />,
  <Line key="1" d='<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5M8 10.5h5M10.5 8v5"/>' />,
  <Line key="2" d='<path d="m4 6.5 1.5 1.5L8.5 5M4 12.5 5.5 14 8.5 11M4 18.5 5.5 20l3-3"/><path d="M12 7h8M12 13h8M12 19h8"/>' />,
  <Line key="3" d='<path d="M4 6h10M4 12h7M4 18h4"/><path d="m17 8 3-3 3 3M20 5v14"/>' />,
  <Line key="4" d='<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>' />,
];
function Spinner() {
  return (
    <svg className="cxo-spin text-[var(--text)]" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
  );
}
function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
  );
}
