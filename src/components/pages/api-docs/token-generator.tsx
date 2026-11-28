import { useRef, useState, type MutableRefObject } from "react";
import { Check, Copy, Key } from "lucide-react";

import useMeshWallet from "@/hooks/useMeshWallet";
import ConnectHint from "./connect-hint";

/** The slice of Swagger UI's system the generator drives. */
export type SwaggerSystem = {
  getSystem: () => {
    authActions: {
      authorize: (config: { BearerAuth: { value: string } }) => void;
    };
  };
};

/**
 * The floating "Generate Token" control on /api-docs: signs a nonce with the
 * connected wallet, exchanges it for a v1 bearer token and authorizes Swagger
 * UI with it.
 *
 * This is the only part of the page that needs a wallet, and so the only part
 * that imports the Cardano stack (through useMeshWallet). It is loaded by
 * TokenGeneratorSlot only once the wallet runtime is active — see there.
 */
export default function TokenGenerator({
  swaggerSystemRef,
}: {
  swaggerSystemRef: MutableRefObject<SwaggerSystem | null>;
}) {
  // Mesh 1.9 bridge — signData(payload, address). react-2.0's useWallet()
  // wallet has the args swapped, which broke bearer-token generation on
  // wallets like VESPR (CIP-30 InternalError -2).
  const { wallet, connected } = useMeshWallet();
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const generateBearerToken = async () => {
    if (!wallet || !connected) return;

    setIsGeneratingToken(true);
    setGeneratedToken(null); // Clear previous token
    setCopied(false); // Reset copy state
    try {
      // Get the wallet address - try used addresses first, fall back to unused
      let address: string | undefined;
      try {
        const usedAddresses = await wallet.getUsedAddresses();
        address = usedAddresses[0];
      } catch (error) {
        if (error instanceof Error && error.message.includes("account changed")) {
          throw error;
        }
      }

      // Fall back to unused addresses if no used addresses found
      if (!address) {
        try {
          const unusedAddresses = await wallet.getUnusedAddresses();
          address = unusedAddresses[0];
        } catch (error) {
          if (error instanceof Error && error.message.includes("account changed")) {
            throw error;
          }
        }
      }

      if (!address) {
        throw new Error("No addresses found for wallet");
      }

      // Step 1: Get nonce
      const nonceResponse = await fetch(`/api/v1/getNonce?address=${address}`);
      if (!nonceResponse.ok) {
        const errorData = (await nonceResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error || "Failed to get nonce");
      }
      const { nonce } = (await nonceResponse.json()) as { nonce: string };

      // Step 2: Sign the nonce
      let signature: { signature: string; key: string } | undefined;
      try {
        signature = (await wallet.signData(nonce, address));
      } catch (error) {
        // User declined to sign or signing was cancelled
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (
            errorMessage.includes("user") ||
            errorMessage.includes("cancel") ||
            errorMessage.includes("decline") ||
            errorMessage.includes("reject")
          ) {
            throw new Error(
              "Signing cancelled. Please try again and approve the signing request.",
            );
          }
        }
        throw new Error("Failed to sign nonce. Please try again.");
      }

      if (!signature?.signature || !signature?.key) {
        throw new Error("Invalid signature received from wallet.");
      }

      // Step 3: Exchange signature for token
      const tokenResponse = await fetch("/api/v1/authSigner", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          signature: signature.signature,
          key: signature.key,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = (await tokenResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error || "Failed to generate token");
      }

      const { token } = (await tokenResponse.json()) as { token: string };

      // Store the token for display
      setGeneratedToken(token);

      // Step 4: Set authorization using Swagger UI's programmatic API
      if (swaggerSystemRef.current) {
        try {
          swaggerSystemRef.current.getSystem().authActions.authorize({
            BearerAuth: {
              value: token,
            },
          });
        } catch (error) {
          console.warn("Failed to set authorization programmatically:", error);
        }
      }

      // Fallback: Use DOM manipulation if the programmatic API isn't available
      if (!swaggerSystemRef.current) {
        const authorizeButton = document.querySelector(
          ".swagger-ui .btn.authorize",
        ) as HTMLElement | null;
        if (authorizeButton) {
          authorizeButton.click();

          // Wait for modal to open and fill token with proper React event simulation
          const fillToken = () => {
            const tokenInput = document.querySelector(
              ".swagger-ui .auth-container input[type='text'], .swagger-ui .auth-container input[type='password']",
            ) as HTMLInputElement | null;
            if (tokenInput) {
              // Set value through the native setter so React sees the change
              // eslint-disable-next-line @typescript-eslint/unbound-method -- The native setter is invoked below with .call(tokenInput, token), preserving its receiver.
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
              )?.set;
              if (nativeInputValueSetter) {
                nativeInputValueSetter.call(tokenInput, token);
              } else {
                tokenInput.value = token;
              }

              tokenInput.dispatchEvent(
                new Event("input", { bubbles: true, cancelable: true }),
              );
              tokenInput.dispatchEvent(
                new Event("change", { bubbles: true, cancelable: true }),
              );

              // Also trigger React's onChange handler
              const reactEvent = new Event("input", { bubbles: true });
              Object.defineProperty(reactEvent, "target", {
                writable: false,
                value: tokenInput,
              });
              tokenInput.dispatchEvent(reactEvent);

              // Click authorize button in modal after a short delay
              setTimeout(() => {
                const authorizeBtn = document.querySelector(
                  ".swagger-ui .auth-container .btn-done, .swagger-ui .auth-container .authorize",
                ) as HTMLElement | null;
                authorizeBtn?.click();
              }, 200);
              return true;
            }
            return false;
          };

          // Try multiple times as modal might take time to render
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            if (fillToken() || attempts > 15) {
              clearInterval(interval);
            }
          }, 150);
        }
      }
    } catch (error) {
      console.error("Error generating token:", error);
      alert(
        `Failed to generate token: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setGeneratedToken(null);
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const copyToken = async () => {
    if (!generatedToken) return;

    try {
      await navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      if (tokenInputRef.current) {
        tokenInputRef.current.select();
        tokenInputRef.current.setSelectionRange(0, 99999);
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  if (!connected) return <ConnectHint />;

  return (
    <div className="floating-token-generator">
      <div className="floating-token-generator-content">
        <button
          className="floating-token-generator-btn"
          onClick={generateBearerToken}
          disabled={isGeneratingToken}
        >
          <Key className="floating-token-generator-icon" size={18} />
          <span className="floating-token-generator-text">
            {isGeneratingToken ? "Generating..." : "Generate Token"}
          </span>
        </button>
        {generatedToken && (
          <div className="floating-token-display">
            <div className="floating-token-label">Generated Token:</div>
            <div className="floating-token-input-wrapper">
              <input
                ref={tokenInputRef}
                type="text"
                readOnly
                value={generatedToken}
                className="floating-token-input"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                title={generatedToken}
              />
              <button
                className="floating-token-copy-btn"
                onClick={copyToken}
                title={copied ? "Copied!" : "Copy token"}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
