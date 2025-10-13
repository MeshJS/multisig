import React, { memo, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  AlertCircle, 
  CheckCircle,
  Copy,
  Settings,
  Send,
  Plus,
  Wallet,
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Calendar,
  Key,
  Hash,
  Clock,
  TrendingUp,
  Edit3,
  Save,
  X
} from "lucide-react";

// ProxyCard Component
interface ProxyCardProps {
  proxy: {
    id: string;
    proxyAddress: string;
    authTokenId: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
  };
  isSelected: boolean;
  balance: Array<{ unit: string; quantity: string }>;
  balanceLoading?: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onSpend: () => void;
  onUpdateProxy: (proxyId: string, description: string) => Promise<void>;
  onRefreshBalance?: () => void;
}

// Component to fetch and display proxy balance
const ProxyCardWithBalance = memo(function ProxyCardWithBalance({ 
  proxy, 
  isSelected, 
  onSelect, 
  onCopy, 
  onSpend, 
  onGetProxyBalance,
  onUpdateProxy
}: Omit<ProxyCardProps, 'balance'> & { 
  onGetProxyBalance: (proxyAddress: string) => Promise<Array<{ unit: string; quantity: string }>>;
  onUpdateProxy: (proxyId: string, description: string) => Promise<void>;
}) {
  const [balance, setBalance] = useState<Array<{ unit: string; quantity: string }>>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);

  const fetchBalance = React.useCallback(async () => {
    setBalanceLoading(true);
    try {
      const proxyBalance = await onGetProxyBalance(proxy.proxyAddress);
      setBalance(proxyBalance);
      setLastFetchTime(Date.now());
    } catch (error) {
      console.error("Failed to fetch proxy balance:", error);
      setBalance([]);
    } finally {
      setBalanceLoading(false);
    }
  }, [proxy.proxyAddress, onGetProxyBalance]);

  // Initial fetch and refresh when proxy address changes
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Refresh balance when proxy is selected (to ensure latest data)
  useEffect(() => {
    if (isSelected && Date.now() - lastFetchTime > 5000) { // Refresh if older than 5 seconds
      fetchBalance();
    }
  }, [isSelected, fetchBalance, lastFetchTime]);

  return (
    <ProxyCard
      proxy={proxy}
      isSelected={isSelected}
      balance={balance}
      balanceLoading={balanceLoading}
      onSelect={onSelect}
      onCopy={onCopy}
      onSpend={onSpend}
      onUpdateProxy={onUpdateProxy}
      onRefreshBalance={fetchBalance}
    />
  );
});

