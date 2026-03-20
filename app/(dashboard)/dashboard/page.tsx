"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserCheck, UserX, TrendingUp, MessageSquare, Clock } from "lucide-react";

interface Metrics {
  totalLeads: number;
  todayLeads: number;
  qualified: number;
  warm: number;
  disqualified: number;
  pending: number;
  activeConversations: number;
  conversionRate: number;
  chartData: { date: string; total: number; qualified: number; warm: number; disqualified: number }[];
  adData: { adId: string; total: number; qualified: number }[];
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchMetrics() {
    try {
      const res = await fetch("/api/metrics");
      const data = await res.json();
      setMetrics(data);
    } catch (err) {
      console.error("Error fetching metrics:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const cards = [
    {
      title: "Total de Leads",
      value: metrics.totalLeads,
      subtitle: `${metrics.todayLeads} hoje`,
      icon: Users,
      color: "text-blue-400",
    },
    {
      title: "Qualificados",
      value: metrics.qualified,
      subtitle: `${metrics.conversionRate}% taxa`,
      icon: UserCheck,
      color: "text-emerald-400",
    },
    {
      title: "Mornos",
      value: metrics.warm,
      subtitle: "Precisam atenção",
      icon: Clock,
      color: "text-amber-400",
    },
    {
      title: "Desqualificados",
      value: metrics.disqualified,
      subtitle: `${metrics.pending} pendentes`,
      icon: UserX,
      color: "text-red-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>
        <Badge variant="outline" className="gap-1">
          <MessageSquare className="h-3 w-3" />
          {metrics.activeConversations} conversas ativas
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className={cn("h-4 w-4", card.color)} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">{card.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{card.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Qualification Distribution */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Distribuição de Qualificação</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <QualBar label="Qualificados" value={metrics.qualified} total={metrics.totalLeads} color="bg-emerald-500" />
              <QualBar label="Mornos" value={metrics.warm} total={metrics.totalLeads} color="bg-amber-500" />
              <QualBar label="Desqualificados" value={metrics.disqualified} total={metrics.totalLeads} color="bg-red-500" />
              <QualBar label="Pendentes" value={metrics.pending} total={metrics.totalLeads} color="bg-zinc-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Leads por Dia (Últimos 30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhum lead ainda. Os dados aparecerão aqui quando os leads começarem a chegar.
              </p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {metrics.chartData.slice(-30).map((day) => {
                  const maxVal = Math.max(...metrics.chartData.map((d) => d.total), 1);
                  const height = (day.total / maxVal) * 100;
                  return (
                    <div
                      key={day.date}
                      className="flex-1 rounded-t bg-primary/80 hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${day.date}: ${day.total} leads`}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ad Performance */}
      {metrics.adData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Performance por Anúncio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.adData.map((ad) => (
                <div key={ad.adId} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{ad.adId}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{ad.total} leads</span>
                    <Badge variant={ad.qualified > 0 ? "default" : "secondary"}>
                      {ad.qualified} qualificados
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QualBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {value} ({Math.round(pct)}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div className={cn("h-2 rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}
