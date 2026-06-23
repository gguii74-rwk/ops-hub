import { ManageTabs } from "./_components/manage-tabs";

export default function LeaveManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <ManageTabs />
      {children}
    </section>
  );
}