const ProxyCard = memo(function ProxyCard({ proxy, isSelected, balance, balanceLoading = false, onSelect, onCopy, onSpend, onUpdateProxy, onRefreshBalance }: ProxyCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editDescription, setEditDescription] = React.useState(proxy.description || "");
  const [isUpdating, setIsUpdating] = React.useState(false);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    // You could add a toast notification here
  };

  const handleSaveDescription = async () => {
    if (editDescription.trim() === (proxy.description || "")) {
      setIsEditing(false);
      return;
    }

    setIsUpdating(true);
    try {
      await onUpdateProxy(proxy.id, editDescription.trim());
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update proxy description:", error);
      // Reset to original value on error
      setEditDescription(proxy.description || "");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelEdit = () => {
    setEditDescription(proxy.description || "");
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setEditDescription(proxy.description || "");
    setIsEditing(true);
  };

  return (
    <Card 
      className={`transition-all duration-200 hover:shadow-md ${
        isSelected ? 'ring-2 ring-primary' : ''
      }`}
    >
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">
            {proxy.proxyAddress.slice(0, 20)}...
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={proxy.isActive ? "default" : "secondary"}>
              {proxy.isActive ? "Active" : "Inactive"}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} proxy details`}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Enter description..."
                className="h-6 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveDescription();
                  } else if (e.key === 'Escape') {
                    handleCancelEdit();
                  }
                }}
                autoFocus
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleSaveDescription}
                disabled={isUpdating}
              >
                <Save className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleCancelEdit}
                disabled={isUpdating}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div 
              className="flex items-center gap-2 cursor-pointer hover:text-primary transition-colors group"
              onClick={handleStartEdit}
            >
              <span className="flex-1">
                {proxy.description || "Click to add description"}
              </span>
              <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-4">
        {/* Balance Display */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium">Balance</span>
            {onRefreshBalance && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshBalance();
                }}
                disabled={balanceLoading}
              >
                <TrendingUp className={`h-3 w-3 ${balanceLoading ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </div>
          
          {balanceLoading ? (
            <div className="h-4 bg-muted rounded animate-pulse"></div>
          ) : balance.length > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    {balance.map((asset, index) => (
                      <div key={index} className="flex items-center justify-between text-xs">
                        <span className="font-mono">
                          {asset.unit === "lovelace" 
                            ? `${(parseFloat(asset.quantity) / 1000000).toFixed(2)} ADA`
                            : asset.quantity
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="space-y-2">
                    <div className="font-semibold">Proxy Balance Details</div>
                    <div className="text-sm space-y-1">
                      {balance.map((asset, index) => (
                        <div key={index} className="flex justify-between">
                          <span>{asset.unit === "lovelace" ? "ADA" : asset.unit}:</span>
                          <span className="font-mono">
                            {asset.unit === "lovelace" 
                              ? `${(parseFloat(asset.quantity) / 1000000).toFixed(6)} ADA`
                              : asset.quantity
                            }
                          </span>
                        </div>
                      ))}
                      <div className="text-xs text-muted-foreground pt-1 border-t">
                        Total: {balance.length} asset{balance.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="text-xs text-muted-foreground">No balance</div>
          )}
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="space-y-3 pt-3 border-t">
            {/* Full Address */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Proxy Address</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(proxy.proxyAddress, "Proxy Address");
                  }}
                  aria-label="Copy proxy address to clipboard"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="p-2 bg-muted/50 rounded text-xs font-mono break-all">
                {proxy.proxyAddress}
              </div>
            </div>

            {/* Auth Token ID */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Key className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Auth Token ID</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(proxy.authTokenId, "Auth Token ID");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="p-2 bg-muted/50 rounded text-xs font-mono break-all">
                {proxy.authTokenId}
              </div>
            </div>

            {/* Creation Date */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Created</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDate(proxy.createdAt)}
              </div>
            </div>

            {/* Proxy ID */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Proxy ID</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(proxy.id, "Proxy ID");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="p-2 bg-muted/50 rounded text-xs font-mono">
                {proxy.id}
              </div>
            </div>
          </div>
        )}
        
        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant={isSelected ? "default" : "outline"}
            size="sm"
            className="flex-1 h-8 text-xs transition-all duration-200"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            <span className="hidden sm:inline">{isSelected ? 'Selected' : 'Select'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 flex-shrink-0 hover:bg-primary/10 transition-colors duration-200"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
          {isSelected && (
            <Button
              size="sm"
              className="h-8 text-xs hover:scale-105 transition-transform duration-200"
              onClick={(e) => {
                e.stopPropagation();
                onSpend();
              }}
            >
              <Send className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Spend</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

interface ProxyOverviewProps {
  proxies: Array<{
    id: string;
    proxyAddress: string;
    authTokenId: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
  }> | undefined;
  selectedProxy: string;
  selectedProxyBalance: Array<{ unit: string; quantity: string }>;
  proxyBalance: Array<{ unit: string; quantity: string }>;
  isProxySetup: boolean;
  onProxySelection: (proxyId: string) => void;
  onCopyToClipboard: (text: string) => void;
  onStartSetup: () => void;
  onStartSpending: () => void;
  onGetProxyBalance: (proxyAddress: string) => Promise<Array<{ unit: string; quantity: string }>>;
  onUpdateProxy: (proxyId: string, description: string) => Promise<void>;
  onRefreshAllBalances?: () => void;
}

const ProxyOverview = memo(function ProxyOverview({
  proxies,
  selectedProxy,
  selectedProxyBalance,
  proxyBalance,
  isProxySetup,
  onProxySelection,
  onCopyToClipboard,
  onStartSetup,
  onStartSpending,
  onGetProxyBalance,
  onUpdateProxy,
  onRefreshAllBalances,
}: ProxyOverviewProps) {
  return (
    <div className="space-y-6">
      {/* General Info and Introduction */}
      <div className="space-y-4">

        {/* Status Card - Only show when proxies are active */}
        {isProxySetup && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Proxy system active</p>
                  <p className="text-sm text-muted-foreground">Ready for automated transactions</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Proxy Carousel */}
      {proxies && proxies.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <Label className="text-base font-semibold">Available Proxies</Label>
            </div>
            <div className="flex items-center gap-2">
              {onRefreshAllBalances && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={onRefreshAllBalances}
                >
                  <TrendingUp className="h-3 w-3" />
                </Button>
              )}
              <Badge variant="secondary">{proxies.length} proxy{proxies.length !== 1 ? 'ies' : ''}</Badge>
            </div>
          </div>
          
          {!selectedProxy && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Select a proxy from the cards below to enable spending functionality.
              </AlertDescription>
            </Alert>
          )}
          
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                {proxies.map((proxy) => (
                  <ProxyCardWithBalance
                    key={proxy.id}
                    proxy={proxy}
                    isSelected={selectedProxy === proxy.id}
                    onSelect={() => onProxySelection(proxy.id)}
                    onCopy={() => onCopyToClipboard(proxy.proxyAddress)}
                    onSpend={() => onStartSpending()}
                    onGetProxyBalance={onGetProxyBalance}
                    onUpdateProxy={onUpdateProxy}
                  />
                ))}
              </div>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Settings className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Proxies Found</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              You haven't set up any proxy contracts yet. Create your first proxy to start managing automated transactions.
            </p>
            <Button onClick={onStartSetup} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Proxy
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add New Proxy */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <Plus className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">Add New Proxy</h4>
                <p className="text-sm text-muted-foreground">Create additional proxy contracts</p>
              </div>
            </div>
            <Button onClick={onStartSetup} size="sm">
              <ArrowRight className="h-4 w-4 mr-2" />
              Setup
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export default ProxyOverview;
