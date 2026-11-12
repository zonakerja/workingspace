import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}

/** Kartu bagian standar dengan ikon berwarna sesuai modul aktif. */
export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-module-soft text-module">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <CardTitle className="text-[15px] leading-tight font-bold">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>}
          </div>
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children && <CardContent className={cn(contentClassName)}>{children}</CardContent>}
    </Card>
  );
}
