import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useEffect, useState } from "react";

function DappCard({ title, description, url }: { title: string; description: string; url: string }) {
  const [ogImage, setOgImage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOgImage() {
      try {
        const res = await fetch(`/api/v1/og?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.image) {
          setOgImage(data.image);
        }
      } catch (e) {
        // Ignore errors, just don't show image
      }
    }
    fetchOgImage();
  }, [url]);

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="hover:no-underline"
    >
      <Card className="h-full hover:border-zinc-400 transition-colors">
        {ogImage && (
          <div className="aspect-video overflow-hidden">
            <img 
              src={ogImage} 
              alt={title}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </a>
  );
}

export default function PageDapps() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DappCard
          title="AQUARIUM"
          description="Explore Aquarium for multisig-compatible DeFi interactions."
          url="https://aquarium-qa.fluidtokens.com/"
        />
        <DappCard
          title="MINSWAP"
          description="Launch Minswap in multisig mode (dev environment)."
          url="https://minswap-multisig-dev.fluidtokens.com/"
        />
      </div>
    </main>
  );
}
  