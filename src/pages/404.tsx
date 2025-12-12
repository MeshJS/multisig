import { useRouter } from "next/router";
import { FileQuestion, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

export default function Custom404() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm shadow-lg">
        <CardContent className="flex flex-col items-center text-center p-8 space-y-6">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/10 dark:bg-blue-500/20 rounded-full blur-xl" />
            <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-200 dark:border-blue-900/50">
              <FileQuestion className="w-10 h-10 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
              404
            </h1>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Page Not Found
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm">
              The page you're looking for doesn't exist or has been moved.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Button
              onClick={() => router.back()}
              variant="outline"
              className="w-full sm:w-auto min-w-[140px]"
              size="lg"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
            <Link href="/" className="w-full sm:w-auto">
              <Button
                className="w-full sm:w-auto min-w-[140px]"
                size="lg"
              >
                <Home className="mr-2 h-4 w-4" />
                Go Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

