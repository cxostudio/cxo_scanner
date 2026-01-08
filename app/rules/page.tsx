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

// Zod schemas for validation
const RuleTitleSchema = z.string()
  .min(1, 'Rule title is required')
  .max(200, 'Rule title must be less than 200 characters')
  .trim()

const RuleDescriptionSchema = z.string()
  .min(1, 'Rule description is required')
  .trim()

const RuleSchema = z.object({
  id: z.string().min(1),
  title: RuleTitleSchema,
  description: RuleDescriptionSchema,
})

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null)
  const [deleteType, setDeleteType] = useState<'single' | 'all'>('single')
  const [showImportModal, setShowImportModal] = useState(false)
  const [predefinedRuleIds, setPredefinedRuleIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadPredefinedRuleIds()
    loadRules()
  }, [])

  const loadPredefinedRuleIds = async () => {
    try {
      const response = await fetch('/api/rules')
      if (response.ok) {
        const data = await response.json()
        if (data.rules && data.rules.length > 0) {
          const ids = data.rules.map((r: Rule) => r.id)
          setPredefinedRuleIds(new Set(ids))
        }
      }
    } catch (error) {
      console.error('Error loading predefined rule IDs:', error)
    }
  }

  const loadRules = async () => {
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
    } else {
      // If localStorage is empty, load from JSON file
      try {
        const response = await fetch('/api/rules')
        if (response.ok) {
          const data = await response.json()
          if (data.rules && data.rules.length > 0) {
            const validatedRules = z.array(RuleSchema).parse(data.rules)
            setRules(validatedRules)
            localStorage.setItem('websiteRules', JSON.stringify(validatedRules))
            toast.success(`Loaded ${validatedRules.length} predefined rules from JSON file!`)
          }
        }
      } catch (error) {
        console.error('Error loading rules from JSON:', error)
      }
    }
  }

  const loadPredefinedRules = (): Rule[] => {
    const stored = localStorage.getItem('predefinedRules')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        const validatedRules = z.array(RuleSchema).parse(parsed)
        return validatedRules
      } catch (error) {
        console.error('Error loading predefined rules:', error)
        return []
      }
    }
    return []
  }

  const savePredefinedRule = (rule: Rule) => {
    const existingPredefined = loadPredefinedRules()
    // Check if rule already exists (by title)
    const exists = existingPredefined.some(r => r.title === rule.title)
    if (!exists) {
      const updated = [...existingPredefined, rule]
      localStorage.setItem('predefinedRules', JSON.stringify(updated))
    } else {
      // Update existing rule
      const updated = existingPredefined.map(r => r.title === rule.title ? rule : r)
      localStorage.setItem('predefinedRules', JSON.stringify(updated))
    }
  }

  const removePredefinedRule = (ruleId: string) => {
    const existingPredefined = loadPredefinedRules()
    const updated = existingPredefined.filter(r => r.id !== ruleId)
    localStorage.setItem('predefinedRules', JSON.stringify(updated))
  }

  const saveRules = async (newRules: Rule[]) => {
    localStorage.setItem('websiteRules', JSON.stringify(newRules))
    setRules(newRules)
    
    // Also save to JSON file via API
    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rules: newRules }),
      })
      
      if (!response.ok) {
        console.error('Failed to save rules to JSON file')
      }
    } catch (error) {
      console.error('Error saving rules to JSON file:', error)
    }
  }

  const validateTitle = (value: string) => {
    try {
      RuleTitleSchema.parse(value)
      setTitleError(null)
      return true
    } catch (error) {
      if (error instanceof z.ZodError) {
        setTitleError(error.errors[0]?.message || 'Invalid title')
        return false
      }
      return false
    }
  }

  const validateDescription = (value: string) => {
    try {
      RuleDescriptionSchema.parse(value)
      setDescriptionError(null)
      return true
    } catch (error) {
      if (error instanceof z.ZodError) {
        setDescriptionError(error.errors[0]?.message || 'Invalid description')
        return false
      }
      return false
    }
  }

  const handleAdd = async () => {
    const isTitleValid = validateTitle(title)
    const isDescriptionValid = validateDescription(description)

    if (!isTitleValid || !isDescriptionValid) {
      return
    }

    try {
      // Validate with Zod
      const validatedTitle = RuleTitleSchema.parse(title)
      const validatedDescription = RuleDescriptionSchema.parse(description)

    const newRule: Rule = {
      id: Date.now().toString(),
        title: validatedTitle,
        description: validatedDescription,
    }

    await saveRules([...rules, newRule])
    // Also save to predefined rules for future import
    savePredefinedRule(newRule)
    setTitle('')
    setDescription('')
      setTitleError(null)
      setDescriptionError(null)
      toast.success('Rule added successfully and saved to JSON file!')
    } catch (error) {
      // This should not happen as we validated above, but just in case
      console.error('Unexpected error:', error)
      toast.error('Failed to add rule. Please try again.')
    }
  }

  const handleEdit = (id: string) => {
    const rule = rules.find((r: Rule) => r.id === id)
    if (rule) {
      setTitle(rule.title)
      setDescription(rule.description)
      setEditingId(id)
    }
  }

  const handleUpdate = async () => {
    if (!editingId) return

    const isTitleValid = validateTitle(title)
    const isDescriptionValid = validateDescription(description)

    if (!isTitleValid || !isDescriptionValid) {
      return
    }

    try {
      // Validate with Zod
      const validatedTitle = RuleTitleSchema.parse(title)
      const validatedDescription = RuleDescriptionSchema.parse(description)

    const updatedRules = rules.map((rule: Rule) =>
      rule.id === editingId
          ? { ...rule, title: validatedTitle, description: validatedDescription }
        : rule
    )

    await saveRules(updatedRules)
    // Also update in predefined rules
    const updatedRule = updatedRules.find(r => r.id === editingId)
    if (updatedRule) {
      savePredefinedRule(updatedRule)
    }
    setTitle('')
    setDescription('')
    setEditingId(null)
      setTitleError(null)
      setDescriptionError(null)
      toast.success('Rule updated successfully and saved to JSON file!')
    } catch (error) {
      // This should not happen as we validated above, but just in case
      console.error('Unexpected error:', error)
      toast.error('Failed to update rule. Please try again.')
    }
  }

  const handleDelete = (id: string) => {
    // Check if it's a predefined rule - show error directly without modal
    if (predefinedRuleIds.has(id)) {
      toast.error('Predefined rules cannot be deleted!')
      return
    }
    
    setDeleteRuleId(id)
    setDeleteType('single')
    setShowDeleteModal(true)
  }

  const confirmDelete = async () => {
    if (deleteType === 'all') {
      await saveRules([])
      localStorage.removeItem('predefinedRules')
      toast.success('All rules have been successfully deleted!')
    } else if (deleteRuleId) {
      const deletedRule = rules.find(r => r.id === deleteRuleId)
      await saveRules(rules.filter((rule: Rule) => rule.id !== deleteRuleId))
      // Also remove from predefined rules
      removePredefinedRule(deleteRuleId)
      toast.success(`Rule "${deletedRule?.title}" deleted successfully!`)
    }
    setShowDeleteModal(false)
    setDeleteRuleId(null)
    }

  const closeDeleteModal = () => {
    setShowDeleteModal(false)
    setDeleteRuleId(null)
  }

  const handleCancel = () => {
    setTitle('')
    setDescription('')
    setEditingId(null)
    setTitleError(null)
    setDescriptionError(null)
  }

  const handleDeleteAll = () => {
    if (rules.length === 0) {
      toast.error('No rules available to delete!')
      return
    }
    
    // Check if any predefined rules exist - show error directly without modal
    const predefinedRulesInList = rules.filter(r => predefinedRuleIds.has(r.id))
    if (predefinedRulesInList.length > 0) {
      toast.error('Predefined rules cannot be deleted!')
      return
    }
    
    setDeleteType('all')
    setShowDeleteModal(true)
  }

 

  const getPredefinedRules = async (): Promise<Rule[]> => {
    try {
      const response = await fetch('/api/rules')
      if (response.ok) {
        const data = await response.json()
        if (data.rules && data.rules.length > 0) {
          const validatedRules = z.array(RuleSchema).parse(data.rules)
          return validatedRules
        }
      }
    } catch (error) {
      console.error('Error loading predefined rules from JSON:', error)
    }
    return []
  }
  
  const handleImportPredefined = () => {
    setShowImportModal(true)
  }

  const confirmImport = async () => {
    const predefinedRules = await getPredefinedRules()
    const existingIds = new Set(rules.map(r => r.title))
    const newRules = predefinedRules.filter(r => !existingIds.has(r.title))
    
    if (newRules.length === 0) {
      toast.error('These rules already exist!')
    } else {
      await saveRules([...rules, ...newRules])
      toast.success(`${newRules.length} predefined rules have been successfully imported!`)
    }
    
    setShowImportModal(false)
  }


  const closeImportModal = () => {
    setShowImportModal(false)
  }

  return (
    <div className="container">
      <nav className="nav">
        <ul className="nav-links">
          <li><Link href="/" className="nav-link">Home</Link></li>
          <li><Link href="/rules" className="nav-link active">Rules</Link></li>
          <li><Link href="/scanner" className="nav-link">Scanner</Link></li>
        </ul>
      </nav>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h1 style={{ margin: 0, color: '#333' }}>Manage Rules</h1>
          <button 
            className="btn btn-secondary" 
            onClick={handleImportPredefined}
            style={{ fontSize: '0.9rem', padding: '0.75rem 1.5rem' }}
          >
            📥 Import Predefined Rules
          </button>
        </div>

        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f0f7ff', borderRadius: '8px', borderLeft: '4px solid #667eea' }}>
          <p style={{ margin: 0, color: '#666', fontSize: '0.95rem' }}>
            <strong>💡 Tip:</strong> Rules are automatically loaded from the JSON file when you first open the website. Use "Import Predefined Rules" to add them to your existing rules. New rules you add will be automatically saved to the JSON file.
          </p>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <label className="label">Rule Title</label>
          <input
            type="text"
            className="input"
                value={title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setTitle(e.target.value)
              if (titleError) {
                validateTitle(e.target.value)
              }
            }}
            onBlur={() => validateTitle(title)}
                placeholder="e.g., Must have privacy policy"
            style={{
              borderColor: titleError ? '#dc3545' : undefined
            }}
          />
          {titleError && (
            <p style={{ color: '#dc3545', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: 0 }}>
              {titleError}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <label className="label">Rule Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setDescription(e.target.value)
              if (descriptionError) {
                validateDescription(e.target.value)
              }
            }}
            onBlur={() => validateDescription(description)}
            placeholder="Describe what this rule checks for..."
            style={{
              borderColor: descriptionError ? '#dc3545' : undefined
            }}
          />
          {descriptionError && (
            <p style={{ color: '#dc3545', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: 0 }}>
              {descriptionError}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          {editingId ? (
            <>
              <button className="btn" onClick={handleUpdate}>
                Update Rule
              </button>
              <button className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn" onClick={handleAdd}>
              Add Rule
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, color: '#333' }}>Your Rules ({rules.length})</h2>
          {rules.length > 0 && (
            <button
              className="btn btn-danger"
              onClick={handleDeleteAll}
              style={{ 
                fontSize: '0.9rem', 
                padding: '0.75rem 1.5rem',
                background: '#dc3545',
                border: 'none'
              }}
            >
              🗑️ Delete All Rules
            </button>
          )}
        </div>

        {rules.length === 0 ? (
          <div className="empty-state">
            <p>No rules defined yet. Add your first rule above!</p>
          </div>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className="rule-item">
              <h3>{rule.title}</h3>
              <p>{rule.description}</p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                  onClick={() => handleEdit(rule.id)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                  onClick={() => handleDelete(rule.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            left: 0,
            bottom: 0,
            zIndex: 50,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            padding: '1rem'
          }}
          onClick={closeDeleteModal}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '32rem',
              maxHeight: 'calc(100vh - 2rem)',
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              padding: '1.5rem',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #e5e7eb',
                paddingBottom: '1rem',
                marginBottom: '1rem'
              }}
            >
              <h3
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 500,
                  color: '#111827',
                  margin: 0
                }}
              >
                {deleteType === 'all' ? 'Delete All Rules' : 'Delete Rule'}
              </h3>
              <button
                type="button"
                onClick={closeDeleteModal}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '0.875rem',
                  width: '2.25rem',
                  height: '2.25rem',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                  e.currentTarget.style.color = '#111827'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = '#6b7280'
                }}
              >
                <svg
                  style={{ width: '1.25rem', height: '1.25rem' }}
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18 17.94 6M18 18 6.06 6"
                  />
                </svg>
                <span style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>
                  Close modal
                </span>
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ color: '#4b5563', lineHeight: '1.75', margin: 0 }}>
                {deleteType === 'all' ? (
                  <>
                    Are you sure? You Want to delete All <strong>{rules.length} rules</strong>.
                  </>
                ) : (
                  <>
                    Are you sure you want to delete this rule?
                    {deleteRuleId && (
                      <>
                        <br />
                        <strong style={{ color: '#111827', marginTop: '0.5rem', display: 'block' }}>
                          Rule: {rules.find(r => r.id === deleteRuleId)?.title}
                        </strong>
                      </>
                    )}
                    <br />
                    <span style={{ marginTop: '0.5rem', display: 'block' }}>
                      This action cannot be undone.
                    </span>
                  </>
                )}
              </p>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '1rem',
                gap: '1rem',
                justifyContent: 'flex-end'
              }}
            >
              <button
                type="button"
                onClick={closeDeleteModal}
                style={{
                  color: '#4b5563',
                  backgroundColor: '#f3f4f6',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  padding: '0.625rem 1rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#e5e7eb'
                  e.currentTarget.style.color = '#111827'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                  e.currentTarget.style.color = '#4b5563'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                style={{
                  color: 'white',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  padding: '0.625rem 1rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9'
                  e.currentTarget.style.transform = 'scale(1.02)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Predefined Rules Modal */}
      {showImportModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            left: 0,
            bottom: 0,
            zIndex: 50,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            padding: '1rem'
          }}
          onClick={closeImportModal}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '32rem',
              maxHeight: 'calc(100vh - 2rem)',
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              padding: '1.5rem',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #e5e7eb',
                paddingBottom: '1rem',
                marginBottom: '1rem'
              }}
            >
              <h3
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 500,
                  color: '#111827',
                  margin: 0
                }}
              >
                Import Predefined Rules
              </h3>
              <button
                type="button"
                onClick={closeImportModal}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '0.875rem',
                  width: '2.25rem',
                  height: '2.25rem',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                  e.currentTarget.style.color = '#111827'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = '#6b7280'
                }}
              >
                <svg
                  style={{ width: '1.25rem', height: '1.25rem' }}
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18 17.94 6M18 18 6.06 6"
                  />
                </svg>
                <span style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>
                  Close modal
                </span>
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ color: '#4b5563', lineHeight: '1.75', margin: 0 }}>
                Do you want to import predefined rules from the JSON file? 
                They will be added to your existing rules. Duplicate rules will be automatically skipped.
              </p>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '1rem',
                gap: '1rem',
                justifyContent: 'flex-end'
              }}
            >
              <button
                type="button"
                onClick={closeImportModal}
                style={{
                  color: '#4b5563',
                  backgroundColor: '#f3f4f6',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  padding: '0.625rem 1rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#e5e7eb'
                  e.currentTarget.style.color = '#111827'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                  e.currentTarget.style.color = '#4b5563'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmImport}
                style={{
                  color: 'white',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  padding: '0.625rem 1rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9'
                  e.currentTarget.style.transform = 'scale(1.02)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                Import Rules
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

