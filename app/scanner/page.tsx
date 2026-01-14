'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { toast } from 'react-toastify'

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

  useEffect(() => {
    setMounted(true)
    loadRules()
    checkPendingBatches()
  }, [])

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
    <div className="container">
      <nav className="nav">
        <ul className="nav-links">
          <li><Link href="/" className="nav-link">Home</Link></li>
          <li><Link href="/rules" className="nav-link">Rules</Link></li>
          <li><Link href="/scanner" className="nav-link active">Scanner</Link></li>
        </ul>
      </nav>

      <div className="card">
        <h1 style={{ marginBottom: '2rem', color: '#333' }}>Scan Website</h1>

        <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f0f7ff', borderRadius: '8px', borderLeft: '4px solid #667eea' }}>
          <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>
            <strong>✅ JavaScript Support:</strong> This tool uses a headless browser to detect content loaded via JavaScript. 
            Dynamically loaded content will be analyzed along with static HTML.
          </p>
        </div>

        {rules.length === 0 && !jsonRules.trim() && (
          <div className="result-card result-pending" style={{ marginBottom: '2rem', padding: '1rem' }}>
            <p style={{ margin: 0 }}>
              <strong>⚠️ No rules defined yet.</strong> Please <Link href="/rules" style={{ color: '#667eea', fontWeight: 'bold' }}>add rules</Link> or paste JSON rules below.
            </p>
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <label className="label" style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
            Rules JSON (Optional)
            <span style={{ fontSize: '0.9rem', fontWeight: 'normal', color: '#666', marginLeft: '0.5rem' }}>
              - Add JSON rules to the list
            </span>
          </label>
          <textarea
            className="textarea"
            value={jsonRules}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setJsonRules(e.target.value)
              if (jsonRulesError) {
                validateJsonRules(e.target.value)
              }
            }}
            onBlur={() => validateJsonRules(jsonRules)}
            placeholder={`Example JSON formats:\n\nStandard: [{"id": "rule1", "title": "Privacy Policy", "description": "Website must have privacy policy"}]\n\nFields format: {"id": "rec123", "fields": {"Conversion Checkpoint": "Title", "Required Actions": "Description"}}\n\nCamelCase: {"id": "rec123", "conversionCheckpoint": "Title", "requiredActions": "Description"}`}
            disabled={scanning}
            style={{ 
              fontSize: '0.9rem', 
              fontFamily: 'monospace',
              minHeight: '150px',
              borderColor: jsonRulesError ? '#dc3545' : undefined
            }}
          />
          {jsonRulesError && (
            <p style={{ color: '#dc3545', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: 0 }}>
              {jsonRulesError}
            </p>
          )}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={handleAddJsonRules}
              disabled={scanning || !jsonRules.trim()}
              style={{ 
                fontSize: '0.9rem', 
                padding: '0.75rem 1.5rem'
              }}
            >
              ➕ Add Rules to List
            </button>
            <button
              className="btn"
              onClick={() => {
                setJsonRules('')
                setJsonRulesError(null)
              }}
              disabled={scanning || !jsonRules.trim()}
              style={{ 
                fontSize: '0.9rem', 
                padding: '0.75rem 1.5rem',
                background: '#6c757d'
              }}
            >
              🗑️ Clear
            </button>
          </div>
          <p style={{ marginTop: '0.5rem', color: '#666', fontSize: '0.9rem' }}>
            Enter rules in JSON format and click "Add Rules to List". Duplicate rules will be automatically removed.
          </p>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <label className="label" style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Website URL</label>
          <input
            type="text"
            className="input"
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
            style={{ 
              fontSize: '1rem', 
              padding: '1rem',
              border: `2px solid ${urlError ? '#dc3545' : '#e0e0e0'}`,
              borderRadius: '8px',
              width: '100%'
            }}
          />
          {urlError && (
            <p style={{ color: '#dc3545', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
              {urlError}
            </p>
          )}
          {!urlError && (
            <p style={{ marginTop: '0.5rem', color: '#666', fontSize: '0.9rem' }}>
              Enter the website URL here (e.g., google.com, https://example.com)
            </p>
          )}
        </div>

        <button
          className="btn"
          onClick={handleScan}
          disabled={scanning || !url.trim()}
          style={{ 
            fontSize: '1.1rem', 
            padding: '1rem 2rem',
            width: '100%',
            maxWidth: '300px'
          }}
        >
          {scanning ? (
            <>
              <span className="loading" style={{ marginRight: '0.5rem' }}></span>
              {progress ? `Scanning... ` : 'Scanning...'}
            </>
          ) : (
            'Scan Website'
          )}
        </button>

        {progress && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            background: '#f0f7ff', 
            borderRadius: '8px',
            borderLeft: '4px solid #667eea'
          }}>
            <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>
              <strong>Progress:</strong> Processing batch {progress.current} of {progress.total}
            </p>
            <div style={{ 
              marginTop: '0.5rem', 
              width: '100%', 
              height: '8px', 
              background: '#e0e0e0', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${(progress.current / progress.total) * 100}%`, 
                height: '100%', 
                background: '#667eea',
                transition: 'width 0.3s ease'
              }}></div>
            </div>
          </div>
        )}

        {error && (
          <div className="result-card result-failure" style={{ marginTop: '1rem' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {results && (
              <div style={{ marginTop: '2rem' }}>
                <div
                  className={`result-card ${
                    overallStatus === 'success'
                      ? 'result-success'
                      : overallStatus === 'partial'
                      ? 'result-pending'
                      : 'result-failure'
                  }`}
                  style={{ marginBottom: '1.5rem' }}
                >
                  <h2 style={{ marginBottom: '0.5rem' }}>
                    Scan Results for {url}
                  </h2>
                  <p>
                    <strong>
                      {results.filter(r => r.passed).length} of {results.length} rules passed
                    </strong>
                  </p>
                </div>

                <h3 style={{ marginBottom: '1rem', color: '#333' }}>Detailed Results:</h3>
                {results.map((result) => (
                  <div
                    key={result.ruleId}
                    className={`result-card ${
                      result.passed ? 'result-success' : 'result-failure'
                    }`}
                    style={{ marginBottom: '1rem' }}
                  >
                    <h4 style={{ marginBottom: '0.5rem' }}>
                      {result.ruleTitle} - {result.passed ? '✓ Passed' : '✗ Failed'}
                    </h4>
                    <div style={{ 
                      color: '#666', 
                      lineHeight: '1.6',
                      padding: '0.75rem',
                      background: result.passed ? '#f0f9ff' : '#fff5f5',
                      borderRadius: '6px',
                      borderLeft: `3px solid ${result.passed ? '#10b981' : '#ef4444'}`
                    }}>
                      <strong style={{ color: result.passed ? '#059669' : '#dc2626', display: 'block', marginBottom: '0.5rem' }}>
                        {result.passed ? '✓ Why it Passed:' : '✗ Why it Failed:'}
                      </strong>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{result.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  )
}

