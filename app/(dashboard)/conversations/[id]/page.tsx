"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Bot, User, Phone, MapPin, Calendar, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";

interface Message {
  id: string;
  direction: string;
  content: string;
  message_type: string;
  is_from_bot: boolean;
  created_at: string;
}

interface ConversationDetail {
  id: string;
  phone: string;
  bot_active: boolean;
  current_step: string;
  qualification_data: Record<string, unknown>;
  handoff_summary: string | null;
  leads: {
    name: string | null;
    phone: string;
    qualification_status: string;
    qualification_score: number;
  } | null;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchData() {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const data = await res.json();
      setMessages(data.messages || []);
      setConversation(data.conversation || null);
    } finally {
      setLoading(false);
    }
  }

  async function toggleBot(active: boolean) {
    await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id, active }),
    });
    fetchData();
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-96 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!conversation) {
    return <p className="text-muted-foreground">Conversa não encontrada</p>;
  }

  const lead = conversation.leads;
  const qualData = conversation.qualification_data || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/conversations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium tracking-tight">
            {lead?.name || formatPhone(conversation.phone)}
          </h1>
          <p className="text-sm text-muted-foreground font-mono">{formatPhone(conversation.phone)}</p>
        </div>
        <Button
          variant={conversation.bot_active ? "destructive" : "outline"}
          size="sm"
          onClick={() => toggleBot(!conversation.bot_active)}
        >
          <Bot className="mr-1 h-3 w-3" />
          {conversation.bot_active ? "Desativar Bot" : "Ativar Bot"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Chat Area */}
        <div className="lg:col-span-2">
          <Card className="flex flex-col" style={{ height: "calc(100vh - 200px)" }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Conversa</CardTitle>
                <div className="flex items-center gap-2">
                  {conversation.bot_active && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Bot className="h-3 w-3" /> Bot ativo
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {messages.length} mensagens
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                      msg.direction === "outgoing"
                        ? msg.is_from_bot
                          ? "bg-blue-600/20 text-blue-100 border border-blue-500/20"
                          : "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {msg.direction === "outgoing" && msg.is_from_bot && (
                      <div className="flex items-center gap-1 mb-1 text-xs text-blue-400">
                        <Bot className="h-3 w-3" />
                        Miry
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className="mt-1 text-[10px] opacity-50">
                      {new Date(msg.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </CardContent>
          </Card>
        </div>

        {/* Lead Info Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Dados do Lead</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow icon={User} label="Nome" value={lead?.name || "Não informado"} />
              <InfoRow icon={Phone} label="Telefone" value={formatPhone(conversation.phone)} />
              <InfoRow icon={MapPin} label="Destino" value={(qualData.destination as string) || "—"} />
              <InfoRow icon={Calendar} label="Quando" value={(qualData.travel_dates as string) || "—"} />
              <InfoRow icon={Users} label="Viajantes" value={qualData.travelers_count ? `${qualData.travelers_count} (${qualData.travelers_type || "?"})` : "—"} />
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Score</span>
                <span className="font-mono font-semibold tabular-nums">{lead?.qualification_score || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant={
                    lead?.qualification_status === "qualified"
                      ? "default"
                      : lead?.qualification_status === "warm"
                        ? "secondary"
                        : lead?.qualification_status === "disqualified"
                          ? "destructive"
                          : "outline"
                  }
                >
                  {statusLabel(lead?.qualification_status || "pending")}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Etapa</span>
                <span className="text-xs">{stepLabel(conversation.current_step)}</span>
              </div>
            </CardContent>
          </Card>

          {conversation.handoff_summary && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Resumo do Handoff</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-mono">
                  {conversation.handoff_summary}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <span className="text-right">{value}</span>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    qualified: "Qualificado",
    warm: "Morno",
    disqualified: "Desqualificado",
    pending: "Pendente",
    inactive: "Inativo",
  };
  return labels[status] || status;
}

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    greeting: "Saudação",
    destination: "Destino",
    dates: "Datas",
    travelers: "Viajantes",
    experience: "Experiência",
    style: "Estilo",
    closing: "Encerramento",
    handoff: "Handoff",
  };
  return labels[step] || step;
}

function formatPhone(phone: string): string {
  if (phone.length === 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  return phone;
}
