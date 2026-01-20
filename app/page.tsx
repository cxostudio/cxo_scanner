'use client'


import { useState,useEffect } from 'react'
import { Cog, Check } from 'lucide-react'
import SelectButton from './components/SelectButton'

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1)
  const [mounted, setMounted] = useState(0)
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(null)
  const [selectedRevenue, setSelectedRevenue] = useState<string | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [showAnalyze, setShowAnalyze] = useState(false)

  const totalSteps = 3

  // Step 1 buttons data
  const step1Buttons = [
    { value: 'low-conversion-rates', label: 'Low conversion rates' },
    { value: 'low-average-order-value', label: 'Low average order value' },
    { value: 'both', label: 'Both' },
  ]

  // Step 2 buttons data
  const step2Buttons = [
    { value: 'under-10k', label: 'Under €10,000 / month' },
    { value: '10k-50k', label: '€10,000–€50,000 / month' },
    { value: '50k-100k', label: '€50,000–€100,000 / month' },
    { value: 'over-100k', label: 'Over €100,000 / month' },
  ]

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

  // Check if current step has required value
  const isStepValid = () => {
    if (currentStep === 1) {
      return selectedChallenge !== null
    }
    if (currentStep === 2) {
      return selectedRevenue !== null
    }
    if (currentStep === 3) {
      return websiteUrl.trim() !== '' && email.trim() !== ''
    }
    return false
  }

  return (
    <main className=" flex items-center justify-center md:px-4 bg-[#FDFDFD]">
      <div className="max-w-[400px] mx-[16px]">
        {/* Header with Logo and Progress */}
        {!showAnalyze && (
        <>
          {/* Logo */}
          <div className="text-center my-[34px]">
          <img src="/cxo_logo.png" alt="logo" className="mx-auto object-cover w-[117.54]  h-[19.95] object-cover" />
          </div>
          
          {/* Back Button and Progress Bar */}
          <div className="flex items-center gap-3">

              <button
                onClick={handleBack}
                className="w-[35px] h-[35px] rounded-lg bg-white border border-[#E4E4E7] flex items-center justify-center hover:bg-gray-200 transition shrink-0 cursor-pointer"
              >
                <span className="text-gray-700 text-xl">‹</span>
              </button>
            {/* Progress Bar */}
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-[#757575] h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>
        </>
        )}
        {/* Step Content */}
        <div className="my-[35px] mx-[16px]">
          {!showAnalyze ? (
            <>
              {currentStep === 1 && (
                <div>
                  <h2 className="text-[33px] leading-[48px] font-bold text-gray-[#09090B] text-center">
                    What's your biggest challenge right now?
                  </h2>
                  <div className="mt-[28px]">
                    {step1Buttons.map((button) => (
                      <SelectButton
                        key={button.value}
                        label={button.label}
                        value={button.value}
                        selectedValue={selectedChallenge}
                        onClick={setSelectedChallenge}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <>
                  <h2 className="text-3xl my-[33px] font-bold text-gray-900 text-center px-4">
                    What's your average online revenue?
                  </h2>
                  <div className="mt-[43px]">
                    {step2Buttons.map((button) => (
                      <SelectButton
                        key={button.value}
                        label={button.label}
                        value={button.value}
                        selectedValue={selectedRevenue}
                        onClick={setSelectedRevenue}
                      />
                    ))}
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <div>
                    <h2 className="text-[33px] leading-[48px] font-bold text-[#757575] text-center">
                      You're almost done!
                    </h2>
                    <h2 className="text-[33px] leading-[48px] font-bold text-black text-center">
                      Let's finish your audit
                    </h2>
                  </div>
                  <div className="mt-[33px]">
                      <label className="block text-sm font-semibold text-black">
                        Website URL:
                      </label>
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="Enter the URL of your main product page"
                        className="w-full mt-[13px] px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
                      />
                    <div className="relative mt-[19px]">
                      <label className="block text-sm font-semibold text-black">
                        Email address:
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your best email address"
                        className="w-full mt-[12px] px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Continue Button or Access Results Button */}
              {currentStep < totalSteps ? (
                <div className="mt-[91px]">
                  <button
                    onClick={handleNext}
                    disabled={!isStepValid()}
                    className={`w-full py-[18px] rounded-xl transition font-semibold text-sm text-center cursor-pointer ${
                      !isStepValid()
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-black text-white hover:bg-gray-800'
                    }`}
                  >
                    Continue ›
                  </button>
                </div>
              ) : (
                <div className="mt-[91px]">
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
      <div className="flex justify-center">
        <img src="/IPhone.png" className="w-[428px] h-[321px] object-cover" />
      </div>

      {/* Steps */}
      <div className="mt-[45px]">
        {analysisSteps.map((title, index : number) => {
          const isCompleted = index < mounted
          const isActive = index === mounted
          const shouldAnimateOut = isCompleted && mounted > index + 1

          return (
            <div
              key={index}
              className={`flex items-center gap-4 p-4 my-[14px] rounded-xl border transition-all duration-700 ${
                isCompleted
                  ? `border-green-500 ${shouldAnimateOut ? 'step-completed slide-out-right' : ''}`
                  : isActive
                  ? 'border-black'
                  : 'border-gray-300'
              }`}
            >
              {isCompleted ? (
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <Check className="w-5 h-5 text-white" />
                </div>
              ) : (
                <Cog className={`w-5 h-5 ${isActive ? 'text-black' : 'text-gray-400'}`} />
              )}

              <span
                className={`${
                  isActive ? 'text-black  font-semibold text-[14.8px] leading-[28.8px]' : 'text-gray-400 font-semibold text-[14.8px] leading-[28.8px]'
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
          <div className="my-[18px]">
            <div className="flex justify-center gap-3">
              {/* Left: Profile Images */}
              <div className="flex -space-x-2">
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_first.png" alt="user" className="w-[40px] h-[40px] object-cover" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_second.png" alt="user" className="w-[40px] h-[40px] object-cover" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_third.png" alt="user" className="w-[40px] h-[40px] object-cover" />
                </div>
              </div>
              
              {/* Right: Stars and Text */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className="text-[#FFB66E] text-lg w-[16px] h-[16px]">★</span>
                  ))}
                </div>
                <p className="text-xs font-semibold text-[#71717A] mt-[4px]">
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

