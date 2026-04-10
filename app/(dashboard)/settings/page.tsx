"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Bot, Phone, Users2, Ban, Trash2, Plus, MessageSquare } from "lucide-react";
import { toast } from "sonner";

interface NotifyTarget {
  id: string;
  target: string;
  type: "phone" | "group";
  label: string;
  notify_qualified: boolean;
  notify_warm: boolean;
  notify_daily_report: boolean;
  active: boolean;
}

interface ExcludedPhone {
  id: string;
  phone: string;
  label: string | null;
  reason: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const [agentConfig, setAgentConfig] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<NotifyTarget[]>([]);
  const [excluded, setExcluded] = useState<ExcludedPhone[]>([]);
  const [saving, setSaving] = useState(false);

  // New target form
  const [newTarget, setNewTarget] = useState({
    type: "phone" as "phone" | "group",
    target: "",
    label: "",
    notify_qualified: true,
    notify_warm: false,
    notify_daily_report: true,
  });

  // New excluded phone form
  const [newExcluded, setNewExcluded] = useState({ phone: "", label: "", reason: "" });

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const [s, t, e] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/notify-targets").then((r) => r.json()),
      fetch("/api/excluded-phones").then((r) => r.json()),
    ]);

    const configMap: Record<string, string> = {};
    for (const item of s.agentConfig || []) configMap[item.key] = item.value;
    setAgentConfig(configMap);
    setTargets(t.targets || []);
    setExcluded(e.phones || []);
  }

  async function saveAgent() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "agent", data: agentConfig }),
    });
    toast.success("Configurações salvas");
    setSaving(false);
  }

  async function addTarget() {
    if (!newTarget.target || !newTarget.label) {
      toast.error("Preencha destino e label");
      return;
    }
    const res = await fetch("/api/notify-targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTarget),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Erro ao adicionar");
      return;
    }
    toast.success("Destino adicionado");
    setNewTarget({ type: "phone", target: "", label: "", notify_qualified: true, notify_warm: false, notify_daily_report: true });
    loadAll();
  }

  async function toggleTarget(id: string, field: keyof NotifyTarget, value: boolean) {
    await fetch("/api/notify-targets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    });
    loadAll();
  }

  async function deleteTarget(id: string) {
    if (!confirm("Remover este destino?")) return;
    await fetch(`/api/notify-targets?id=${id}`, { method: "DELETE" });
    toast.success("Destino removido");
    loadAll();
  }

  async function addExcluded() {
    if (!newExcluded.phone) {
      toast.error("Informe o telefone");
      return;
    }
    const res = await fetch("/api/excluded-phones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newExcluded),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Erro ao adicionar");
      return;
    }
    toast.success("Número adicionado à whitelist");
    setNewExcluded({ phone: "", label: "", reason: "" });
    loadAll();
  }

  async function deleteExcluded(id: string) {
    if (!confirm("Remover este número da whitelist?")) return;
    await fetch(`/api/excluded-phones?id=${id}`, { method: "DELETE" });
    toast.success("Removido");
    loadAll();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-medium tracking-tight">Configurações</h1>

      {/* Modo do Bot */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Modo do Bot
          </CardTitle>
          <CardDescription>Controla quando a Miry ativa pra qualificar leads</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Modo de ativação</Label>
            <Select
              value={agentConfig.bot_mode || "all"}
              onValueChange={(v) => setAgentConfig({ ...agentConfig, bot_mode: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os números novos (modo teste)</SelectItem>
                <SelectItem value="ad_only">Somente leads de anúncios Meta (produção)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              <strong>Todos:</strong> bot responde qualquer número novo (ideal pra testar).<br />
              <strong>Somente anúncios:</strong> só ativa quando a mensagem vem de um clique em ad do Facebook/Instagram (recomendado em produção).
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Horário de silêncio</Label>
              <p className="text-xs text-muted-foreground">Bot não responde nesse intervalo</p>
            </div>
            <Switch
              checked={agentConfig.quiet_hours_enabled === "true"}
              onCheckedChange={(v) => setAgentConfig({ ...agentConfig, quiet_hours_enabled: String(v) })}
            />
          </div>

          {agentConfig.quiet_hours_enabled === "true" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs">Início</Label>
                <Input
                  type="time"
                  value={agentConfig.quiet_hours_start || "22:00"}
                  onChange={(e) => setAgentConfig({ ...agentConfig, quiet_hours_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Fim</Label>
                <Input
                  type="time"
                  value={agentConfig.quiet_hours_end || "08:00"}
                  onChange={(e) => setAgentConfig({ ...agentConfig, quiet_hours_end: e.target.value })}
                />
              </div>
            </div>
          )}

          <Button onClick={saveAgent} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            Salvar modo do bot
          </Button>
        </CardContent>
      </Card>

      {/* Destinos de notificação */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Destinos de Notificação
          </CardTitle>
          <CardDescription>
            Números ou grupos que recebem alertas de lead qualificado e relatório diário
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum destino configurado ainda</p>
          ) : (
            <div className="space-y-2">
              {targets.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    {t.type === "group" ? <Users2 className="h-4 w-4 text-muted-foreground" /> : <Phone className="h-4 w-4 text-muted-foreground" />}
                    <div>
                      <div className="text-sm font-medium">{t.label}</div>
                      <div className="font-mono text-xs text-muted-foreground">{t.target}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Qualificado</Label>
                      <Switch checked={t.notify_qualified} onCheckedChange={(v) => toggleTarget(t.id, "notify_qualified", v)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Relatório</Label>
                      <Switch checked={t.notify_daily_report} onCheckedChange={(v) => toggleTarget(t.id, "notify_daily_report", v)} />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteTarget(t.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="text-sm font-medium">Adicionar destino</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                value={newTarget.type}
                onValueChange={(v) => setNewTarget({ ...newTarget, type: v as "phone" | "group" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">📱 Número individual</SelectItem>
                  <SelectItem value="group">👥 Grupo WhatsApp</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Nome/Label (ex: Bernardo, Grupo Comercial)"
                value={newTarget.label}
                onChange={(e) => setNewTarget({ ...newTarget, label: e.target.value })}
              />
            </div>
            <Input
              placeholder={
                newTarget.type === "phone"
                  ? "5551999999999 (DDD + número, sem +)"
                  : "ID do grupo (ex: 120363407808868215-group)"
              }
              value={newTarget.target}
              onChange={(e) => setNewTarget({ ...newTarget, target: e.target.value })}
            />
            <Button onClick={addTarget} variant="outline" size="sm">
              <Plus className="mr-2 h-3 w-3" />
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Whitelist (excluded) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Ban className="h-4 w-4" />
            Números excluídos (whitelist)
          </CardTitle>
          <CardDescription>
            Números nessa lista <strong>nunca</strong> serão qualificados pela Miry — use pra clientes existentes, parceiros, etc
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {excluded.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum número excluído</p>
          ) : (
            <div className="space-y-2">
              {excluded.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{p.label || "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.phone}</div>
                    {p.reason && <div className="text-xs text-muted-foreground mt-1">{p.reason}</div>}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteExcluded(p.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="text-sm font-medium">Adicionar número à whitelist</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Telefone (ex: 5551999999999)"
                value={newExcluded.phone}
                onChange={(e) => setNewExcluded({ ...newExcluded, phone: e.target.value })}
              />
              <Input
                placeholder="Label (ex: Cliente ABC)"
                value={newExcluded.label}
                onChange={(e) => setNewExcluded({ ...newExcluded, label: e.target.value })}
              />
            </div>
            <Input
              placeholder="Motivo (opcional)"
              value={newExcluded.reason}
              onChange={(e) => setNewExcluded({ ...newExcluded, reason: e.target.value })}
            />
            <Button onClick={addExcluded} variant="outline" size="sm">
              <Plus className="mr-2 h-3 w-3" />
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
