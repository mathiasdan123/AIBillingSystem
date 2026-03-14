/**
 * ParentQuestionnaireStep Component
 *
 * Multi-section parent questionnaire with accordion navigation.
 */

import { useState, useCallback } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle } from 'lucide-react';
import { PatientInfoSection } from '../sections/PatientInfoSection';
import { ParentInfoSection } from '../sections/ParentInfoSection';
import { EmergencyContactSection } from '../sections/EmergencyContactSection';
import { BirthHistorySection } from '../sections/BirthHistorySection';
import { MedicalHistorySection } from '../sections/MedicalHistorySection';
import { NutritionHistorySection } from '../sections/NutritionHistorySection';
import { TreatmentHistorySection } from '../sections/TreatmentHistorySection';
import { SocialHistorySection } from '../sections/SocialHistorySection';
import { DevelopmentalMilestonesSection } from '../sections/DevelopmentalMilestonesSection';
import { VisualMotorSkillsSection } from '../sections/VisualMotorSkillsSection';
import { SocialEmotionalSection } from '../sections/SocialEmotionalSection';
import { SensoryProcessingSection } from '../sections/SensoryProcessingSection';

interface ParentQuestionnaireStepProps {
  data: Record<string, any>;
  onDataChange: (stepId: string, data: any) => void;
  onComplete: () => void;
}

interface Section {
  id: string;
  title: string;
  required: boolean;
  component: React.ComponentType<{ data: any; onChange: (data: any) => void }>;
}

const SECTIONS: Section[] = [
  { id: 'patientInfo', title: 'Patient Information', required: true, component: PatientInfoSection },
  { id: 'parent1', title: 'Parent/Guardian 1', required: true, component: ParentInfoSection },
  { id: 'parent2', title: 'Parent/Guardian 2', required: false, component: ParentInfoSection },
  { id: 'emergencyContact', title: 'Emergency Contact', required: true, component: EmergencyContactSection },
  { id: 'birthHistory', title: 'Birth History', required: false, component: BirthHistorySection },
  { id: 'medicalHistory', title: 'Medical History', required: true, component: MedicalHistorySection },
  { id: 'nutritionHistory', title: 'Nutrition History', required: false, component: NutritionHistorySection },
  { id: 'treatmentHistory', title: 'Treatment History', required: false, component: TreatmentHistorySection },
  { id: 'socialHistory', title: 'Social History', required: false, component: SocialHistorySection },
  { id: 'developmentalMilestones', title: 'Developmental Milestones', required: false, component: DevelopmentalMilestonesSection },
  { id: 'visualMotorSkills', title: 'Visual & Motor Skills', required: false, component: VisualMotorSkillsSection },
  { id: 'socialEmotional', title: 'Social-Emotional Skills', required: false, component: SocialEmotionalSection },
  { id: 'sensoryProcessing', title: 'Sensory Processing', required: true, component: SensoryProcessingSection },
];

export function ParentQuestionnaireStep({ data, onDataChange, onComplete }: ParentQuestionnaireStepProps) {
  const [expandedSections, setExpandedSections] = useState<string[]>(['patientInfo']);

  const getSectionData = useCallback((sectionId: string) => {
    return data[sectionId] || {};
  }, [data]);

  const handleSectionChange = useCallback((sectionId: string, sectionData: any) => {
    onDataChange(sectionId, sectionData);
  }, [onDataChange]);

  const isSectionComplete = useCallback((sectionId: string) => {
    const sectionData = getSectionData(sectionId);
    // A section is considered complete if it has any data
    return Object.keys(sectionData).length > 0;
  }, [getSectionData]);

  const getCompletedCount = useCallback(() => {
    return SECTIONS.filter(s => isSectionComplete(s.id)).length;
  }, [isSectionComplete]);

  const areRequiredSectionsComplete = useCallback(() => {
    return SECTIONS.filter(s => s.required).every(s => isSectionComplete(s.id));
  }, [isSectionComplete]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Parent Questionnaire</h2>
          <Badge variant="secondary">
            {getCompletedCount()} / {SECTIONS.length} sections
          </Badge>
        </div>
        <p className="text-gray-600 text-sm">
          Please complete the following sections. Sections marked with * are required.
          Your progress is automatically saved.
        </p>
      </div>

      <Accordion
        type="multiple"
        value={expandedSections}
        onValueChange={setExpandedSections}
        className="space-y-2"
      >
        {SECTIONS.map((section) => {
          const isComplete = isSectionComplete(section.id);
          const SectionComponent = section.component;

          return (
            <AccordionItem
              key={section.id}
              value={section.id}
              className="border rounded-lg"
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300" />
                  )}
                  <span className="font-medium">
                    {section.title}
                    {section.required && <span className="text-red-500 ml-1">*</span>}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <SectionComponent
                  data={getSectionData(section.id)}
                  onChange={(newData) => handleSectionChange(section.id, newData)}
                />
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <div className="flex justify-end">
        <Button
          onClick={onComplete}
          disabled={!areRequiredSectionsComplete()}
        >
          {areRequiredSectionsComplete()
            ? 'Continue to Next Step'
            : 'Complete Required Sections to Continue'
          }
        </Button>
      </div>
    </div>
  );
}

export default ParentQuestionnaireStep;
