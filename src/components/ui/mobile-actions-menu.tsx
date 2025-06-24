import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreVertical } from "lucide-react";

interface MobileActionsMenuProps {
  children: React.ReactNode;
}

export function MobileActionsMenu({ children }: MobileActionsMenuProps) {
  const [open, setOpen] = React.useState(false);

  // Flatten children arrays and add props
  const flattenChildren = (children: React.ReactNode): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    
    React.Children.forEach(children, (child) => {
      if (Array.isArray(child)) {
        result.push(...child);
      } else if (React.isValidElement(child)) {
        const cloned = React.cloneElement(child as React.ReactElement<any>, {
          onAction: () => setOpen(false),
        });
        result.push(cloned);
      } else if (child) {
        result.push(child);
      }
    });
    
    return result;
  };
  
  const childrenWithProps = flattenChildren(children);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="secondary" 
          size="icon"
          className="md:hidden rounded-full"
          aria-label="More actions"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-auto min-w-[200px] p-2 z-[100]"
        sideOffset={5}
      >
        <div className="flex flex-col gap-1">
          {childrenWithProps.map((child, index) => {
            if (React.isValidElement(child)) {
              // Check if this is a separator
              if (child.props.className?.includes('h-px')) {
                return child;
              }
              
              // Check if child already has hover styling
              const hasHoverClass = child.props.className?.includes('hover:bg-accent');
              
              // If it already has hover styling, don't wrap it
              if (hasHoverClass) {
                return React.cloneElement(child as React.ReactElement<any>, {
                  key: index,
                  className: `${child.props.className} px-2 py-1.5 text-sm rounded-sm transition-colors`
                });
              }
              
              // Otherwise, wrap in consistent container
              return (
                <div 
                  key={index}
                  className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {child}
                </div>
              );
            }
            return child;
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}