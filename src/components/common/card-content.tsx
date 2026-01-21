import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import React, { ReactNode } from "react";

export default function CardUI({
  children,
  title,
  description,
  icon,
  cardClassName,
  headerDom,
  profileImage,
}: {
  children: React.ReactNode;
  title: string;
  description?: ReactNode | string | null;
  icon?: any;
  cardClassName?: string;
  headerDom?: ReactNode;
  profileImage?: ReactNode;
}) {
  // Make title larger for wallet info card (col-span-2)
  const isLargeTitle = cardClassName?.includes('col-span-2');
  
  return (
    <Card className={`w-full max-w-4xl ${cardClassName}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {profileImage && (
            <div className="flex-shrink-0">
              {profileImage}
            </div>
          )}
          <CardTitle className={isLargeTitle ? "text-2xl sm:text-3xl font-semibold" : "text-xl font-medium"}>{title}</CardTitle>
        </div>
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
      <CardContent>
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
