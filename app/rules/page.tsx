"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { z } from "zod";
import { toast } from "react-toastify";
import { usePathname } from "next/navigation";
import { Import, Trash2, Pencil, CircleX } from "lucide-react";

interface Rule {
  id: string;
  title: string;
  description: string;
}

// Zod schemas for validation
const RuleTitleSchema = z
  .string()
  .min(1, "Rule title is required")
  .max(200, "Rule title must be less than 200 characters")
  .trim();

const RuleDescriptionSchema = z
  .string()
  .min(1, "Rule description is required")
  .trim();

const RuleSchema = z.object({
  id: z.string().min(1),
  title: RuleTitleSchema,
  description: RuleDescriptionSchema,
});

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [deleteType, setDeleteType] = useState<"single" | "all">("single");
  const [showImportModal, setShowImportModal] = useState(false);
  const [predefinedRuleIds, setPredefinedRuleIds] = useState<Set<string>>(
    new Set()
  );
  const pathname = usePathname();

  const linkStyle = (path: string) =>
    `px-6 py-2 rounded-lg text-lg font-medium transition
     ${
       pathname === path
         ? "bg-indigo-500 text-white shadow-md"
         : "text-indigo-500 hover:bg-indigo-100"
     }`;

  useEffect(() => {
    loadPredefinedRuleIds();
    loadRules();
  }, []);

  const loadPredefinedRuleIds = async () => {
    try {
      const response = await fetch("/api/rules");
      if (response.ok) {
        const data = await response.json();
        if (data.rules && data.rules.length > 0) {
          const ids = data.rules.map((r: Rule) => r.id);
          setPredefinedRuleIds(new Set(ids));
        }
      }
    } catch (error) {
      console.error("Error loading predefined rule IDs:", error);
    }
  };

  const loadRules = async () => {
    const stored = localStorage.getItem("websiteRules");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Validate loaded rules with Zod
        const validatedRules = z.array(RuleSchema).parse(parsed);
        setRules(validatedRules);
      } catch (error) {
        console.error("Error loading rules:", error);
        // If validation fails, clear invalid data
        localStorage.removeItem("websiteRules");
        setRules([]);
      }
    } else {
      // If localStorage is empty, load from JSON file
      try {
        const response = await fetch("/api/rules");
        if (response.ok) {
          const data = await response.json();
          if (data.rules && data.rules.length > 0) {
            const validatedRules = z.array(RuleSchema).parse(data.rules);
            setRules(validatedRules);
            localStorage.setItem(
              "websiteRules",
              JSON.stringify(validatedRules)
            );
            toast.success(
              `Loaded ${validatedRules.length} predefined rules from JSON file!`
            );
          }
        }
      } catch (error) {
        console.error("Error loading rules from JSON:", error);
      }
    }
  };

  const loadPredefinedRules = (): Rule[] => {
    const stored = localStorage.getItem("predefinedRules");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const validatedRules = z.array(RuleSchema).parse(parsed);
        return validatedRules;
      } catch (error) {
        console.error("Error loading predefined rules:", error);
        return [];
      }
    }
    return [];
  };

  const savePredefinedRule = (rule: Rule) => {
    const existingPredefined = loadPredefinedRules();
    // Check if rule already exists (by title)
    const exists = existingPredefined.some((r) => r.title === rule.title);
    if (!exists) {
      const updated = [...existingPredefined, rule];
      localStorage.setItem("predefinedRules", JSON.stringify(updated));
    } else {
      // Update existing rule
      const updated = existingPredefined.map((r) =>
        r.title === rule.title ? rule : r
      );
      localStorage.setItem("predefinedRules", JSON.stringify(updated));
    }
  };

  const removePredefinedRule = (ruleId: string) => {
    const existingPredefined = loadPredefinedRules();
    const updated = existingPredefined.filter((r) => r.id !== ruleId);
    localStorage.setItem("predefinedRules", JSON.stringify(updated));
  };

  const saveRules = async (newRules: Rule[]) => {
    localStorage.setItem("websiteRules", JSON.stringify(newRules));
    setRules(newRules);

    // Also save to JSON file via API
    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rules: newRules }),
      });

      if (!response.ok) {
        console.error("Failed to save rules to JSON file");
      }
    } catch (error) {
      console.error("Error saving rules to JSON file:", error);
    }
  };

  const validateTitle = (value: string) => {
    try {
      RuleTitleSchema.parse(value);
      setTitleError(null);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        setTitleError(error.errors[0]?.message || "Invalid title");
        return false;
      }
      return false;
    }
  };

  const validateDescription = (value: string) => {
    try {
      RuleDescriptionSchema.parse(value);
      setDescriptionError(null);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        setDescriptionError(error.errors[0]?.message || "Invalid description");
        return false;
      }
      return false;
    }
  };

  const handleAdd = async () => {
    const isTitleValid = validateTitle(title);
    const isDescriptionValid = validateDescription(description);

    if (!isTitleValid || !isDescriptionValid) {
      return;
    }

    try {
      // Validate with Zod
      const validatedTitle = RuleTitleSchema.parse(title);
      const validatedDescription = RuleDescriptionSchema.parse(description);

      const newRule: Rule = {
        id: Date.now().toString(),
        title: validatedTitle,
        description: validatedDescription,
      };

      await saveRules([...rules, newRule]);
      // Also save to predefined rules for future import
      savePredefinedRule(newRule);
      setTitle("");
      setDescription("");
      setTitleError(null);
      setDescriptionError(null);
      toast.success("Rule added successfully and saved to JSON file!");
    } catch (error) {
      // This should not happen as we validated above, but just in case
      console.error("Unexpected error:", error);
      toast.error("Failed to add rule. Please try again.");
    }
  };

  const handleEdit = (id: string) => {
    const rule = rules.find((r: Rule) => r.id === id);
    if (rule) {
      setTitle(rule.title);
      setDescription(rule.description);
      setEditingId(id);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;

    const isTitleValid = validateTitle(title);
    const isDescriptionValid = validateDescription(description);

    if (!isTitleValid || !isDescriptionValid) {
      return;
    }

    try {
      // Validate with Zod
      const validatedTitle = RuleTitleSchema.parse(title);
      const validatedDescription = RuleDescriptionSchema.parse(description);

      const updatedRules = rules.map((rule: Rule) =>
        rule.id === editingId
          ? {
              ...rule,
              title: validatedTitle,
              description: validatedDescription,
            }
          : rule
      );

      await saveRules(updatedRules);
      // Also update in predefined rules
      const updatedRule = updatedRules.find((r) => r.id === editingId);
      if (updatedRule) {
        savePredefinedRule(updatedRule);
      }
      setTitle("");
      setDescription("");
      setEditingId(null);
      setTitleError(null);
      setDescriptionError(null);
      toast.success("Rule updated successfully and saved to JSON file!");
    } catch (error) {
      // This should not happen as we validated above, but just in case
      console.error("Unexpected error:", error);
      toast.error("Failed to update rule. Please try again.");
    }
  };

  const handleDelete = (id: string) => {
    // Check if it's a predefined rule - show error directly without modal
    if (predefinedRuleIds.has(id)) {
      toast.error("Predefined rules cannot be deleted!");
      return;
    }

    setDeleteRuleId(id);
    setDeleteType("single");
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (deleteType === "all") {
      await saveRules([]);
      localStorage.removeItem("predefinedRules");
      toast.success("All rules have been successfully deleted!");
    } else if (deleteRuleId) {
      const deletedRule = rules.find((r) => r.id === deleteRuleId);
      await saveRules(rules.filter((rule: Rule) => rule.id !== deleteRuleId));
      // Also remove from predefined rules
      removePredefinedRule(deleteRuleId);
      toast.success(`Rule "${deletedRule?.title}" deleted successfully!`);
    }
    setShowDeleteModal(false);
    setDeleteRuleId(null);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setDeleteRuleId(null);
  };

  const handleCancel = () => {
    setTitle("");
    setDescription("");
    setEditingId(null);
    setTitleError(null);
    setDescriptionError(null);
  };

  const handleDeleteAll = () => {
    if (rules.length === 0) {
      toast.error("No rules available to delete!");
      return;
    }

    // Check if any predefined rules exist - show error directly without modal
    const predefinedRulesInList = rules.filter((r) =>
      predefinedRuleIds.has(r.id)
    );
    if (predefinedRulesInList.length > 0) {
      toast.error("Predefined rules cannot be deleted!");
      return;
    }

    setDeleteType("all");
    setShowDeleteModal(true);
  };

  const getPredefinedRules = async (): Promise<Rule[]> => {
    try {
      const response = await fetch("/api/rules");
      if (response.ok) {
        const data = await response.json();
        if (data.rules && data.rules.length > 0) {
          const validatedRules = z.array(RuleSchema).parse(data.rules);
          return validatedRules;
        }
      }
    } catch (error) {
      console.error("Error loading predefined rules from JSON:", error);
    }
    return [];
  };

  const handleImportPredefined = () => {
    setShowImportModal(true);
  };

  const confirmImport = async () => {
    const predefinedRules = await getPredefinedRules();
    const existingIds = new Set(rules.map((r) => r.title));
    const newRules = predefinedRules.filter((r) => !existingIds.has(r.title));

    if (newRules.length === 0) {
      toast.error("These rules already exist!");
    } else {
      await saveRules([...rules, ...newRules]);
      toast.success(
        `${newRules.length} predefined rules have been successfully imported!`
      );
    }

    setShowImportModal(false);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
  };

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

      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg px-6 py-4 mt-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800 my-4">
            Manage Rules
          </h1>
          <button
            className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-gray-500 hover:bg-gray-600
            transition cursor-pointer"
            onClick={handleImportPredefined}
            title="Import Predefined Rules"
          >
            <span className="inline-flex items-center gap-2">
              <Import size={18} />
              Import Predefined Rules
            </span>
          </button>
        </div>

        <div className="mb-4 px-4 py-3 bg-[#f0f7ff] rounded-lg border-l-4 border-[#667eea]">
          <p className="text-gray-600 text-sm">
            <strong>💡 Tip:</strong> Rules are automatically loaded from the
            JSON file when you first open the website. Use "Import Predefined
            Rules" to add them to your existing rules. New rules you add will be
            automatically saved to the JSON file.
          </p>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Rule Title
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border rounded-lg text-sm text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#667eea] focus:border-[#667eea]"
            value={title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setTitle(e.target.value);
              if (titleError) {
                validateTitle(e.target.value);
              }
            }}
            onBlur={() => validateTitle(title)}
            placeholder="e.g., Must have privacy policy"
            style={{
              borderColor: titleError ? "#dc3545" : undefined,
            }}
          />
          {titleError && (
            <p className="text-red-500 text-sm mt-1 mb-0">
              {titleError}
            </p>
          )}
        </div>

        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Rule Description
          </label>
          <textarea
            className="w-full px-3 py-2 border rounded-lg text-sm text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#667eea] focus:border-[#667eea]"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setDescription(e.target.value);
              if (descriptionError) {
                validateDescription(e.target.value);
              }
            }}
            onBlur={() => validateDescription(description)}
            placeholder="Describe what this rule checks for..."
            style={{
              borderColor: descriptionError ? "#dc3545" : undefined,
            }}
          />
          {descriptionError && (
            <p className="text-red-500 text-sm mt-1 mb-0"
            >
              {descriptionError}
            </p>
          )}
        </div>

        <div className="flex gap-4">
          {editingId ? (
            <>
              <button
                className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-gray-500 hover:bg-gray-600
            transition cursor-pointer"
                onClick={handleUpdate}
              >
                Update Rule
              </button>
              <button
                className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-gray-500 hover:bg-gray-600
            transition cursor-pointer"
                onClick={handleCancel}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-gray-500 hover:bg-gray-600
            transition cursor-pointer"
              onClick={handleAdd}
            >
              Add Rule
            </button>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg px-6 py-4 mt-4">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-bold text-gray-800 my-4">
            Your Rules ({rules.length})
          </h2>
          {rules.length > 0 && (
            <button
              className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-red-500 hover:bg-red-600
            transition cursor-pointer"
              onClick={handleDeleteAll}
              title="Delete All Rules"
            >
              <Trash2 size={18} /> Delete All Rules
            </button>
          )}
        </div>

        {rules.length === 0 ? (
          <div className="text-center py-16 px-8">
            <p>No rules defined yet. Add your first rule above!</p>
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-white rounded-xl shadow-lg px-6 py-4 mt-4"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                {rule.title}
              </h3>
              <p className="text-gray-600 text-sm mb-4">{rule.description}</p>
              <div className="flex gap-2 mt-4">
                <button
                  className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-gray-500 hover:bg-gray-600
            transition cursor-pointer"
                  onClick={() => handleEdit(rule.id)}
                >
                  <Pencil size={18} /> Edit
                </button>
                <button
                  className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
            bg-red-500 hover:bg-red-600
            transition cursor-pointer"
                  title="Delete Rule"
                  onClick={() => handleDelete(rule.id)}
                >
                  <Trash2 size={18} />
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
          className="fixed top-0 right-0 left-0 bottom-0 z-50 flex justify-center items-center bg-black bg-opacity-50 p-4"
          onClick={closeDeleteModal}
        >
          <div
            className="relative w-full max-w-md max-h-screen bg-white rounded-lg shadow-lg p-4 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                {deleteType === "all" ? "Delete All Rules" : "Delete Rule"}
              </h3>
              <button
                type="button"
                onClick={closeDeleteModal}
                className="bg-transparent border-none text-gray-600 text-sm w-8 h-8 rounded-lg inline-flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-gray-100 hover:text-gray-800"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6b7280";
                }}
              >
                <CircleX size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="mb-6">
              <p className="text-gray-600 text-sm">
                {deleteType === "all" ? (
                  <>
                    Are you sure? You Want to delete All{" "}
                    <strong>{rules.length} rules</strong>.
                  </>
                ) : (
                  <>
                    Are you sure you want to delete this rule?
                    {deleteRuleId && (
                      <>
                        <br />
                        <strong
                          className="text-gray-800 mt-1 block"
                        >
                          Rule:{" "}
                          {rules.find((r) => r.id === deleteRuleId)?.title}
                        </strong>
                      </>
                    )}
                    <br />
                    <span className="mt-1 block">
                      This action cannot be undone.
                    </span>
                  </>
                )}
              </p>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={closeDeleteModal}
                className="py-2 px-6 rounded-lg font-medium text-sm text-gray-600 inline-flex items-center gap-2
                bg-gray-100 hover:bg-gray-200
                transition cursor-pointer"
                title="Cancel"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#e5e7eb";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#4b5563";
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="py-2 px-6 rounded-lg font-medium text-sm text-white inline-flex items-center gap-2
                bg-linear-to-r from-[#667eea] to-[#764ba2]
                transition cursor-pointer"
                title="Delete"
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.9";
                  e.currentTarget.style.transform = "scale(1.02)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.transform = "scale(1)";
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
          className="fixed inset-0 bg-black/50 z-40  flex items-center justify-center  bg-opacity-50 p-4 backdrop-blur-sm"
          onClick={closeImportModal}
        >
          <div
            className="relative w-full max-w-md max-h-[90vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">
                Import Predefined Rules
              </h3>
              <button
                type="button"
                onClick={closeImportModal}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                aria-label="Close modal"
              >
                <CircleX size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-6 flex-1 overflow-y-auto">
              <div className="mb-4 p-4 bg-blue-50 rounded-lg border-l-4 border-blue-500">
                <p className="text-gray-700 text-sm leading-relaxed m-0">
                  <strong className="text-blue-800">Import Rules:</strong> Do you want to import predefined rules from the JSON file? They will be added to your existing rules. Duplicate rules will be automatically skipped.
                </p>
              </div>
              <div className="mt-4">
                <p className="text-gray-600 text-sm mb-2">
                  <strong>What happens:</strong>
                </p>
                <ul className="text-gray-600 text-sm space-y-2 list-disc list-inside ml-2">
                  <li>Rules from the JSON file will be loaded</li>
                  <li>Only new rules (not already in your list) will be added</li>
                  <li>Your existing rules will remain unchanged</li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={closeImportModal}
                className="px-6 py-2.5 rounded-lg font-medium text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm"
                title="Cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmImport}
                className="px-6 py-2.5 rounded-lg font-medium text-sm text-white bg-linear-to-r from-[#667eea] to-[#764ba2] hover:from-[#5568d3] hover:to-[#653a8f] transition-all duration-200 shadow-md hover:shadow-lg"
                title="Import Rules"
              >
                Import Rules
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}