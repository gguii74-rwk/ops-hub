import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// 디자인 미리보기 데모 — 실제 지표가 아니라 브랜드 팔레트/Playfair 시연용 예시.
// 라벨은 실제 도메인 용어가 아닌 중립 샘플로 두어 운영 데이터로 오인되지 않게 한다.
// 향후 실제 대시보드 위젯으로 교체한다.
const sampleMetrics = [
  { label: "예시 지표 A", value: "24", trend: "+12%", tone: "cyan" as const },
  { label: "예시 지표 B", value: "7", trend: "-3", tone: "lime" as const },
  { label: "예시 지표 C", value: "8.5", trend: "+0.5", tone: "cyan" as const },
];

// 파스텔은 소프트 배경(fill)으로만, 텍스트는 다크(text-foreground) — spec §8.
const trendChip: Record<"cyan" | "lime", string> = {
  cyan: "bg-chart-cyan/15 text-foreground",
  lime: "bg-point-lime/25 text-foreground",
};

export default function DashboardPage() {
  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">대시보드</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          디자인 미리보기
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        아래 카드는 브랜드 팔레트·타이포그래피 시연용 예시이며 실제 운영 데이터가 아닙니다.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sampleMetrics.map((m) => (
          <Card key={m.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <span className="font-display text-4xl font-semibold tracking-tight">
                {m.value}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${trendChip[m.tone]}`}
              >
                {m.trend}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
