import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, bordered = true, ...props }: React.ComponentProps<"table"> & { bordered?: boolean }) {
  return (
    <div className={cn("overflow-x-auto", bordered && "rounded-lg border border-border")}>
      <table data-slot="table" className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted/50 text-left text-muted-foreground", className)} {...props} />;
}
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr]:border-t [&_tr]:border-border", className)} {...props} />;
}
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn(className)} {...props} />;
}
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("p-2", className)} {...props} />;
}
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("p-2", className)} {...props} />;
}
function TableEmpty({ colSpan, className, children }: { colSpan: number; className?: string; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn("p-4 text-center text-muted-foreground", className)}>{children}</td>
    </tr>
  );
}
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
