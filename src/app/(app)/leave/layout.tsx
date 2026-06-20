import { LeaveTabs } from "./_components/leave-tabs";

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차</h1>
      <LeaveTabs />
      {children}
    </section>
  );
}
