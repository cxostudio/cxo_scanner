'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { toast } from 'react-toastify'
import { usePathname } from "next/navigation";
import { Check, Plus, Trash2, X } from 'lucide-react';

interface Rule {
  id: string
  title: string
  description: string
}

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
}

// Zod schemas for validation
const RuleSchema = z.object({
  id: z.string().min(1, 'Rule ID is required'),
  title: z.string().min(1, 'Rule title is required').max(200, 'Rule title must be less than 200 characters'),
  description: z.string().min(1, 'Rule description is required').max(5000, 'Rule description must be less than 5000 characters'),
})

const URLSchema = z.string()
  .min(1, 'URL is required')
  .refine((url) => {
    try {
      const validUrl = url.startsWith('http') ? url : `https://${url}`
      new URL(validUrl)
      return true
    } catch {
      return false
    }
  }, 'Invalid URL format')

// Schema for the new JSON format with fields object OR direct camelCase properties
const FieldsRuleSchema = z.union([
  // Format 1: With fields object
  z.object({
    id: z.string().optional(),
    fields: z.object({
      "Conversion Checkpoint": z.string().min(1).optional(),
      "Required Actions": z.string().min(1).optional(),
      "conversion checkpoint": z.string().min(1).optional(),
      "required actions": z.string().min(1).optional(),
      "ConversionCheckpoint": z.string().min(1).optional(),
      "RequiredActions": z.string().min(1).optional(),
    }).passthrough(),
  }),
  // Format 2: Direct camelCase properties (conversionCheckpoint, requiredActions)
  z.object({
    id: z.string().optional(),
    conversionCheckpoint: z.string().min(1).optional(),
    requiredActions: z.string().min(1).optional(),
  }).passthrough(),
]).transform((data: any) => {
  let title = ""
  let description = ""
  
  // Check if it has fields object
  if (data.fields) {
    const fields = data.fields
    title = fields["Conversion Checkpoint"] || 
            fields["conversion checkpoint"] || 
            fields["ConversionCheckpoint"] || 
            fields["conversionCheckpoint"] ||
            ""
    description = fields["Required Actions"] || 
                  fields["required actions"] || 
                  fields["RequiredActions"] || 
                  fields["requiredActions"] ||
                  ""
  } 
  // Check if it has direct camelCase properties
  else if (data.conversionCheckpoint || data.requiredActions) {
    title = data.conversionCheckpoint || ""
    description = data.requiredActions || ""
  }
  
  if (!title || !description) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Missing 'conversionCheckpoint' or 'requiredActions' (or 'fields' object with 'Conversion Checkpoint'/'Required Actions')"
      }
    ])
  }
  
  return {
    id: data.id || `json-${Date.now()}`,
    title: title,
    description: description,
  }
})

const JSONRulesSchema = z.union([
  z.array(RuleSchema),
  z.array(FieldsRuleSchema),
  RuleSchema,
  FieldsRuleSchema,
]).transform((data) => {
  // If it's an array, return as is
  if (Array.isArray(data)) {
    return data
  }
  // If single object, wrap in array
  return [data]
})

interface BatchData {
  batchId: string
  url: string
  rules: Rule[]
  batchIndex: number
  totalBatches: number
  timestamp: number
}

