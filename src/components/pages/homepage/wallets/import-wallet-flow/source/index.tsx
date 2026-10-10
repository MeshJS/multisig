import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { WalletImportFlowState } from "../shared/useWalletImportFlowState";
import InstanceTab from "./instance-tab";
import SummonTab from "./summon-tab";
import CborTab from "./cbor-tab";
import JsonTab from "./json-tab";
import DiscoverTab from "./discover-tab";

type Tab = "instance" | "summon" | "cbor" | "json" | "discover";

interface Props {
  flow: WalletImportFlowState;
}

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "instance", label: "Another instance" },
  { value: "summon", label: "Summon" },
  { value: "cbor", label: "Paste CBOR" },
  { value: "json", label: "Upload JSON" },
  { value: "discover", label: "Discover on-chain" },
];

const TAB_VALUES = TAB_OPTIONS.map((opt) => opt.value);

export default function SourceStep({ flow }: Props) {
  const [tab, setTab] = useState<Tab>("instance");

  // Support deep links like /wallets/import-wallet?tab=discover.
  const queryTab = flow.router.query.tab;
  useEffect(() => {
    if (typeof queryTab === "string" && TAB_VALUES.includes(queryTab as Tab)) {
      setTab(queryTab as Tab);
    }
  }, [queryTab]);

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">
          Where is the wallet coming from?
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          {/* Mobile: select dropdown (several tabs in two rows looked
              broken; a single select reads better at narrow widths).
              Desktop: the standard Radix tab bar. */}
          <div className="sm:hidden">
            <Select value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAB_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TabsList className="hidden h-auto w-full grid-cols-5 sm:grid">
            {TAB_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value}>
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="instance" className="mt-4">
            <InstanceTab flow={flow} />
          </TabsContent>
          <TabsContent value="summon" className="mt-4">
            <SummonTab />
          </TabsContent>
          <TabsContent value="cbor" className="mt-4">
            <CborTab flow={flow} />
          </TabsContent>
          <TabsContent value="json" className="mt-4">
            <JsonTab flow={flow} />
          </TabsContent>
          <TabsContent value="discover" className="mt-4">
            <DiscoverTab flow={flow} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
