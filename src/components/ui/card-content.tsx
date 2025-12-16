import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import React, { ReactNode } from "react";

export default function CardUI({
  children,
  title,
  description,
  icon,
  cardClassName,
  headerDom,
}: {
  children: React.ReactNode;
  title: string;
  description?: ReactNode | string | null;
  icon?: any;
  cardClassName?: string;
  headerDom?: ReactNode;
}) {
  return (
    <Card className={`w-full ${cardClassName || ""}`}>
      <CardHeader className="flex flex-row items-start sm:items-center justify-between space-y-0 pb-2 px-4 sm:px-6 pt-4 sm:pt-6 gap-2">
        <CardTitle className="text-lg sm:text-xl font-medium pr-2 flex-1 min-w-0">{title}</CardTitle>
        {headerDom && <div className="flex-shrink-0">{headerDom}</div>}
        {icon && (
          <>
            {typeof icon === "string" ? (
              <div className="h-4 w-4 text-muted-foreground flex-shrink-0">{icon}</div>
            ) : (
              React.createElement(icon, {
                className: "h-4 w-4 text-muted-foreground flex-shrink-0",
              })
            )}
          </>
        )}
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="mt-1 flex flex-col gap-3 sm:gap-2">
          {description && (
            <div className="text-xs sm:text-sm text-muted-foreground">{description}</div>
          )}
          <div className="flex flex-col gap-2">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}
