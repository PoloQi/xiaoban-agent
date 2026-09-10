export type OnboardingStep = "welcome" | "boundaries" | "setup" | "companion";

export function advanceOnboarding(step: OnboardingStep): OnboardingStep {
  return step === "welcome" ? "boundaries" : "setup";
}
