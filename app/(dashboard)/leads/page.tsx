"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  destination_interest: string | null;
  travel_dates: string | null;
  travelers_count: number | null;
  qualification_status: string;
  qualification_score: number;
  ctwa_clid: string | null;
  ad_id: string | null;
  created_at: string;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  qualified: { label: "Qualificado", variant: "default" },
  warm: { label: "Morno", variant: "secondary" },
  disqualified: { label: "Desqualificado", variant: "destructive" },
  pending: { label: "Pendente", variant: "outline" },
  inactive: { label: "Inativo", variant: "outline" },
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
  }, [statusFilter]);

  async function fetchLeads() {
    setLoading(true);
    const res = await fetch(`/api/leads?status=${statusFilter}&limit=50`);
    const data = await res.json();
    setLeads(data.leads || []);
    setTotal(data.total || 0);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} leads no total</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="qualified">Qualificados</SelectItem>
            <SelectItem value="warm">Mornos</SelectItem>
            <SelectItem value="disqualified">Desqualificados</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead>Viajantes</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Criado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 animate-pulse rounded bg-muted" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                    <Users className="mx-auto h-8 w-8 mb-2 opacity-50" />
                    Nenhum lead encontrado
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => {
                  const config = statusConfig[lead.qualification_status] || statusConfig.pending;
                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{formatPhone(lead.phone)}</TableCell>
                      <TableCell>{lead.destination_interest || "—"}</TableCell>
                      <TableCell>{lead.travel_dates || "—"}</TableCell>
                      <TableCell>{lead.travelers_count || "—"}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{lead.qualification_score}</TableCell>
                      <TableCell>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {lead.ad_id ? (
                          <span className="font-mono text-xs text-muted-foreground" title={`CTWA: ${lead.ctwa_clid || "—"}`}>
                            Ad
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Orgânico</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true, locale: ptBR })}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatPhone(phone: string): string {
  if (phone.length === 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  return phone;
}
