'use client'

import Link from 'next/link'
import { useState,useEffect } from 'react'
import { Cog, Check } from 'lucide-react'

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1)
  const [mounted, setMounted] = useState(0)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedRevenue, setSelectedRevenue] = useState<string | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [rulesCount, setRulesCount] = useState(0)
  const [showAnalyze, setShowAnalyze] = useState(false)

  const totalSteps = 3

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const analysisSteps = [
    'Crawling your product page structure',
    'Analyzing user experience and interface',
    'Analyzing content and copy effectiveness',
    'Generating conversion recommendations',
    'Finalizing your audit report',
  ]

  useEffect(() => {
    if (!showAnalyze) {
      setMounted(0)
      return
    }

    // Reset to 0 when analyze starts
    setMounted(0)
    
    const interval = setInterval(() => {
      setMounted((prev) => {
        if (prev < analysisSteps.length - 1) {
          return prev + 1
        }
        clearInterval(interval)
        return prev
      })
    }, 2000)

    return () => clearInterval(interval)
  }, [showAnalyze])

  const progressPercentage = (currentStep / totalSteps) * 100

  return (
    <main className="min-h-screen flex items-center justify-center md:px-4 bg-[#FDFDFD]">
      <div className=" w-full max-w-[720px] min-h-screen md:min-h-fit md:rounded-2xl md:shadow-xl/10 md:border md: border-[#E4E4E7] overflow-hidden">
        {/* Header with Logo and Progress */}
        {!showAnalyze && (
        <div className="px-6 my-3">
          {/* Logo */}
          <div className="text-center my-4">
            <h1 className="text-2xl font-bold text-gray-900">
              <span className="font-bold">CXO</span>
              <span className="font-normal text-gray-600">studio</span>
        </h1>
          </div>
          
          {/* Back Button and Progress Bar */}
          <div className="flex items-center gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="w-10 h-10 rounded-lg bg-white border-[1px] border-[#E4E4E7] flex items-center justify-center hover:bg-gray-200 transition shrink-0 cursor-pointer"
              >
                <span className="text-gray-700 text-xl">‹</span>
              </button>
            )}
            {/* Progress Bar */}
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-[#757575] h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>
        </div>
        )}
        {/* Step Content */}
        <div className="my-[33px] mx-[16px]">
          {!showAnalyze ? (
            <>
              {currentStep === 1 && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 text-center">
                    What's your biggest challenge right now?
                  </h2>
                  <div className="mt-[43px]">
                    <button
                      onClick={() => setSelectedRevenue('low-conversion-rates')}
                      className={`w-full bg-white rounded-4xl p-[18px] my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === 'low-conversion-rates'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        Low conversion rates
                      </p>
                    </button>
                    <button
                      onClick={() => setSelectedRevenue('low-average-order-value')}
                      className={`w-full bg-white rounded-4xl p-[18px] my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === 'low-average-order-value'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        Low average order value
                      </p>
                    </button>
                    <button
                      onClick={() => setSelectedRevenue('both')}
                      className={`w-full bg-white rounded-4xl p-[18px] my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === 'both'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        Both
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="mt-[33px]">
                  <h2 className="text-3xl font-bold text-gray-900 text-center px-4">
                    What's your average online revenue?
                  </h2>
                  <div className="mt-[43px]">
                    <button
                      onClick={() => setSelectedRevenue('under-10k')}
                      className={`w-full bg-white rounded-4xl p-4 my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === 'under-10k'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        Under €10,000 / month
                      </p>
                    </button>
                    <button
                      onClick={() => setSelectedRevenue('10k-50k')}
                      className={`w-full bg-white rounded-4xl p-4 my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === '10k-50k'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        €10,000–€50,000 / month
                      </p>
                    </button>
                    <button
                      onClick={() => setSelectedRevenue('50k-100k')}
                      className={`w-full bg-white rounded-4xl p-4 my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === '50k-100k'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        €50,000–€100,000 / month
                      </p>
                    </button>
                    <button
                      onClick={() => setSelectedRevenue('over-100k')}
                      className={`w-full bg-white rounded-4xl p-4 my-[13px] text-center border transition cursor-pointer ${
                        selectedRevenue === 'over-100k'
                          ? 'border-blue-500 border-2'
                          : 'border-[#E4E4E7]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-black">
                        Over €100,000 / month
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="my-[33px]">
                  <div>
                    <h2 className="text-[33px] leading-[40px] font-bold text-[#757575] text-center">
                      You're almost done!
                    </h2>
                    <h2 className="text-[33px] leading-[40px] font-bold text-black text-center">
                      Let's finish your audit
                    </h2>
                  </div>
                  <div className="mt-8">
                    <div>
                      <label className="block text-sm font-semibold text-black mb-3">
                        Website URL:
                      </label>
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="Enter the URL of your main product page"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
                      />
                    </div>
                    <div className="relative mt-[18px]">
                      <label className="block text-sm font-semibold text-black mb-3">
                        Email address:
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your best email address"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Continue Button or Access Results Button */}
              {currentStep < totalSteps ? (
                <div className="mt-8">
                  <button
                    onClick={handleNext}
                    className="w-full py-[18px] rounded-xl transition font-semibold text-sm text-center bg-black text-white hover:bg-gray-800 cursor-pointer"
                  >
                    Continue ›
                  </button>
                </div>
              ) : (
                <div className="mt-8">
                  <button
                    onClick={() => {
                      if (websiteUrl && email) {
                        setShowAnalyze(true)
                      }
                    }}
                    disabled={!websiteUrl || !email}
                    className={`w-full py-[18px] rounded-xl transition font-semibold text-sm text-center cursor-pointer ${
                      !websiteUrl || !email
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-black text-white hover:bg-gray-800'
                    }`}
                  >
                    Access my results ›
                  </button>
                </div>
              )}
            </>
          ) : (
           <>
            <h2 className="text-3xl md:text-4xl font-bold text-[#919191] text-center mb-8 flex items-center justify-center">
              <span>Analyzing your URL</span>
                <span className="loader ml-2">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
          </h2>

      {/* Phone */}
      <div className="flex justify-center mb-8">
        <img src="/IPhone.png" className="w-full max-w-xs drop-shadow-2xl" />
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {analysisSteps.map((title, index : number) => {
          const isCompleted = index < mounted
          const isActive = index === mounted
          const shouldAnimateOut = isCompleted && mounted > index + 1

          return (
            <div
              key={index}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-700 ${
                isCompleted
                  ? `border-green-500 ${shouldAnimateOut ? 'step-completed slide-out-right' : ''}`
                  : isActive
                  ? 'border-black'
                  : 'border-gray-300'
              }`}
            >
              {isCompleted ? (
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              ) : (
                <Cog className={`w-6 h-6 ${isActive ? 'text-black' : 'text-gray-400'}`} />
              )}

              <span
                className={`${
                  isActive ? 'text-black font-medium' : 'text-gray-400'
                } ${isCompleted ? 'line-through' : ''}`}
              >
                {title}
              </span>
            </div>
          )
        })}
      </div>
           </>
          )}
        </div>

        {/* Social Proof Footer - Only show when not analyzing */}
        {!showAnalyze && (
          <div className="my-[18px] border-t border-gray-100">
            <div className="flex justify-center gap-3">
              {/* Left: Profile Images */}
              <div className="flex -space-x-2">
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_first.png" alt="user" className="w-full h-full object-cover" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_second.png" alt="user" className="w-full h-full object-cover" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_third.png" alt="user" className="w-full h-full object-cover" />
                </div>
              </div>
              
              {/* Right: Stars and Text */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className="text-orange-400 text-lg">★</span>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  Trusted by e-commerce founders
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

