import { Logger } from '@nestjs/common';
import { ISalesAgentProvider, SalesAgentContext, StructuredAgentDecision } from '../agent.interfaces';
import { RuleBasedSalesAgentProvider } from './rule-based.provider';

interface OllamaProviderConfig {
  timeoutMs?: number;
  historyLimit?: number;
  maxMessageChars?: number;
  temperature?: number;
  numPredict?: number;
  numCtx?: number;
  useJsonFormat?: boolean;
}

interface OllamaChatResponse {
  message?: { content?: string };
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaProvider implements ISalesAgentProvider {
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly timeoutMs: number;
  private readonly _historyLimit: number;
  private readonly maxMessageChars: number;
  private readonly temperature: number;
  private readonly numPredict: number;
  private readonly numCtx: number;
  private readonly _useJsonFormat: boolean;
  private readonly ruleProvider: RuleBasedSalesAgentProvider;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    config: OllamaProviderConfig = {},
  ) {
    this.timeoutMs = Math.round(Number(config.timeoutMs ?? 180_000));
    this._historyLimit = Math.round(Number(config.historyLimit ?? 6));
    this.maxMessageChars = Math.round(Number(config.maxMessageChars ?? 500));
    this.temperature = Number(config.temperature ?? 0.3);
    this.numPredict = Math.round(Number(config.numPredict ?? 80));
    this.numCtx = Math.round(Number(config.numCtx ?? 256));
    this._useJsonFormat = config.useJsonFormat === true || String(config.useJsonFormat) === 'true';
    this.ruleProvider = new RuleBasedSalesAgentProvider();
  }

  async generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision> {
    const { conversation, userMessage, availablePlans } = ctx;
    const startedAt = Date.now();

    // Step 1: get the full structured decision from rule-based provider
    const ruleDecision = await this.ruleProvider.generate(ctx);

    // Step 2: build a plain-text prompt for Ollama to generate only the message
    const plansText = availablePlans
      .map(
        (p) =>
          `${p.name}: COP ${Number(p.price).toLocaleString('es-CO')}/${p.billingPeriod === 'MONTHLY' ? 'mes' : 'año'} hasta ${p.maxUsers ?? 'ilimitados'} usuarios`,
      )
      .join(', ');

    const payload = {
      model: this.model,
      messages: [
        {
          role: 'system' as const,
          content:
            'Eres Becca, asesora comercial de BeccaSoft. Responde al cliente en máximo 2 oraciones en español colombiano. Solo el texto de la respuesta, sin explicaciones ni JSON.',
        },
        {
          role: 'user' as const,
          content: `Planes disponibles: ${plansText}
Industria detectada: ${ruleDecision.capturedData.companyIndustry ?? 'sin definir'}
Necesidades detectadas: ${ruleDecision.capturedData.needs?.join(', ') ?? 'sin definir'}
Intención detectada: ${ruleDecision.intent}
Siguiente acción sugerida: ${ruleDecision.nextAction}
Plan sugerido: ${ruleDecision.recommendedPlanName ?? 'sin definir'}
Mensaje base recomendado: ${ruleDecision.message}
Cliente pregunta: ${this.truncate(userMessage, this.maxMessageChars)}`,
        },
      ],
      stream: false,
      keep_alive: -1,
      options: {
        temperature: this.temperature,
        num_predict: this.numPredict,
        num_ctx: this.numCtx,
      },
    };

    this.logger.log(
      `Ollama hybrid request conversation=${conversation.id} model=${this.model} timeoutMs=${this.timeoutMs} numPredict=${this.numPredict} numCtx=${this.numCtx} messagePreview="${this.preview(userMessage)}"`,
    );

    const controller = new AbortController();
    const timeoutId =
      this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const errorBody = this.truncate(await response.text(), 800);
        this.logger.warn(
          `Ollama HTTP error conversation=${conversation.id} status=${response.status} durationMs=${durationMs} body="${this.preview(errorBody, 240)}" — using rule-based message`,
        );
        return ruleDecision;
      }

      const data = (await response.json()) as OllamaChatResponse;
      const raw = data?.message?.content?.trim() ?? '';

      this.logger.log(
        `Ollama hybrid response conversation=${conversation.id} durationMs=${durationMs} promptTokens=${data.prompt_eval_count ?? 0} outputTokens=${data.eval_count ?? 0} preview="${this.preview(raw)}"`,
      );

      const ollamaMessage = this.cleanPlainText(raw);

      if (!ollamaMessage) {
        this.logger.warn(
          `Ollama returned empty text conversation=${conversation.id} — using rule-based message`,
        );
        return ruleDecision;
      }

      // Step 3: combine — rule-based decision with Ollama-generated message
      return { ...ruleDecision, message: ollamaMessage };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      const durationMs = Date.now() - startedAt;
      const msg = (err as Error).message ?? '';

      if (msg.includes('abort') || msg.includes('AbortError')) {
        this.logger.warn(
          `Ollama timeout conversation=${conversation.id} durationMs=${durationMs} timeoutMs=${this.timeoutMs} model=${this.model} — using rule-based message`,
        );
      } else {
        this.logger.warn(
          `Ollama request failed conversation=${conversation.id} durationMs=${durationMs} model=${this.model}: ${msg} — using rule-based message`,
        );
      }

      // On any failure return the rule-based decision directly (no re-throw)
      return ruleDecision;
    }
  }

  async warmUp(): Promise<void> {
    try {
      this.logger.log(`Ollama warm-up iniciando modelo ${this.model} (num_ctx=${this.numCtx})...`);
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'hola' }],
          stream: false,
          keep_alive: -1,
          options: { num_predict: 1, num_ctx: this.numCtx },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.logger.log(`Ollama warm-up completado — modelo ${this.model} listo en memoria`);
    } catch (err) {
      this.logger.warn(`Ollama warm-up falló (no crítico): ${(err as Error).message}`);
    }
  }

  private cleanPlainText(raw: string): string {
    return raw
      .replace(/\{[\s\S]*\}/, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^\s*[*\-]\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{2,}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
      return value;
    }
    return `${value.slice(0, maxChars - 3)}...`;
  }

  private preview(value: string, maxChars: number = 160): string {
    return this.truncate(value.replace(/\s+/g, ' ').trim(), maxChars);
  }
}
