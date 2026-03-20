"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Save, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

interface ZapiConfig {
  instance_id: string;
  token: string;
  client_token: string;
  webhook_url: string;
  status: string;
  phone_connected: string;
}

export default function SettingsPage() {
  const [zapiConfig, setZapiConfig] = useState<ZapiConfig>({
    instance_id: "",
    token: "",
    client_token: "",
    webhook_url: "",
    status: "disconnected",
    phone_connected: "",
  });
  const [agentConfig, setAgentConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.zapiConfig) {
      setZapiConfig(data.zapiConfig);
    }
    const configMap: Record<string, string> = {};
    for (const item of data.agentConfig || []) {
      configMap[item.key] = item.value;
    }
    setAgentConfig(configMap);
  }

  async function saveZapi() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "zapi",
        data: {
          instance_id: zapiConfig.instance_id,
          token: zapiConfig.token,
          client_token: zapiConfig.client_token,
          webhook_url: zapiConfig.webhook_url,
        },
      }),
    });
    toast.success("Configurações Z-API salvas!");
    setSaving(false);
  }

  async function saveAgent() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "agent", data: agentConfig }),
    });
    toast.success("Configurações do agente salvas!");
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-medium tracking-tight">Configurações</h1>

      {/* Z-API Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Z-API — WhatsApp</CardTitle>
              <CardDescription>Configure a conexão com o WhatsApp via Z-API</CardDescription>
            </div>
            <Badge variant={zapiConfig.status === "connected" ? "default" : "destructive"} className="gap-1">
              {zapiConfig.status === "connected" ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {zapiConfig.status === "connected" ? "Conectado" : "Desconectado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Instance ID</Label>
              <Input
                value={zapiConfig.instance_id}
                onChange={(e) => setZapiConfig({ ...zapiConfig, instance_id: e.target.value })}
                placeholder="Seu Instance ID da Z-API"
              />
            </div>
            <div className="space-y-2">
              <Label>Token</Label>
              <Input
                value={zapiConfig.token}
                onChange={(e) => setZapiConfig({ ...zapiConfig, token: e.target.value })}
                placeholder="Seu Token da Z-API"
                type="password"
              />
            </div>
            <div className="space-y-2">
              <Label>Client Token</Label>
              <Input
                value={zapiConfig.client_token}
                onChange={(e) => setZapiConfig({ ...zapiConfig, client_token: e.target.value })}
                placeholder="Client Token (segurança do webhook)"
                type="password"
              />
            </div>
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <Input
                value={zapiConfig.webhook_url}
                onChange={(e) => setZapiConfig({ ...zapiConfig, webhook_url: e.target.value })}
                placeholder="https://seu-dominio.vercel.app/api/webhook/zapi"
                readOnly
              />
              <p className="text-xs text-muted-foreground">
                Configure esta URL no painel da Z-API como Webhook de recebimento
              </p>
            </div>
          </div>
          <Button onClick={saveZapi} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            Salvar Z-API
          </Button>
        </CardContent>
      </Card>

      {/* Agent Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agente de Qualificação</CardTitle>
          <CardDescription>Ajuste o comportamento da Miry</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Prompt do Sistema</Label>
            <Textarea
              value={agentConfig.system_prompt || ""}
              onChange={(e) => setAgentConfig({ ...agentConfig, system_prompt: e.target.value })}
              rows={6}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Score Qualificado (mín)</Label>
              <Input
                type="number"
                value={agentConfig.qualification_threshold_qualified || "60"}
                onChange={(e) =>
                  setAgentConfig({ ...agentConfig, qualification_threshold_qualified: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Score Morno (mín)</Label>
              <Input
                type="number"
                value={agentConfig.qualification_threshold_warm || "30"}
                onChange={(e) =>
                  setAgentConfig({ ...agentConfig, qualification_threshold_warm: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Máx Mensagens Bot</Label>
              <Input
                type="number"
                value={agentConfig.max_bot_messages || "15"}
                onChange={(e) => setAgentConfig({ ...agentConfig, max_bot_messages: e.target.value })}
              />
            </div>
          </div>
          <Separator />
          <Button onClick={saveAgent} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            Salvar Agente
          </Button>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como Configurar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">1.</strong> Crie uma instância na{" "}
            <a href="https://z-api.io" target="_blank" rel="noopener" className="text-primary underline">
              Z-API
            </a>{" "}
            e copie o Instance ID, Token e Client Token.
          </p>
          <p>
            <strong className="text-foreground">2.</strong> Cole as credenciais acima e salve.
          </p>
          <p>
            <strong className="text-foreground">3.</strong> No painel da Z-API, configure o webhook de
            recebimento com a URL:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              https://seu-dominio.vercel.app/api/webhook/zapi
            </code>
          </p>
          <p>
            <strong className="text-foreground">4.</strong> Escaneie o QR Code na Z-API para conectar o
            WhatsApp.
          </p>
          <p>
            <strong className="text-foreground">5.</strong> O bot começará a responder automaticamente
            quando leads mandarem mensagem.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
