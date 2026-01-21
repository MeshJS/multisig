import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface RequiredSignersConfig {
  numRequiredSigners: number;
  setNumRequiredSigners: React.Dispatch<React.SetStateAction<number>>;
  nativeScriptType: "all" | "any" | "atLeast";
  signersCount: number;
}

interface ReviewRequiredSignersCardProps {
  requiredSignersConfig: RequiredSignersConfig;
  onSave?: (numRequired: number) => void;
}

const ReviewRequiredSignersCard: React.FC<ReviewRequiredSignersCardProps> = ({ 
  requiredSignersConfig,
  onSave 
}) => {
  const {
    numRequiredSigners,
    setNumRequiredSigners,
    nativeScriptType,
    signersCount,
  } = requiredSignersConfig;
  
  const [isEditing, setIsEditing] = useState(false);
  const [tempNumRequired, setTempNumRequired] = useState(numRequiredSigners);
  
  // Update temp states when props change (but not when editing)
  useEffect(() => {
    if (!isEditing) {
      setTempNumRequired(numRequiredSigners);
    }
  }, [numRequiredSigners, isEditing]);

  // Exit edit mode if script type changes from atLeast to something else
  useEffect(() => {
    if (nativeScriptType !== "atLeast" && isEditing) {
      setIsEditing(false);
    }
  }, [nativeScriptType, isEditing]);
  
  const handleSave = () => {
    // Update the parent state
    setNumRequiredSigners(tempNumRequired);
    setIsEditing(false);
    
    // Pass the values directly to onSave
    if (onSave) {
      onSave(tempNumRequired);
    }
  };
  
  const handleCancel = () => {
    setTempNumRequired(numRequiredSigners);
    setIsEditing(false);
  };

  return (
    <Card>
      {isEditing && nativeScriptType === "atLeast" && (
        <>
          {/* Back button at the very top of the card */}
          <div className="px-6 py-3">
            <button
              onClick={() => setIsEditing(false)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground py-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to signature rule
            </button>
          </div>
          {/* Divider */}
          <div className="px-6">
            <div className="border-b" />
          </div>
        </>
      )}
      <CardHeader>
        <CardTitle>{isEditing && nativeScriptType === "atLeast" ? "Edit" : "Signature Rule"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(
          isEditing && nativeScriptType === "atLeast" ? (
            /* Edit Mode */
            <div className="space-y-4">
              {/* Edit Form with background like Add Signer */}
              <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                {/* Number Selection - show only if script type is atLeast */}
                {nativeScriptType === "atLeast" && (
                  <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-start">
                    <Label className="text-sm sm:pt-2">Required</Label>
                    <div>
                      <div className="w-full overflow-x-auto pb-2">
                        <ToggleGroup
                          type="single"
                          value={tempNumRequired > 0 ? tempNumRequired.toString() : undefined}
                          onValueChange={(v) => {
                            if (v && v !== "" && !isNaN(Number(v))) {
                              const newValue = Number(v);
                              if (newValue > 0 && newValue <= signersCount) {
                                setTempNumRequired(newValue);
                              }
                            }
                          }}
                          className="justify-start flex-nowrap"
                        >
                          {Array.from(
                            { length: signersCount },
                            (_, i) => i + 1,
                          ).map((num) => (
                            <ToggleGroupItem 
                              key={num} 
                              value={num.toString()}
                              className="min-w-[44px] h-[44px]"
                            >
                              {num}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Select how many signers must approve each transaction
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Info for non-atLeast types */}
                {nativeScriptType !== "atLeast" && (
                  <div className="text-sm text-muted-foreground">
                    {nativeScriptType === 'all' ? 'All signers must approve each transaction.' : 'Any single signer can approve each transaction.'}
                  </div>
                )}
              </div>
              
              {/* Edit Actions */}
              <div className="flex gap-3 justify-end">
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            /* Display Mode */
            <>
              <div className="p-3 bg-muted rounded-md">
                <span className="text-sm">
                  {(() => {
                    if (nativeScriptType === 'all') {
                      return `All signers (of ${signersCount}) must approve`;
                    } else if (nativeScriptType === 'any') {
                      return `Any signer (of ${signersCount}) can approve`;
                    } else if (nativeScriptType === 'atLeast') {
                      return `${numRequiredSigners} of ${signersCount} signer${signersCount > 1 ? 's' : ''} must approve`;
                    } else {
                      // Fallback for edge cases
                      return `${numRequiredSigners} of ${signersCount} signer${signersCount > 1 ? 's' : ''} must approve`;
                    }
                  })()}
                </span>
              </div>
              
              {/* Info message for "all" and "any" script types */}
              {(nativeScriptType === 'all' || nativeScriptType === 'any') && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-xs text-blue-800 dark:text-blue-200">
                    <p className="font-medium mb-1">
                      {nativeScriptType === 'all' ? 'All Signers Required' : 'Any Signer Can Approve'}
                    </p>
                    <p>
                      With "{nativeScriptType === 'all' ? 'All' : 'Any'}" script type, no specific number is stored. 
                      {nativeScriptType === 'all' 
                        ? ' Every signer must approve each transaction.' 
                        : ' Any single signer can approve each transaction.'}
                    </p>
                  </div>
                </div>
              )}
              {/* Edit button - only show for atLeast type */}
              {nativeScriptType === "atLeast" && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTempNumRequired(numRequiredSigners);
                      setIsEditing(true);
                    }}
                    className="w-full sm:w-auto"
                  >
                    Edit
                  </Button>
                </div>
              )}
            </>
          )
        )}
      </CardContent>
    </Card>
  );
};

export default ReviewRequiredSignersCard;