export default function ScannerPage() {
  const [url, setUrl] = useState('')
  const [rules, setRules] = useState<Rule[]>([])
  const [jsonRules, setJsonRules] = useState('')
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [jsonRulesError, setJsonRulesError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const pathname = usePathname();
  useEffect(() => {
    setMounted(true)
    loadRules()
    checkPendingBatches()
  }, [])

  const linkStyle = (path: string) =>
    `px-6 py-2 rounded-lg text-lg font-medium transition
     ${
       pathname === path
         ? "bg-indigo-500 text-white shadow-md"
         : "text-indigo-500 hover:bg-indigo-100"
     }`;

  // Check if there are pending batches in localStorage
  const checkPendingBatches = () => {
    const storedBatches = localStorage.getItem('scanBatches')
    const storedResults = localStorage.getItem('scanResults')
    
    if (storedBatches) {
      try {
        const batches: BatchData[] = JSON.parse(storedBatches)
        const results: ScanResult[] = storedResults ? JSON.parse(storedResults) : []
        
        if (batches.length > 0) {
          const shouldResume = window.confirm(
            `Found ${batches.length} pending batch(es) from previous scan. Do you want to resume?`
          )
          
          if (shouldResume) {
            setUrl(batches[0].url)
            setScanning(true)
            setResults(results.length > 0 ? results : null)
            processBatches(batches).finally(() => {
              setScanning(false)
            })
          } else {
            // Clear pending batches if user doesn't want to resume
            localStorage.removeItem('scanBatches')
            localStorage.removeItem('scanResults')
          }
        }
      } catch (err) {
        console.error('Error checking pending batches:', err)
        localStorage.removeItem('scanBatches')
        localStorage.removeItem('scanResults')
      }
    }
  }

  const loadRules = () => {
    const stored = localStorage.getItem('websiteRules')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        // Validate loaded rules with Zod
        const validatedRules = z.array(RuleSchema).parse(parsed)
        setRules(validatedRules)
      } catch (error) {
        console.error('Error loading rules:', error)
        // If validation fails, clear invalid data
        localStorage.removeItem('websiteRules')
        setRules([])
      }
    }
  }

  const saveRules = (newRules: Rule[]) => {
    localStorage.setItem('websiteRules', JSON.stringify(newRules))
    setRules(newRules)
  }

  const validateUrl = (value: string) => {
    if (!value.trim()) {
      setUrlError(null)
      return true
    }
    try {
      URLSchema.parse(value.trim())
      setUrlError(null)
      return true
    } catch (error) {
      if (error instanceof z.ZodError) {
        setUrlError(error.errors[0]?.message || 'Invalid URL')
        return false
      }
      return false
    }
  }

  const validateJsonRules = (value: string) => {
    if (!value.trim()) {
      setJsonRulesError(null)
      return true
    }
    try {
      // Clean JSON - remove trailing commas
      let cleanedJson = value.trim()
      cleanedJson = cleanedJson.replace(/,(\s*[}\]])/g, '$1')
      
      const parsed = JSON.parse(cleanedJson)
      JSONRulesSchema.parse(parsed)
      setJsonRulesError(null)
      return true
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorMessage = err.errors.map(e => {
          const path = e.path.length > 0 ? e.path.join('.') : 'root'
          return `${path}: ${e.message}`
        }).join(', ')
        setJsonRulesError(errorMessage)
        return false
      } else if (err instanceof SyntaxError) {
        setJsonRulesError(`Invalid JSON format: ${err.message}. Please check your JSON syntax.`)
        return false
      } else {
        setJsonRulesError(`Invalid format: ${err instanceof Error ? err.message : 'Unknown error'}`)
        return false
      }
    }
  }

  const handleAddJsonRules = () => {
    if (!jsonRules.trim()) {
      return
    }

    if (!validateJsonRules(jsonRules)) {
      return
    }

    try {
      // Clean JSON - remove trailing commas and extra whitespace
      let cleanedJson = jsonRules.trim()
      // Remove trailing commas before closing braces/brackets
      cleanedJson = cleanedJson.replace(/,(\s*[}\]])/g, '$1')
      
      const parsed = JSON.parse(cleanedJson)
      
      // Validate JSON structure with Zod
      const validatedRules = JSONRulesSchema.parse(parsed)
      
      // Map to ensure all required fields are present
      let additionalRules: Rule[] = validatedRules.map((rule, index) => ({
        id: rule.id || `json-${Date.now()}-${index}`,
        title: rule.title,
        description: rule.description,
      }))

      // Remove duplicates based on title (case-insensitive) and merge with existing rules
      const existingTitles = new Set(rules.map(r => r.title.toLowerCase().trim()))
      const newUniqueRules = additionalRules.filter(rule => {
        const titleLower = rule.title.toLowerCase().trim()
        return !existingTitles.has(titleLower)
      })

      // Also check for duplicate IDs
      const existingIds = new Set(rules.map(r => r.id))
      const finalNewRules = newUniqueRules.filter(rule => !existingIds.has(rule.id))

      if (finalNewRules.length === 0) {
        toast.error('All rules from JSON already exist in your rules list!')
        setJsonRules('')
        setJsonRulesError(null)
        return
      }

      // Merge and save
      const mergedRules = [...rules, ...finalNewRules]
      saveRules(mergedRules)
      
      // Clear JSON field
      setJsonRules('')
      setJsonRulesError(null)
      
      const duplicateCount = additionalRules.length - finalNewRules.length
      if (duplicateCount > 0) {
        toast.success(`${finalNewRules.length} new rule(s) added successfully! ${duplicateCount} duplicate(s) removed.`)
      } else {
        toast.success(`${finalNewRules.length} new rule(s) added successfully!`)
      }
    } catch (err) {
      // This should not happen as we validated above
      console.error('Unexpected error:', err)
    }
  }

  // Function 1: Divide rules into batches and save to localStorage
  const prepareBatches = (urlToScan: string, rulesToScan: Rule[]): BatchData[] => {
    const BATCH_SIZE = 5
    const batches: BatchData[] = []
    const timestamp = Date.now()
    
    const totalRules = rulesToScan.length
    const remainder = totalRules % BATCH_SIZE
    
    // Dynamic logic: Every 5 rules = 1 batch, extra rules (1-4) distributed to first batches
    // Example: 25 rules = 5 batches, 26-29 = 5 batches (extra in first), 30 = 6 batches, 31-34 = 6 batches, 35 = 7 batches
    const totalBatches = Math.ceil(totalRules / BATCH_SIZE)
    
    let ruleIndex = 0
    
    // Distribute rules: Extra rules (1-4) go to FIRST batches (not last)
    // Example: 26 rules → Batch 1 gets 6, Batch 2-5 get 5 each
    // Example: 27 rules → Batch 1 gets 6, Batch 2 gets 6, Batch 3-5 get 5 each
    // Example: 30 rules → All 6 batches get 5 each
    // Example: 31 rules → Batch 1 gets 6, Batch 2-6 get 5 each
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Calculate batch size: First batches get extra rules if remainder exists
      let currentBatchSize = BATCH_SIZE
      if (remainder > 0 && batchIndex < remainder) {
        currentBatchSize = BATCH_SIZE + 1 // Extra rule for first batches
      }
      
      // Get rules for this batch
      const batchRules = rulesToScan.slice(ruleIndex, ruleIndex + currentBatchSize)
      
      batches.push({
        batchId: `batch-${timestamp}-${batchIndex}`,
        url: urlToScan,
        rules: batchRules,
        batchIndex: batchIndex,
        totalBatches: totalBatches,
        timestamp: timestamp,
      })
      
      ruleIndex += currentBatchSize
    }
    
    // Save all batches to localStorage
    localStorage.setItem('scanBatches', JSON.stringify(batches))
    localStorage.setItem('scanResults', JSON.stringify([])) // Initialize results array
    
    return batches
  }

  // Function 2: Process batches from queue sequentially
  const processBatches = async (batches: BatchData[]) => {
    const allResults: ScanResult[] = []
    
    setProgress({ current: 0, total: batches.length })
    
    // Process each batch one by one
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      
      try {
        setProgress({ current: i + 1, total: batches.length })
        console.log('Processing batch', i + 1, 'of', batches.length, '...')
        
        // Send batch to API
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: batch.url,
            rules: batch.rules,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `Failed to scan batch ${i + 1}`)
        }

        const data = await response.json()
        
        // Validate response
        const ScanResultsSchema = z.array(z.object({
          ruleId: z.string(),
          ruleTitle: z.string(),
          passed: z.boolean(),
          reason: z.string(),
        }))
        
        const batchResults = ScanResultsSchema.parse(data.results)
        allResults.push(...batchResults)
        
        // Remove completed batch from localStorage
        const remainingBatches = batches.slice(i + 1)
        if (remainingBatches.length > 0) {
          localStorage.setItem('scanBatches', JSON.stringify(remainingBatches))
        } else {
          localStorage.removeItem('scanBatches')
        }
        
        // Update results in localStorage
        localStorage.setItem('scanResults', JSON.stringify(allResults))
        
      } catch (err) {
        console.error(`Error processing batch ${i + 1}:`, err)
        // Add error results for failed batch
        batch.rules.forEach(rule => {
          allResults.push({
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: false,
            reason: `Error processing batch ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          })
        })
      }
    }
    
    // Final request to combine all results (fixes Vercel timeout issue)
    try {
      const finalResponse = await fetch('/api/scan/combine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          results: allResults,
        }),
      })
      
      if (finalResponse.ok) {
        const finalData = await finalResponse.json()
        const validatedResults = z.array(z.object({
          ruleId: z.string(),
          ruleTitle: z.string(),
          passed: z.boolean(),
          reason: z.string(),
        })).parse(finalData.results)
        
        setResults(validatedResults)
        localStorage.removeItem('scanResults')
      } else {
        // If final request fails, use accumulated results
        setResults(allResults)
        localStorage.removeItem('scanResults')
      }
    } catch (finalErr) {
      // If final request fails, use accumulated results
      console.error('Final request error:', finalErr)
      setResults(allResults)
      localStorage.removeItem('scanResults')
    }
    
    setProgress(null)
  }

  const handleScan = async () => {
    // Validate URL first
    if (!validateUrl(url)) {
      return
    }

    // Use rules from localStorage (already includes JSON rules if added via "Add Rules to List")
    const allRules = rules

    if (allRules.length === 0) {
      toast.error('Please define at least one rule before scanning (either from Rules page or JSON field)')
      return
    }

    try {
      // Validate URL with Zod
      const validatedUrl = URLSchema.parse(url.trim())
      
      // Normalize URL
      let validUrl = validatedUrl
      if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
        validUrl = 'https://' + validUrl
      }

      setScanning(true)
      setError(null)
      setResults(null)
      setProgress(null)

      // Function 1: Prepare batches and save to localStorage
      const batches = prepareBatches(validUrl, allRules)
      console.log('Prepared', batches.length, 'batch(es) for scanning')
      
      // Function 2: Process batches from queue
      await processBatches(batches)
      
      setUrlError(null)
      toast.success('Scan completed successfully!')
    } catch (err) {
      if (err instanceof z.ZodError) {
        if (err.errors[0]?.path[0] === 'url') {
          setUrlError(err.errors.map(e => e.message).join(', '))
        } else {
          setError(`Validation Error: ${err.errors.map(e => e.message).join(', ')}`)
        }
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred')
      }
    } finally {
      setScanning(false)
      setProgress(null)
      // Clean up localStorage
      localStorage.removeItem('scanBatches')
      localStorage.removeItem('scanResults')
    }
  }

  const getOverallStatus = () => {
    if (!results) return null
    const allPassed = results.every(r => r.passed)
    const somePassed = results.some(r => r.passed)
    
    if (allPassed) return 'success'
    if (somePassed) return 'partial'
    return 'failure'
  }

  const overallStatus = getOverallStatus()

  return (
    <div className="bg-[linear-gradient(135deg,#667eea,#764ba2)] py-6 px-4 min-h-screen">
      {/* Navigation */}
      <nav className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg px-6 py-4">
        <ul className="flex items-center gap-6">
          <li>
            <Link href="/" className={linkStyle("/")}>
              Home
            </Link>
          </li>
          <li>
            <Link href="/rules" className={linkStyle("/rules")}>
              Rules
            </Link>
          </li>
          <li>
            <Link href="/scanner" className={linkStyle("/scanner")}>
              Scanner
            </Link>
          </li>
        </ul>
      </nav>

      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg px-6 py-6 mt-4">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">Scan Website</h1>

        {/* JavaScript Support Section */}
        <div className="mb-8 p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-start gap-3">
            <Check className="text-green-600 mt-0.5 shrink-0" size={20} />
            <p className="m-0 text-gray-700 text-sm leading-relaxed">
              <strong className="text-gray-800">JavaScript Support:</strong> This tool uses a headless browser to detect content loaded via JavaScript. 
              Dynamically loaded content will be analyzed along with static HTML.
            </p>
          </div>
        </div>

        {rules.length === 0 && !jsonRules.trim() && (
          <div className="mb-8 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-500">
            <p className="m-0 text-gray-700">
              <strong>⚠️ No rules defined yet.</strong> Please <Link href="/rules" className="text-indigo-600 font-bold hover:underline">add rules</Link> or paste JSON rules below.
            </p>
          </div>
        )}

        {/* Rules JSON Section */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
          <label className="block text-md font-medium text-gray-700 mb-2">
            Rules JSON (Optional)
          </label>
          <p className="text-gray-600 text-sm mb-2">-Add JSON rules to the list</p>      
          </div>      
          <textarea
            className="w-full p-4 h-48 border-2 border-gray-300 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={jsonRules}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setJsonRules(e.target.value)
              if (jsonRulesError) {
                validateJsonRules(e.target.value)
              }
            }}
            onBlur={() => validateJsonRules(jsonRules)}
            placeholder={`[{"id": "rule1", "title": "Privacy Policy", "description": "Website must have privacy policy"}]\n\nOR\n\n{"id": "rec123", "fields": {"Conversion Checkpoint": "Title", "Required Actions": "Description"}}\n\nOR\n\n{"id": "rec123", "conversionCheckpoint": "Title", "requiredActions": "Description"}`}
            disabled={scanning}
          />
          {jsonRulesError && (
            <p className="text-red-500 text-sm mt-2 mb-0">
              {jsonRulesError}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <button
              className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
                bg-gray-500 hover:bg-gray-600
                transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleAddJsonRules}
              disabled={scanning || !jsonRules.trim()}
            >
              <Plus size={18} /> Add Rules to List
            </button>
            <button
              className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
                bg-gray-500 hover:bg-gray-600
                transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                setJsonRules('')
                setJsonRulesError(null)
              }}
              disabled={scanning || !jsonRules.trim()}
              title="Clear"
            >
              <Trash2 size={18} /> Clear
            </button>
          </div>
          <p className="text-gray-600 text-sm mt-3 mb-0">
            Enter rules in JSON format and click "Add Rules to List". Duplicate rules will be automatically removed.
          </p>
        </div>

        {/* Website URL Section */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Website URL
          </label>
          <input
            type="text"
            className="w-full p-3 border-2 border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={url}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setUrl(e.target.value)
              if (urlError) {
                validateUrl(e.target.value)
              }
            }}
            onBlur={() => validateUrl(url)}
            placeholder="https://example.com or example.com"
            disabled={scanning}
          />
          {urlError && (
            <p className="text-red-500 text-sm mt-2 mb-0">
              {urlError}
            </p>
          )}
          {!urlError && (
            <p className="text-gray-600 text-sm mt-2 mb-0">
              Enter the website URL here (e.g., google.com, https://example.com)
            </p>
          )}
        </div>

        {/* Scan Website Button */}
        <div className="flex justify-center mb-8">
          <button
            className="w-full max-w-md py-4 px-8 rounded-lg font-semibold text-lg text-white inline-flex items-center justify-center gap-2
              bg-linear-to-r from-[#667eea] to-[#764ba2]
              hover:from-[#5568d3] hover:to-[#653a8f]
              transition-all duration-200 shadow-lg hover:shadow-xl
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg"
            onClick={handleScan}
            disabled={scanning || !url.trim()}
            title="Scan Website"
          >
            {scanning ? (
              <>
                <span className="loading mr-2"></span>
                {progress ? `Scanning... ` : 'Scanning...'}
              </>
            ) : (
              'Scan Website'
            )}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 rounded-lg border border-red-500 mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {results && (
              <div className="mt-8">
                <div
                  title="Scan Results"
                  className={`p-4 bg-white rounded-lg border-0 mb-4 
                    ${overallStatus === 'success' ? 'bg-green-100' : overallStatus === 'partial' ? 'bg-yellow-100' : 'bg-red-200'}`}
                >
                  <h2 className="text-lg font-semibold text-gray-800 mb-2">
                    Scan Results for {url}
                  </h2>
                  <p>
                    <strong>
                      {results.filter(r => r.passed).length} of {results.length} rules passed
                    </strong>
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-gray-800 mb-2">Detailed Results:</h3>
                {results.map((result) => (
                  <div
                    key={result.ruleId}
                    title={result.ruleTitle}
                    className={`p-4 rounded-lg mb-4 ${
                      result.passed 
                        ? 'bg-green-100' 
                        : 'bg-red-200'
                    }`}
                  >
                    <h4 className="text-base font-bold text-gray-900 mb-3">
                      {result.ruleTitle} - {result.passed ? 'Passed' : 'Failed'}
                    </h4>
                    <div className={`p-4 rounded-lg ${
                      result.passed
                        ? 'bg-green-50 border-l-4 border-green-500'
                        : 'bg-red-50 border-l-4 border-red-500'
                    }`}>
                      <div className={`flex items-center gap-2 mb-2 ${
                        result.passed ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {result.passed ? (
                          <>
                            <Check size={18} className="shrink-0" />
                            <strong className="text-base font-semibold">Why it Passed:</strong>
                          </>
                        ) : (
                          <>
                            <X size={18} className="shrink-0" />
                            <strong className="text-base font-semibold">Why it Failed:</strong>
                          </>
                        )}
                      </div>
                      <p className="m-0 text-gray-900 text-sm leading-relaxed whitespace-pre-wrap">
                        {result.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  )
}

