"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Bot, User, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Conversation {
  id: string;
  phone: string;
  bot_active: boolean;
  current_step: string;
  messages_count: number;
  bot_messages_count: number;
  last_message_at: string;
  started_at: string;
  handoff_summary: string | null;
  leads: {
    name: string | null;
    phone: string;
    qualification_status: string;
    qualification_score: number;
  } | null;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchConversations() {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      setConversations(data.conversations || []);
    } finally {
      setLoading(false);
    }
  }

  async function toggleBot(convId: string, active: boolean) {
    await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: convId, active }),
    });
    fetchConversations();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Conversas</h1>
          <p className="text-sm text-muted-foreground">
            {conversations.filter((c) => c.bot_active).length} com bot ativo
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchConversations}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-16 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-8 w-8 mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Nenhuma conversa ainda</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <Link key={conv.id} href={`/conversations/${conv.id}`}>
              <Card className="cursor-pointer transition-colors hover:bg-accent/30">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {conv.leads?.name || formatPhone(conv.phone)}
                        </span>
                        {conv.bot_active && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Bot className="h-3 w-3" />
                            Bot ativo
                          </Badge>
                        )}
                        {conv.leads?.qualification_status && conv.leads.qualification_status !== "pending" && (
                          <Badge
                            variant={
                              conv.leads.qualification_status === "qualified"
                                ? "default"
                                : conv.leads.qualification_status === "warm"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="text-xs"
                          >
                            {conv.leads.qualification_status === "qualified"
                              ? "Qualificado"
                              : conv.leads.qualification_status === "warm"
                                ? "Morno"
                                : "Desqualificado"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">{formatPhone(conv.phone)}</span>
                        <span>Etapa: {stepLabel(conv.current_step)}</span>
                        <span>{conv.messages_count} msgs</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(conv.last_message_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                    <Button
                      variant={conv.bot_active ? "destructive" : "outline"}
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleBot(conv.id, !conv.bot_active);
                      }}
                    >
                      <Bot className="mr-1 h-3 w-3" />
                      {conv.bot_active ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
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
    inactive: "Inativo",
  };
  return labels[step] || step;
}

function formatPhone(phone: string): string {
  if (phone.length === 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  return phone;
}
