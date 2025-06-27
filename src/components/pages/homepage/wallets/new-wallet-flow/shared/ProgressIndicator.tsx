import React from "react";
import { Check } from "lucide-react";

interface ProgressIndicatorProps {
  currentStep: 1 | 2 | 3;
  steps?: {
    label: string;
    description?: string;
  }[];
}

export default function ProgressIndicator({ 
  currentStep, 
  steps = [
    { label: "Save", description: "Make wallet invite-ready" },
    { label: "Create", description: "Add signers and finalize wallet" },
    { label: "Ready to use", description: "Send ADA to activate wallet" }
  ]
}: ProgressIndicatorProps) {
  return (
    <div className="w-full">
      {/* Minimalist progress */}
      <div className="w-full">
        {/* Progress bar */}
        <div className="relative mb-2">
          {/* Background segments */}
          <div className="flex gap-1 sm:gap-2">
            {steps.map((_, index) => {
              const stepNumber = index + 1;
              const isCompleted = stepNumber <= currentStep;
              
              return (
                <div
                  key={index}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
                    stepNumber === currentStep ? 'bg-gray-700 dark:bg-gray-200' : 
                    'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              );
            })}
          </div>
        </div>
        
        {/* Step labels */}
        <div className="relative flex gap-1 sm:gap-2">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isCompleted = stepNumber <= currentStep;
            const isCurrent = stepNumber === currentStep;
            
            return (
              <div 
                key={index} 
                className="flex-1 px-1"
              >
                <div className="flex items-start gap-1.5">
                  {/* Number or Check */}
                  {stepNumber < currentStep ? (
                    <Check className="w-3 h-3 mt-0.5 text-green-600 dark:text-green-500 flex-shrink-0" />
                  ) : (
                    <span className={`text-[10px] sm:text-xs font-medium mt-0.5 transition-colors flex-shrink-0 ${
                      isCurrent ? 'text-gray-700 dark:text-gray-200' : 
                      'text-gray-400 dark:text-gray-500'
                    }`}>
                      {stepNumber}
                    </span>
                  )}
                  <div>
                    {/* Label */}
                    <p className={`text-xs sm:text-sm font-medium transition-colors ${
                      isCurrent ? 'text-gray-700 dark:text-gray-200' : 
                      'text-gray-400 dark:text-gray-500'
                    }`}>
                      {step.label}
                    </p>
                    {step.description && (
                      <p className={`text-[9px] sm:text-xs mt-0.5 transition-colors ${
                        isCurrent ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}