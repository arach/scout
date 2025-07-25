import { useState, useCallback } from 'react';
import { loggers } from '../utils/logger';

interface UseOnboardingLogicOptions {
  showFirstRun: boolean;
  setShowFirstRun: (show: boolean) => void;
  setCurrentView: (view: 'record' | 'transcripts' | 'settings') => void;
}

/**
 * Custom hook for onboarding flow logic
 * Extracted from AppContent.tsx to reduce component size and improve maintainability
 */
export function useOnboardingLogic({ 
  showFirstRun, 
  setShowFirstRun, 
  setCurrentView 
}: UseOnboardingLogicOptions) {
  const [isOnboardingTourStep, setIsOnboardingTourStep] = useState(false);

  const onRecordingStartCallback = useCallback(() => {
    // If recording starts during onboarding tour step, complete onboarding
    if (showFirstRun && isOnboardingTourStep) {
      loggers.ui.info('Completing onboarding due to recording start during tour step');
      localStorage.setItem('scout-onboarding-complete', 'true');
      setShowFirstRun(false);
      setCurrentView('record');
    }
  }, [showFirstRun, isOnboardingTourStep, setShowFirstRun, setCurrentView]);

  const completeOnboarding = useCallback(() => {
    loggers.ui.info('Onboarding completed by user');
    localStorage.setItem('scout-onboarding-complete', 'true');
    setShowFirstRun(false);
    setCurrentView('record');
  }, [setShowFirstRun, setCurrentView]);

  const skipOnboarding = useCallback(() => {
    loggers.ui.info('Onboarding skipped by user');
    localStorage.setItem('scout-onboarding-complete', 'true');
    setShowFirstRun(false);
    setCurrentView('record');
  }, [setShowFirstRun, setCurrentView]);

  return {
    isOnboardingTourStep,
    setIsOnboardingTourStep,
    onRecordingStartCallback,
    completeOnboarding,
    skipOnboarding,
  };
}