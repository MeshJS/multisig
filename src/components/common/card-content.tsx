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
    <Card className={`w-full max-w-4xl ${cardClassName}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-medium">{title}</CardTitle>
        {headerDom && headerDom}
        {icon && (
          <>
            {typeof icon === "string" ? (
              <div className="h-4 w-4 text-muted-foreground">{icon}</div>
            ) : (
              React.createElement(icon, {
                className: "h-4 w-4 text-muted-foreground",
              })
            )}
          </>
        )}
      </CardHeader>
      <CardContent className="overflow-y-auto max-h-[calc(100vh-200px)]">
        <div className="mt-1 flex flex-col gap-2">
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          <div className="mt-1 flex flex-col gap-2">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}
