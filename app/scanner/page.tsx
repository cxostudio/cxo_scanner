'use client'

import { useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import { motion } from 'framer-motion'
import { X, ChevronDown, ArrowUp } from 'lucide-react'
import { z } from 'zod'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import type { CheckpointPresentation } from '../components/CheckpointResultBody'

const barEase = [0.4, 0, 0.2, 1] as const
const previewEase = [0.4, 0, 0.2, 1] as const

/** Tailwind `sm` = 640px — no motion / CSS transitions on results UI below this width. */
const MOBILE_MAX_WIDTH_QUERY = '(max-width: 639px)'

function subscribeMobileLayout(callback: () => void) {
  const mq = window.matchMedia(MOBILE_MAX_WIDTH_QUERY)
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function getMobileLayoutSnapshot() {
  return window.matchMedia(MOBILE_MAX_WIDTH_QUERY).matches
}

function useIsMobileLayoutNoTransitions() {
  return useSyncExternalStore(subscribeMobileLayout, getMobileLayoutSnapshot, () => false)
}

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  checkpoint?: CheckpointPresentation
}

function hostnameFromUrl(raw: string): string {
  if (!raw.trim()) return ''
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] ?? raw
  }
}

export default function ScannerPage() {
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [url, setUrl] = useState('')
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(8)
  const [desktopPreview, setDesktopPreview] = useState<string | null>(null)
  const [mobilePreview, setMobilePreview] = useState<string | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)

  const mobileNoTx = useIsMobileLayoutNoTransitions()

  const previewContainerVariants = useMemo(
    () => ({
      hidden: {},
      show: {
        transition: mobileNoTx
          ? { staggerChildren: 0, delayChildren: 0 }
          : { staggerChildren: 0.16, delayChildren: 0.08 },
      },
    }),
    [mobileNoTx],
  )

  const previewItemVariants = useMemo(
    () => ({
      hidden: mobileNoTx ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 },
      show: {
        opacity: 1,
        y: 0,
        transition: mobileNoTx
          ? { duration: 0 }
          : { duration: 0.75, ease: previewEase },
      },
    }),
    [mobileNoTx],
  )

  const greenBarTransition = mobileNoTx ? { duration: 0 } : { duration: 1.75, ease: barEase }
  const redBarTransition = mobileNoTx
    ? { duration: 0 }
    : { duration: 1.55, ease: barEase, delay: 0.45 }

  useEffect(() => {
    loadResults()
  }, [])

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 320)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const loadResults = () => {
    try {
      const storedUrl = localStorage.getItem('scanUrl')
      if (storedUrl) {
        setUrl(storedUrl)
      }

      const storedResults = localStorage.getItem('scanResults')
      if (storedResults) {
        const parsed = z
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
                .optional(),
            }),
          )
          .parse(JSON.parse(storedResults))
        setResults(parsed)
      }

      const lastScreenshot = sessionStorage.getItem('lastScreenshot')
      const scanDesktop =
        sessionStorage.getItem('scanPreviewDesktop') ?? localStorage.getItem('scanPreviewDesktop')
      const scanMobile =
        sessionStorage.getItem('scanPreviewMobile') ?? localStorage.getItem('scanPreviewMobile')
      // Prefer analyze-step preview (top-of-page viewport); batch AI screenshots are often mid-page.
      setDesktopPreview(scanDesktop || lastScreenshot || null)
      setMobilePreview(scanMobile && scanMobile.length > 0 ? scanMobile : null)
    } catch (error) {
      console.error('Error loading scanner data:', error)
      setResults(null)
    }
  }


  const toggleRule = (ruleId: string) => {
    setExpandedRules(prev => {
      const newSet = new Set(prev)
      if (newSet.has(ruleId)) {
        newSet.delete(ruleId)
      } else {
        newSet.add(ruleId)
      }
      return newSet
    })
  }

  const loadMore = () => {
    setVisibleCount(prev => prev + 8)
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const visibleResults = results ? results.slice(0, visibleCount) : []
  const hasMore = results ? visibleCount < results.length : false
  const passedCount = results ? results.filter(r => r.passed).length : 0
  const failedCount = results ? results.filter(r => !r.passed).length : 0
  const totalCount = results ? results.length : 0
  const failRatio = totalCount > 0 ? failedCount / totalCount : 0
  const passRatio = totalCount > 0 ? passedCount / totalCount : 0
  const remainingRatio = totalCount > 0 ? Math.max(0, 1 - passRatio) : 0
  const scanHost = hostnameFromUrl(url)
  const mobilePreviewSrc = mobilePreview || desktopPreview

  return (
    <>
    <svg width="0" height="0" style={{ position: 'absolute' }} xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink">
        <defs>
            <pattern id="checkPattern" patternContentUnits="objectBoundingBox" width="1" height="1">
                <use xlinkHref="#checkImage" transform="scale(0.01)" />
            </pattern>
            <image id="checkImage" width="100" height="100" preserveAspectRatio="none"
                xlinkHref="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAAEgElEQVR4nO2dSYhcVRSGbxK77jn/eVVlJ7RoHFBRQUVwACGiiIhoxIUiiAMuRIjgJuBGwY2SlYRABBF1kUUWiig4RcEBhKCIgiIqDjihZmEcME6osQe5dMBOUFLVfeqdOrfOB2/b7/711b3vvbrnvE4pCIIgCIIgCIIgCIIgCIIq6ff70wDOa5pmxnosE023213HjMeZZY5ZFphlnkh25ZxPsh7bJNIhkjcPiDjkwK/MfFtKaZX1ICcGZtny3zIOEvMSER1vPdbqAXAus+w/vBBZIMI+AJusx1wzmQjvDyLjYDHyPDOvtx58dTDL1mFlLJkte4noAusM1UDUXLjkjmq5Un7o9XprrbPUgDDj05XIWHJstg7jHiI8oCSjXE8ess7jmpzl0vLQpyWEWe61zuSYtT1m+UpRxmyn05xhncotzLJDUUY5tlpncguAq3Rl4KPi2DqXS/r9/pFE8o2ikL+Z+XzrXG5hxqPKS9UW60xuYearNWUQybvl12HrXC5pmmam/MShKGR/2byyzuUWIjypOztwt3UmtxDhZuWl6u2U0pR1Lpcw83oi/Kgo5E8ROdM6l1uI5AXl2XGHdSa3ANikKYMZr6eU1ljncknO+URm/KIo5PdOp3uqdS6vrGbGq7qzo7ndOpRbmGWz8lL1SpT+LJOc88mL9VNqMn4mohOWO55JZzUzdmvOjpxxi3UotxDhLk0ZRPKcdSa3dDrN6czyh54M/MTMx1nn8soRRPKW8uy43jqUW5jlHmUZT1lncguAcwatxx1wqfpORI6yzuW5Hvc9zdnB3FxrHcotzHKfrgzZmbzvwpViMyLa0Pb+ABFtKLVQiteNPaWFLTlligjbFysu/g1UymtaOj+Y8YnizJgHsDE5ZarchfxPsNmyOzfqARDhfuW7qodThTJakUIKrQOHHF+mtK6bKpUxainCjM8UZczlLJekymWMTAqRPKK7VGF7mhAZ6lJylsuUWwc+T2mmSQ5lPL3C4LNEcqNCPe4eRRmzLnsCmbFN7wNYvhRm2am5VJUHyuSN6enpPrP8pfutHF4Kq9fj4oOyAiZvHHgS1vxWDi2lWazH/Vbx/H7rcUt71giEDCWFCE8on9t1D+AqZnxsJYVIbtBdquQd9/W4RM1FpZa1bSkAjhlBPe5ZqQYAXK65Vz3IcwqR7NKdHbgz1USbUnLGrcpL1RtV1uO2IYWZj12s9lCtxz0t1QqAK0d5TWHGh8p/s/53j4x4pizoHXitVDKmScCBlN9y7p2SJolxloJJffXeeErByxPdOjBOUoiwL94WOkZSqIUCCzdYSyGSZ6w/g7HDSgoRvgdwtHX+scRCCpFcZ517rGlXCh6zzuuCNqQQYW+0DoyVFL7GOqM7Rihlh3U2t2hLIeetA7VJmQdwhXWeKtCQQoQHrXNUxQqlfOG1daBGKXNEzcXWY68WDC0F26zHXD0ANpbdvQFk7HZZj+sRAGcfptf8xfjPNe2zppSOEsmzzPJ1eZtCeSMckdw0MYUKQRAEQRAEQRAEQRAEQRAEaUD+AbYq7zSbaCP3AAAAAElFTkSuQmCC" />
            <pattern id="whiteTickPattern" patternContentUnits="objectBoundingBox" width="1" height="1">
                <use xlinkHref="#whiteTickImage" transform="scale(0.01)" />
            </pattern>
            <image id="whiteTickImage" width="100" height="100" preserveAspectRatio="none"
                xlinkHref="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAADyklEQVR4nO3d26tmYxwH8MU45HxqxDiEmEIKU4pIkhjNBSk5tC+k9tTcTLmh3NBcTdPUKAkXczEXJGqcy6HURKJIyCGnsC+MQ8Ywx5mPVu+r9gXtvd/5ve/vfdZ6Pn/Au57v+u7TWuv3rN00VVVVVVVVVVVVVVVVVVV1Eo7BKizPXkuv4Tg8hj0G9uJZnJ69tt7BQXjDf/sZa7Ff9jp7Axss7EWckr3WzsOF+NPi7MJs9po7CwfjPUv3HFZkr79zsMnoduKS7AydgUvn/UU1qu9xbHaW4uEwfCLG+uw8xcP94jyYnadouHJ40Rfl3uxMxcKR+DKwjL9xTnauYmGrWJuyMxULa4LL+BCHZOcqEo7G14Fl/IWLsnMVC4+ItSE7U7FwXXAZ77R3h7NzFQnLh7c4orQ3IVdl5yoWnhDr7uxMxcJMcBlv4cDsXEXCCvwQWMbvODc7V7HwvFh3ZGcqFmaDy3gNy7JzFQmnYXdgGb/irOxcRcL+eEWsddm5ioX1wWW8XEd/RoQzhvNTUX7CqaOup9cMflTtEOu27FzFwl3BZTyTnalYOBu/BZbxI07OzlUkHIA3xbopO1excE9wGduzMxULFyxhHncxvsXx2blKnsd9V6wbsnMVCxuDy9jWdOApXDtsdvGknw8YHLOdhYoy125ha0rUnnxsGU5czA+0ZkLHPxQfB5bRTi+ubgouY/v/BGu/YmcmsIb7xHqo6WAZEylFzNaB+b7AEU1HyxhrKQZbBz4NLKMt9oqm42WMrRQ8LNaWpidlhJeCq4K3DnyGw5sCy3hyH4O3pdwSMI87F1TEv2sqb08gNgeegJFLwTaxNjalwVH4I/AkjFSK+Hnc99tbLk1phlfC0ZZUisGdgG8Cj1/uPG67Pct4LLoUPB587HL3ALZTFvhIUim4OfiYbxc/j4vLhrOsEy0FJ45hHve8pgtwdfCz6gWvUwzeTRXpzqZLJlkKbg/+/Nc7OY87iVJw0nDaI3Ied2XTVbh2zL9TPgj+zO6/e2TM3ymRXm0nGZs+KKCUX3Bm0ydTXsps00dTWspLvd46MGWl7KpvC52uUmayz8XUmIJSnso+B1MnsZTvcEJ2/qmUVMqN2bmn2oRLeTQ7bxEmVMrOunVgukq5PjtjccZYytbsbMUaQylzxW4d6GApe3FNdp5OCCrlgewcnbKPpXxe5NaBjpayB5dnr72zLL2Uzdlr7jysHj7dW8iOIudxS4TzF9hr/kL9zzUThmXD0dGn8dXwbQrtG+Fu7c2gQlVVVVVVVVVVVVVVVVVVVbNI/wAywxd5pkkIdgAAAABJRU5ErkJggg==" />
            <pattern id="lockPattern" patternContentUnits="objectBoundingBox" width="1" height="1">
                <use xlinkHref="#lockImage" transform="scale(0.0111111)" />
            </pattern>
            <image id="lockImage" width="90" height="90" preserveAspectRatio="none"
                xlinkHref="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAABaCAYAAAA4qEECAAAACXBIWXMAAAsTAAALEwEAmpwYAAADVElEQVR4nO2cu2sUURSHD4KZ8ztnNhHjAx9YaGElik0QBP8CC+3tLUyMr8JCsAg2djb5AySihbGxDUELH4Ukgg+ws7AIBCEm4iPRK5fdIuLM7sbszp25cz74QUg2mXM+bs7cnWWGyDAMwzAMo+4kzOkpQG8y6zQgb5nlM6A/mfUTIDOA3PU/B3C60WgMhy64UojIMWadbEl1G8gaIE8BnCcaboTuo7So6hFmfQzo7w0Kzoh8AXRiaGhoW+i+ykQC6G1AVzcv+O8wyyKznKO6kySDh5j1Va8FZwh/SLR9kOqIiBxnloV+S143Tt4z8wGqm2RAlro8wc0COg5gRFV3EdFWH/+1/x6gl1qvWevi7330/0VUn3EhnVbyij+ZbWTL5l/rfwfQrx1W9oc0TXdQ5CSdZ7JMicie/z0AgL2A3OtwjBki2kKxgubuIndMMOuVXh2LWa62GyfMcp1i3Scjfwu3BuBMr48JpGfbyP6WJMlBig1uvhnJWV29W8n/HleutRkhDygmRORo/js+mer38QG5nyP718BA4zDFArNO5u0uNnPi6xYA+/J2I8xyhyIhaXOBaKKoIgC9lSN6obU3rzatS50uI6tFXtpM03Rn3omROT1JVad5vVizZvNs8bXIk5xVfYOqDrM+ylnR4wFquZyz65mmqgPIu2zRGCm6FmY+kbOi31DV8deEkdGcn5lF16Kqu3NEL1LVAfRHVnNENBDoQ4asMfadqk7euzKyeuJuDCWrJ9rGULJ6om0MJasn2sZQsnqibQwlq6cbGNCLzPqy9RmfizQrzPoC0DG/PSzUMID9zPK6BBJckWHWed97UZ65jpKxTnYhK9uPi9DNInxG+y66NZNDN+oCr+rnfRcNyHLoRhE8slyA6NBNailiomGiXUwx0TDRLqaYaJhoF1NMNEy0iykmGibaxRQTDRPtYoqJhol2McVEw0S7mGKiYaJdTDHRMNEupphomGgXU0w0TLSLKSYaJtrFFBMNE+1iiomGiXYxxUTDRLuYYqJhol1MMdGIRrTdLATIUt9F2+1vWtTtbzoWulGEz4WingE9X+PVPFfY86CaN93XTzazzvnnnFKAJ26N+nkV9wlSfG/PWuMixJPNDMMwDMMwDMMwqK/8AV++ZBzeWen8AAAAAElFTkSuQmCC" />
        </defs>
    </svg>
   
    <main className="bg-[#FDFDFD] min-h-screen w-full overflow-x-visible">
      <div className={`bg-[#F4F4F5] pt-[34px] pb-[46px] md:px-4 ${hasMore ? 'gradient' : ''}`}>
        <div className="max-w-[1000px] w-full mx-auto px-4 sm:px-6">
          {/* Logo */}
          <div className="text-center sm:mb-[34px]">
            <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px] object-cover" />
          </div>

          {/* Title */}
          <h2 className="text-[26px] sm:text-[33px] leading-[48px] font-bold text-black text-center mb-0 sm:mb-4">
            Your results are in!
          </h2>

          {/* Hero preview: desktop canvas + overlapped mobile frame */}
          {url && (
            <div className="relative overflow-visible px-2 sm:px-3 mb-[40x] sm:mb-[80px]">
              <div
                className="pointer-events-none absolute inset-x-3 inset-y-3 -z-10 rounded-[2.2rem] bg-gradient-to-br from-zinc-200/70 via-zinc-100/45 to-white/20 blur-2xl sm:inset-x-7"
                aria-hidden
              />
              <motion.div
                className="relative mx-auto min-h-[380px] sm:min-h-auto flex w-full max-w-[380px] sm:max-w-[720px] pt-2 sm:text-center items-center md:items-start mobile-height"
                variants={previewContainerVariants}
                initial="hidden"
                animate="show"
              >
                {/* Desktop browser */}
                <motion.div
                  className="relative z-0 w-full max-w-[min(100%,40rem)] shrink-0 lg:min-w-0 sm:pe-[60px] lg:pe-0 md:h-auto min-h-auto h-full"
                  variants={previewItemVariants}
                  initial="hidden"
                  animate="show"
                >
                  <div className="overflow-hidden rounded-[1.8rem] border border-zinc-200/90 bg-white shadow-[0_32px_90px_-22px_rgba(0,0,0,0.22)] ring-1 ring-black/4">
                    <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" aria-hidden />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" aria-hidden />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" aria-hidden />
                    </div>
                    <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50/90 px-4 py-2.5">
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-500">
                        <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                        </svg>
                        <span className="truncate">{url.startsWith('http') ? url : `https://${url}`}</span>
                      </div>
                    </div>
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
                      {desktopPreview ? (
                        <img
                          src={desktopPreview}
                          alt="Desktop view of scanned site"
                          className="absolute inset-0 h-full w-full object-cover object-top"
                        />
                      ) : (
                        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-zinc-400">
                          No desktop capture yet — run a scan from the home page.
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  className="w-full max-w-[160px] sm:max-w-[190px] md:max-w-[216px] lg:max-w-[14.2rem] self-center absolute right-0 top-2 sm:z-30 sm:mt-0 mobile-view"
                  variants={previewItemVariants}
                >
                  <div className="rounded-[2.25rem] border border-zinc-200 bg-white p-2.5 shadow-none ring-1 ring-black/[0.05] ">
                    <div className="overflow-hidden rounded-[1.8rem] bg-white ring-1 ring-zinc-200/90">
                      <div className="flex shrink-0 justify-center border-b border-zinc-100 bg-white px-3 pb-2 pt-3">
                        <div
                          className="h-[1.15rem] w-[4.25rem] rounded-full bg-zinc-900"
                          aria-hidden
                        />
                      </div>
                      <div className="mx-2 min-h-0 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-100 max-h-[420px] overflow-y-scroll hide-scrollbar">
                        {mobilePreviewSrc ? (
                          <img
                            src={mobilePreviewSrc}
                            alt="Mobile view of scanned site"
                            className="h-full w-full bg-white object-contain object-top"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full min-h-[180px] items-center justify-center px-3 text-center text-xs text-zinc-400">
                            Mobile capture unavailable for this run.
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 bg-white px-2 pb-2.5 pt-1.5 text-center">
                        <p className="text-[0.7rem] font-bold leading-tight text-violet-950 sm:text-xs">
                          Mobile view
                        </p>
                        {scanHost ? (
                          <p className="mt-0.5 truncate text-[0.62rem] text-zinc-500" title={url}>
                            {scanHost}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          )}

          {results && (
            <div className="mt-6">
              <p className="relative text-[16px] leading-[20px] font-semibold text-[#09090B] text-center mb-6">
                Scan results for:
                <span className="relative group ml-1">
                  <a
                    href={url}
                    target="_blank"
                    className="cursor-pointer text-[#09090B]"
                    rel="noreferrer"
                  >
                    {url.slice(0, 60)}...
                  </a>

                  <span
                    className="absolute left-1/2 top-full z-50 mt-3 w-[990px] max-w-[90vw] -translate-x-1/2 
          rounded-lg border border-gray-300
          bg-white p-4
          text-sm text-gray-800
          shadow-xl
          opacity-0 invisible
          max-sm:transition-none md:transition-all md:duration-200 md:ease-out
          group-hover:opacity-100 group-hover:visible
        "
                  >
                    <span className="block wrap-break-word">
                      {url}
                    </span>
                  </span>
                </span>
              </p>


              {/* Checkpoints bar: green progress + remaining neutral segment */}
              <div className="mb-6 rounded-xl border border-zinc-200 bg-zinc-100/90 px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                  <p className="m-0 shrink-0 text-base font-bold text-black">
                    {totalCount} checkpoints:
                  </p>
                  <div className="relative min-w-0 flex-1" dir="ltr">
                    <div className="flex h-3.5 w-full flex-row overflow-hidden rounded-full bg-zinc-200 shadow-inner">
                      {passRatio > 0 && (
                        <motion.div
                          className="h-full shrink-0 bg-emerald-500"
                          initial={{ width: '0%' }}
                          animate={{ width: `${passRatio * 100}%` }}
                          transition={greenBarTransition}
                        />
                      )}
                      {remainingRatio > 0 && (
                        <motion.div
                          className="h-full shrink-0 bg-zinc-300"
                          initial={{ width: '0%' }}
                          animate={{ width: `${remainingRatio * 100}%` }}
                          transition={redBarTransition}
                        />
                      )}
                    </div>
                    {/* Avatar rides the green→red boundary, moves forward with green fill */}
                    {totalCount > 0 && failRatio > 0 && passRatio > 0 && (
                      <motion.div
                        className="pointer-events-none absolute left-0 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2"
                        initial={{ left: '0%' }}
                        animate={{ left: `${passRatio * 100}%` }}
                        transition={greenBarTransition}
                      >
                      </motion.div>
                    )}
                  </div>
                </div>
                <p className="mt-3 mb-0 text-center text-sm text-zinc-600 sm:text-left" dir="ltr">
                  <span className="font-semibold text-emerald-700">{passedCount} passed</span>
                  <span className="mx-2 text-zinc-400">·</span>
                  <span className="font-semibold text-zinc-600">{failedCount} remaining</span>
                </p>
              </div>

              {/* Rules List */}
              <div className="space-y-3 mb-6">
                {visibleResults.map((result) => {
                  const isExpanded = expandedRules.has(result.ruleId)
                  return (
                    <div
                      key={result.ruleId}
                      className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-gray-300 max-sm:transition-none md:transition-colors"
                      onClick={() => toggleRule(result.ruleId)}
                    >
                      <div className="flex items-center gap-3">
                        {/* Icon */}
                        <div className="shrink-0">
                          {result.passed ? (
                            <img src="/check.png" alt="passed" className="w-4 h-4" />
                          ) : (
                            <img src="/error_logo.png" alt="failed" className="w-4 h-4" />
                          )}
                        </div>

                        {/* Rule Text */}
                        <div className="flex-1">
                          <p className="text-sm  font-semibold text-gray-900 m-0">
                            {result.ruleTitle}
                          </p>
                        </div>

                        {/* Chevron */}
                        <div className="shrink-0 border border-[#E4E4E7] rounded-lg p-1">
                          <ChevronDown
                            className={`w-5 h-5 text-[#09090B] shrink-0 max-sm:transition-none md:transition-transform ${isExpanded ? 'transform rotate-180' : ''
                              }`}
                          />
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="mt-4 border-t border-gray-200 pt-4">
                          <div
                            className={`rounded-lg p-3 ${
                              result.passed ? 'bg-green-50' : 'bg-orange-50'
                            }`}
                          >
                            {result.checkpoint ? (
                              <>
                                <div
                                  className={`mb-3 flex items-center gap-2 ${
                                    result.passed ? 'text-green-700' : 'text-orange-800'
                                  }`}
                                >
                                </div>
                                <CheckpointResultBody
                                  checkpoint={result.checkpoint}
                                  passed={result.passed}
                                />
                              </>
                            ) : (
                              <>
                                <div
                                  className={`mb-2 flex items-center gap-2 ${
                                    result.passed ? 'text-green-700' : 'text-orange-700'
                                  }`}
                                >
                                  {result.passed ? (
                                    <>
                                      <img src="/check.png" alt="passed" className="w-4 h-4" />
                                      <strong className="text-sm font-semibold">Why it Passed:</strong>
                                    </>
                                  ) : (
                                    <>
                                      <X size={16} className="shrink-0" />
                                      <strong className="text-sm font-semibold">Why it Failed:</strong>
                                    </>
                                  )}
                                </div>
                                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                  {result.reason}
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Load More Button */}
              {hasMore && (
                <div className="flex justify-center w-full md:max-w-[231px] mt-[-40px] mx-auto relative z-2">
                  <button
                    onClick={loadMore}
                    className="w-full py-3 px-6 bg-black text-white rounded-xl font-semibold text-sm hover:bg-gray-800 max-sm:transition-none md:transition-colors cursor-pointer"
                  >
                    Load more results
                  </button>
                </div>
              )}

            
            </div>
          )}

          {!results && (
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm">
                No results found. Please start a scan from the home page.
              </p>
            </div>
          )}
        </div>
      </div>


    <section className="bg-white pb-[60px] sm:pt-10 pt-8">
        <div className="container mx-auto px-4">
            <div className="w-full max-w-[611px] mx-auto flex flex-col sm:gap-[60px] gap-[32px]">
                <div
                    className="flex flex-col items-start sm:items-center text-left sm:text-center sm:gap-[21px] gap-[17px]">
                    <span
                        className="inline-block border border-[#E4E4E7] rounded-[7px] px-[7.5px] sm:px-[11px] py-[5px] text-[13.2px] font-semibold text-gray-800 leading-[21px] tracking-[0.42px]">
                        What's next?
                    </span>
                    <h2
                        className="text-[#09090B] font-bold text-[30px] leading-[48px] tracking-[-1.2px] md:text-[48px] md:leading-[67.2px] md:tracking-[-1.92px] text-left sm:text-center">
                        You've started the process<br className="hidden sm:block" />
                        — here's what happens next
                    </h2>
                </div>

                <div className="relative pl-[58px] w-full max-w-[392px] mx-auto">
                    <div className="absolute left-[13px] top-2 bottom-1 w-[7px] bg-[#D9D9D9] rounded-[10px]"></div>
                    <div className="absolute left-[13px] top-2 w-[7px] bg-[#757575] rounded-[10px] h-[110px]"></div>
                    <div className="relative mb-6">
                        <div
                            className="absolute -left-[58px] top-0 w-8 h-8 rounded-full bg-[#2CB15D] flex items-center justify-center">
                            <svg width="17" height="17" viewBox="0 0 17 17" fill="none"
                                xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink">
                                <rect width="17" height="17" fill="url(#pattern0_6396_3298)"></rect>
                                <defs>
                                    <pattern id="pattern0_6396_3298" patternContentUnits="objectBoundingBox" width="1"
                                        height="1">
                                        <use xlinkHref="#image0_6396_3298" transform="scale(0.01)"></use>
                                    </pattern>
                                    <image id="image0_6396_3298" width="100" height="100" preserveAspectRatio="none"
                                        xlinkHref="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAADyklEQVR4nO3d26tmYxwH8MU45HxqxDiEmEIKU4pIkhjNBSk5tC+k9tTcTLmh3NBcTdPUKAkXczEXJGqcy6HURKJIyCGnsC+MQ8Ygx5mPVu+r9gXtvd/5ve/vfdZ6Pn/Au57v+u7TWuv3rN00VVVVVVVVVVVVVVVVVVV1Eo7BKizPXkuv4Tg8hj0G9uJZnJ69tt7BQXjDf/sZa7Ff9jp7Axss7EWckr3WzsOF+NPi7MJs9po7CwfjPUv3HFZkr79zsMnoduKS7AydgUvn/UU1qu9xbHaW4uEwfCLG+uw8xcP94jyYnadouHJ40Rfl3uxMxcKR+DKwjL9xTnauYmGrWJuyMxULa4LL+BCHZOcqEo7G14Fl/IWLsnMVC4+ItSE7U7FwXXAZ77R3h7NzFQnLh7c4orQ3IVdl5yoWnhDr7uxMxcJMcBlv4cDsXEXCCvwQWMbvODc7V7HwvFh3ZGcqFmaDy3gNy7JzFQmnYXdgGb/irOxcRcL+eEWsddm5ioX1wWW8XEd/RoQzhvNTUX7CqaOup9cMflTtEOu27FzFwl3BZTyTnalYOBu/BZbxI07OzlUkHIA3xbopO1excE9wGduzMxULFyxhHncxvsXx2blKnsd9V6wbsnMVCxuDy9jWdOApXDtsdvGknw8YHLOdhYoy125ha0rUnnxsGU5czA+0ZkLHPxQfB5bRTi+ubgouY/v/BGu/YmcmsIb7xHqo6WAZEylFzNaB+b7AEU1HyxhrKQZbBz4NLKMt9oqm42WMrRQ8LNaWpidlhJeCq4K3DnyGw5sCy3hyH4O3pdwSMI87F1TEv2sqb08gNgeegJFLwTaxNjalwVH4I/AkjFSK+Hnc99tbLk1phlfC0ZZUisGdgG8Cj1/uPG67Pct4LLoUPB587HL3ALZTFvhIUim4OfiYbxc/j4vLhrOsEy0FJ45hHve8pgtwdfCz6gWvUwzeTRXpzqZLJlkKbg/+/Nc7OY87iVJw0nDaI3Ied2XTVbh2zL9TPgj+zO6/e2TM3ymRXm0nGZs+KKCUX3Bm0ydTXsps00dTWspLvd46MGWl7KpvC52uUmayz8XUmIJSnso+B1MnsZTvcEJ2/qmUVMqN2bmn2oRLeTQ7bxEmVMrOunVgukq5PjtjccZYytbsbMUaQylzxW4d6GApe3FNdp5OCCrlgewcnbKPpXxe5NaBjpayB5dnr72zLL2Uzdlr7jysHj7dW8iOIudxS4TzF9hr/kL9zzUThmXD0dGn8dXwbQrtG+Fu7c2gQlVVVVVVVVVVVVVVVVVVVbNI/wAywxd5pkkIdgAAAABJRU5ErkJggg==">
                                    </image>
                                </defs>
                            </svg>
                        </div>
                        <h3 className="text-[#09090B] text-[16px] font-semibold leading-[24px] tracking-[-0.16px] mb-1">
                            Today: Product page audit
                        </h3>
                        <p className="text-[#757575] text-[14.5px] font-normal leading-[25.6px] tracking-[0.48px]">
                            You've completed a focused CRO audit covering <span className="font-bold">27 product page
                                checkpoints</span>.
                        </p>
                    </div>

                    <div className="relative mb-6">
                        <div
                            className="absolute -left-[58px] top-0 w-8 h-8 rounded-full bg-white flex items-center justify-center border border-[#E4E4E7]">
                            <svg width="17" height="17" viewBox="0 0 17 17" className="shrink-0">
                                <rect width="17" height="17" fill="url(#lockPattern)" />
                            </svg>
                        </div>
                        <h3 className="text-[#09090B] text-[16px] font-semibold leading-[24px] tracking-[-0.16px] mb-1">
                            Next: Full store CRO audit system
                        </h3>
                        <p className="text-[#757575] text-[14.5px] font-normal leading-[25.6px] tracking-[0.48px] mb-3">
                            Access now our full 300+ conversion checkpoints covering your entire store:
                        </p>
                        <ul className="flex flex-col gap-[10px] mb-[11px]">
                            <li
                                className="flex items-center text-[14.5px] font-bold text-[#09090B] leading-[14px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15" className="mr-[11px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Homepage
                            </li>
                            <li
                                className="flex items-center text-[14.5px] font-bold text-[#09090B] leading-[14px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15" className="mr-[11px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Category page
                            </li>
                            <li
                                className="flex items-center text-[14.5px] font-bold text-[#09090B] leading-[14px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15" className="mr-[11px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Product page
                            </li>
                            <li
                                className="flex items-center text-[14.5px] font-bold text-[#09090B] leading-[14px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15" className="mr-[11px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Cart page
                            </li>
                            <li
                                className="flex items-center text-[14.5px] font-bold text-[#09090B] leading-[14px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15" className="mr-[11px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Checkout page
                            </li>
                            <li
                                className="flex items-center text-[14.5px] font-bold text-[#09090B] leading-[14px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15" className="mr-[11px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Thank you page
                            </li>
                        </ul>
                        <p
                            className="text-[#757575] text-[14.5px] font-normal leading-[25.6px] tracking-[0.48px] mb-[11px]">
                            This is the full audit system we use internally at CXO studio.
                        </p>
                        <a href="#"
                            className="flex items-center justify-between w-full bg-[#09090B] text-white rounded-[10px] px-[15px] py-[16px] hover:bg-black/90 transition">
                            <span className="text-[14.8px] font-semibold leading-[16px] tracking-[0.48px]">Continue with
                                the full CRO system</span>
                            <svg className="w-4 h-4 ml-2 shrink-0" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </a>
                    </div>

                    <div className="relative">
                        <div
                            className="absolute -left-[58px] top-0 w-8 h-8 rounded-full bg-white flex items-center justify-center border border-[#E4E4E7]">
                            <svg width="17" height="17" viewBox="0 0 17 17" className="shrink-0">
                                <rect width="17" height="17" fill="url(#lockPattern)" />
                            </svg>
                        </div>
                        <h3 className="text-[#09090B] text-[16px] font-semibold leading-[24px] tracking-[-0.16px] mb-1">
                            Then: Implementation & continuous CRO
                        </h3>
                        <p
                            className="text-[#757575] text-[14.5px] font-normal leading-[25.6px] tracking-[0.48px] mb-[11px]">
                            For brands, ready to invest, that want strategy and execution support:
                        </p>
                        <ul className="flex flex-col gap-[11px] mb-6">
                            <li
                                className="flex items-start text-[14.5px] font-bold text-[#09090B] leading-[20px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15"
                                    className="mr-[11px] mt-[3px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Full-funnel CRO audit (from homepage to checkout)
                            </li>
                            <li
                                className="flex items-start text-[14.5px] font-bold text-[#09090B] leading-[20px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15"
                                    className="mr-[11px] mt-[3px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Continuous A/B testing of offers, user experience & user interface
                            </li>
                            <li
                                className="flex items-start text-[14.5px] font-bold text-[#09090B] leading-[20px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15"
                                    className="mr-[11px] mt-[3px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                CRO strategy based on buyer psychology & data
                            </li>
                            <li
                                className="flex items-start text-[14.5px] font-bold text-[#09090B] leading-[20px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15"
                                    className="mr-[11px] mt-[3px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Clean implementation & development support
                            </li>
                            <li
                                className="flex items-start text-[14.5px] font-bold text-[#09090B] leading-[20px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15"
                                    className="mr-[11px] mt-[3px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Ongoing optimization to compound results
                            </li>
                            <li
                                className="flex items-start text-[14.5px] font-bold text-[#09090B] leading-[20px] tracking-[0.48px]">
                                <svg width="15" height="15" viewBox="0 0 15 15"
                                    className="mr-[11px] mt-[3px] shrink-0">
                                    <rect width="15" height="15" fill="url(#checkPattern)" />
                                </svg>
                                Weekly reports & strategy call
                            </li>
                        </ul>
                        <a href="#"
                            className="flex items-center justify-between w-full bg-white border border-gray-200 text-[#09090B] rounded-[10px] px-[15px] py-[16px] hover:bg-gray-50 transition">
                            <span className="text-[14.8px] font-semibold leading-[16px] tracking-[0.48px]">See if we can
                                help you</span>
                            <svg className="w-4 h-4 ml-2 shrink-0" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </section>
      {results && showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Back to top"
          className="back-to-top-float fixed bottom-6 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-[0_14px_30px_-12px_rgba(0,0,0,0.35)] sm:bottom-8 sm:right-8 cursor-pointer"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </main >
    </>
  )
}
