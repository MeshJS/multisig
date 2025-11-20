"use client";

import { LaunchWizard } from "./launch-wizard";

interface LaunchCrowdfundProps {
  onSuccess?: () => void;
  draftData?: any;
}

export function LaunchCrowdfund(props: LaunchCrowdfundProps = {}) {
  const { onSuccess, draftData } = props;

  return <LaunchWizard onSuccess={onSuccess} draftData={draftData} />;
}
