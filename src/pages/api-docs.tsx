// src/pages/api-docs.tsx
import dynamic from "next/dynamic";
import React, { useEffect, useState, useRef } from "react";
import { useWallet } from "@meshsdk/react";
import { Key, Lightbulb, Copy, Check } from "lucide-react";
import Globe from "./globe";

// Avoid SSR for Swagger UI
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });
import "swagger-ui-react/swagger-ui.css";

export default function ApiDocs() {
  const { wallet, connected } = useWallet();
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generateTokenRef = React.useRef<(() => Promise<void>) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const swaggerSystemRef = useRef<any>(null);
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorData = await nonceResponse.json().catch(() => ({}));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-nullish-coalescing
        throw new Error((errorData as { error?: string }).error || "Failed to get nonce");
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { nonce } = await nonceResponse.json() as { nonce: string };

      // Step 2: Sign the nonce
      let signature: { signature: string; key: string } | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument
        signature = await wallet.signData(nonce, address) as { signature: string; key: string };
      } catch (error) {
        // User declined to sign or signing was cancelled
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes("user") || errorMessage.includes("cancel") || errorMessage.includes("decline") || errorMessage.includes("reject")) {
            throw new Error("Signing cancelled. Please try again and approve the signing request.");
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorData = await tokenResponse.json().catch(() => ({}));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-nullish-coalescing
        throw new Error((errorData as { error?: string }).error || "Failed to generate token");
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { token } = await tokenResponse.json() as { token: string };
      
      // Store the token for display
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      setGeneratedToken(token);

      // Step 4: Set authorization using Swagger UI's programmatic API
      if (swaggerSystemRef.current) {
        try {
          // Use Swagger UI's internal API to set authorization
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          const authActions = (swaggerSystemRef.current as { getSystem: () => { authActions: { authorize: (config: { BearerAuth: { value: string } }) => void } } }).getSystem().authActions;
          
          // Set the authorization for BearerAuth scheme
          // Swagger UI expects the token value directly for bearer tokens
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          authActions.authorize({
            BearerAuth: {
              value: token,
            },
          });
        } catch (error) {
          console.warn("Failed to set authorization programmatically, falling back to DOM manipulation:", error);
          // Fall through to DOM manipulation fallback
        }
      }
      
      // Fallback: Use DOM manipulation if programmatic API fails or isn't available
      if (!swaggerSystemRef.current) {
        // Fallback: Try to use DOM manipulation with better event handling
        const authorizeButton = document.querySelector(".swagger-ui .btn.authorize") as HTMLElement;
        if (authorizeButton) {
          authorizeButton.click();
          
          // Wait for modal to open and fill token with proper React event simulation
          const fillToken = () => {
            const tokenInput = document.querySelector(
              ".swagger-ui .auth-container input[type='text'], .swagger-ui .auth-container input[type='password']"
            ) as HTMLInputElement;
            if (tokenInput) {
              // Set value
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
              )?.set;
              if (nativeInputValueSetter) {
                // eslint-disable-next-line @typescript-eslint/unbound-method
                nativeInputValueSetter.call(tokenInput, token);
              } else {
                tokenInput.value = token;
              }
              
              // Trigger React events properly
              const inputEvent = new Event("input", { bubbles: true, cancelable: true });
              const changeEvent = new Event("change", { bubbles: true, cancelable: true });
              tokenInput.dispatchEvent(inputEvent);
              tokenInput.dispatchEvent(changeEvent);
              
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
                  ".swagger-ui .auth-container .btn-done, .swagger-ui .auth-container .authorize"
                ) as HTMLElement | null;
                if (authorizeBtn) {
                  authorizeBtn.click();
                }
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
      alert(`Failed to generate token: ${error instanceof Error ? error.message : "Unknown error"}`);
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

  // Store function reference for DOM access
  generateTokenRef.current = generateBearerToken;

  useEffect(() => {
    // Add info text next to authorize button after Swagger UI loads
    const addAuthInfo = () => {
      const schemeContainer = document.querySelector(".swagger-ui .scheme-container");
      if (schemeContainer && !schemeContainer.querySelector(".auth-info-text")) {
        const infoText = document.createElement("div");
        infoText.className = "auth-info-text";
        infoText.innerHTML = `
          <span class="auth-info-icon">ℹ️</span>
          <span class="auth-info-content">Enter your JWT token (format: <code>Bearer &lt;token&gt;</code> or just <code>&lt;token&gt;</code>)</span>
        `;
        schemeContainer.appendChild(infoText);
        return true;
      }
      return false;
    };

    // Update floating button state
    const updateFloatingButton = () => {
      const floatingBtn = document.querySelector(".floating-token-generator-btn")!;
      const floatingText = document.querySelector(".floating-token-generator-text");
      if (floatingBtn) {
        (floatingBtn as HTMLButtonElement).disabled = isGeneratingToken;
        if (floatingText) {
          floatingText.textContent = isGeneratingToken ? "Generating..." : "Generate Token";
        }
      }
    };

    // Try immediately
    addAuthInfo();
    updateFloatingButton();

    // Use MutationObserver to detect when Swagger UI loads
    const observer = new MutationObserver(() => {
      addAuthInfo();
      updateFloatingButton();
    });

    // Observe the Swagger UI container
    const swaggerContainer = document.querySelector(".swagger-ui");
    if (swaggerContainer) {
      observer.observe(swaggerContainer, {
        childList: true,
        subtree: true,
      });
    }

    // Also try after delays as fallback
    const timer = setTimeout(() => {
      addAuthInfo();
      updateFloatingButton();
    }, 500);
    const timer2 = setTimeout(() => {
      addAuthInfo();
      updateFloatingButton();
      observer.disconnect();
    }, 2000);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, [connected, wallet, isGeneratingToken]);

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      <div
        className="globe-background-container"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -10,
          overflow: "hidden",
        }}
      >
        <Globe />
      </div>
      <div
        className="api-docs-wrapper"
        style={{
          position: "relative",
          zIndex: 10,
          padding: "2rem",
          borderRadius: "12px",
          maxWidth: "100%",
          width: "calc(100% - 4rem)",
          margin: "2rem auto",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <SwaggerUI
          url="/api/swagger"
          docExpansion="none"
          defaultModelsExpandDepth={-1}
          deepLinking={true}
          onComplete={(system) => {
            // Store the Swagger UI system instance for programmatic access
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            swaggerSystemRef.current = system;
          }}
        />
      </div>
      
      {/* Floating token generator button */}
      <div className="floating-token-generator">
        <div className="floating-token-generator-content">
          {connected ? (
            <>
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
            </>
          ) : (
            <div className="floating-token-generator-hint">
              <Lightbulb className="floating-hint-icon" size={16} />
              <span className="floating-hint-text">Connect wallet to generate token</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
