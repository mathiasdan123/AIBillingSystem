/**
 * IntakeProgress Component
 *
 * Displays progress bar and step indicators for the intake wizard.
 */

import { Check } from 'lucide-react';

interface Step {
  id: number;
  title: string;
  completed: boolean;
}

interface IntakeProgressProps {
  steps: Step[];
  currentStep: number;
  primaryColor?: string;
  onStepClick?: (stepId: number) => void;
}

export function IntakeProgress({ steps, currentStep, primaryColor = '#2563eb', onStepClick }: IntakeProgressProps) {
  const completedCount = steps.filter(s => s.completed).length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <div className="mb-8">
      {/* Progress Bar */}
      <div className="relative mb-4">
        <div className="h-2 bg-gray-200 rounded-full">
          <div
            className="h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: primaryColor }}
          />
        </div>
      </div>

      {/* Step Indicators */}
      <div className="flex justify-between">
        {steps.map((step) => {
          const isCompleted = step.completed;
          const isCurrent = step.id === currentStep;

          return (
            <button
              key={step.id}
              type="button"
              className="flex flex-col items-center flex-1 cursor-pointer group"
              onClick={() => onStepClick?.(step.id)}
            >
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                  transition-all duration-200 mb-2 group-hover:ring-2 group-hover:ring-offset-2
                  ${isCompleted || isCurrent
                    ? 'text-white'
                    : 'bg-gray-200 text-gray-600'
                  }
                `}
                style={{
                  backgroundColor: isCompleted || isCurrent ? primaryColor : undefined,
                  ['--tw-ring-color' as any]: primaryColor,
                }}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  step.id
                )}
              </div>
              <span
                className={`
                  text-xs text-center max-w-[80px] leading-tight
                  ${isCurrent ? 'font-semibold text-gray-900' : 'text-gray-500'}
                `}
              >
                {step.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default IntakeProgress;
