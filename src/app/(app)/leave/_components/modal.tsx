"use client";
import { Card } from "@/components/ui/card";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <Card
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}
