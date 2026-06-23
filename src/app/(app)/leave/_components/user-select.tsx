"use client";
import { useQuery } from "@tanstack/react-query";

export interface LeaveUser {
  id: string;
  name: string;
  teamId: string | null;
  team: { name: string } | null;
  email: string;
}

export function useLeaveUsers() {
  return useQuery({
    queryKey: ["admin-leave", "users"],
    queryFn: async (): Promise<LeaveUser[]> => {
      const res = await fetch("/api/admin/leave/users", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`users ${res.status}`);
      return (await res.json()).items as LeaveUser[];
    },
  });
}

export function UserSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data = [], isLoading } = useLeaveUsers();
  return (
    <select
      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{isLoading ? "불러오는 중…" : "사용자를 선택하세요"}</option>
      {data.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} - {u.team?.name ?? "-"} ({u.email})
        </option>
      ))}
    </select>
  );
}
