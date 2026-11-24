import { Lightbulb } from "lucide-react";

/** What the floating token control shows while no wallet is connected. */
export default function ConnectHint() {
  return (
    <div className="floating-token-generator">
      <div className="floating-token-generator-content">
        <div className="floating-token-generator-hint">
          <Lightbulb className="floating-hint-icon" size={16} />
          <span className="floating-hint-text">
            Connect wallet to generate token
          </span>
        </div>
      </div>
    </div>
  );
}
