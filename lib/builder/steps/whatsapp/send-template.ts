import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import { buildMetaTemplatePayload } from "@/lib/whatsapp/template-contract";
import type { Template } from "@/types";
import { withStepLogging, type StepInput } from "../step-handler";
import {
  getCredentials,
  parseJsonArray,
  resolveRecipient,
  sendWhatsAppPayload,
} from "./shared";

type SendTemplateResult =
  | { success: true; data: unknown }
  | { success: false; error: string; details?: unknown };

type TemplateParam = { key?: string; text?: string };
type ButtonParam = { index?: number; params?: Array<{ text?: string }> };

export type SendTemplateInput = StepInput & {
  to?: string;
  toSource?: string;
  templateName?: string;
  language?: string;
  parameterFormat?: string;
  /**
   * Parâmetros do BODY: lista de valores ({{1}}, {{2}}…) — formato do compile
   * (templateBodyParams da tela) — ou a string JSON legada [{ key?, text }].
   */
  bodyParams?: string | string[];
  headerParams?: string;
  buttonParams?: string;
  /** mídia do HEADER (substitui a mídia de exemplo do template aprovado) */
  headerMediaUrl?: string;
  triggerData?: Record<string, unknown>;
};

type TemplateRow = {
  name: string;
  language?: string | null;
  status?: string | null;
  components?: unknown;
  parameter_format?: string | null;
};

function parseComponents(raw: unknown): Template["components"] {
  if (Array.isArray(raw)) return raw as Template["components"];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Template["components"]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Template do cache local (tabela templates, sincronizada da Meta) pelo nome e
 * idioma. Se não houver o idioma pedido mas existir UM único template aprovado
 * com esse nome (ex.: só en_US), usa o idioma dele — fluxos antigos sem
 * `templateLanguage` saíam sempre com pt_BR e a Meta respondia 132001.
 */
async function loadTemplate(
  name: string,
  language: string
): Promise<TemplateRow | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("templates")
    .select("name, language, status, components, parameter_format")
    .eq("name", name);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const rows = data as TemplateRow[];
  const exact = rows.find((row) => (row.language ?? "pt_BR") === language);
  if (exact) return exact;
  const approved = rows.filter(
    (row) => String(row.status ?? "").toUpperCase() === "APPROVED"
  );
  return approved.length === 1 ? approved[0] : null;
}

/** Quantidade de variáveis posicionais ({{1}}, {{2}}…) no BODY do template. */
function countBodyPlaceholders(components: Template["components"]): number {
  const body = (components ?? []).find(
    (component) => String(component?.type ?? "").toUpperCase() === "BODY"
  );
  const text = String((body as { text?: unknown } | undefined)?.text ?? "");
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) found.add(match[1]);
  return found.size;
}

/** bodyParams do config → [{ key, text }] (lista de valores ou JSON legado). */
function resolveBodyParams(raw: unknown): Array<{ key: string; text: string }> {
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
    return (raw as string[])
      .map((text, index) => ({ key: String(index + 1), text }))
      .filter((item) => item.text.trim().length > 0);
  }
  return parseJsonArray<TemplateParam>(raw)
    .filter((item) => item?.text)
    .map((item) => ({ key: item.key || "1", text: String(item.text) }));
}

export async function sendTemplateStep(
  input: SendTemplateInput
): Promise<SendTemplateResult> {
  "use step";

  return withStepLogging(input, async () => {
    const credentials = await getCredentials();
    if (!credentials) {
      return { success: false, error: "WhatsApp not configured" };
    }

    const recipient = resolveRecipient(input);
    if (!recipient.ok) {
      return { success: false, error: recipient.error };
    }

    const templateName = String(input.templateName || "").trim();
    if (!templateName) {
      return { success: false, error: "Template name is required" };
    }

    const requestedLanguage = String(input.language || "pt_BR");
    const row = await loadTemplate(templateName, requestedLanguage);
    const language = row?.language || requestedLanguage;
    const parameterFormat =
      input.parameterFormat === "named" || row?.parameter_format === "named"
        ? "named"
        : "positional";

    const body = resolveBodyParams(input.bodyParams);
    const headerParams = parseJsonArray<TemplateParam>(input.headerParams);
    const buttonParams = parseJsonArray<ButtonParam>(input.buttonParams);

    let template: Template | undefined;
    if (row) {
      let components = parseComponents(row.components);
      const headerMediaUrl = String(input.headerMediaUrl ?? "").trim();
      if (headerMediaUrl) {
        // A mídia escolhida no passo substitui a de exemplo do HEADER de mídia.
        components = (components ?? []).map((component) =>
          String(component?.type ?? "").toUpperCase() === "HEADER"
            ? { ...component, example: { header_handle: [headerMediaUrl] } }
            : component
        ) as Template["components"];
      }
      template = {
        name: row.name,
        language,
        components,
      } as unknown as Template;

      // Na dúvida, não envia: template com {{n}} sem valor seria recusado pela
      // Meta (132000) — falha explícita em vez de payload incompleto.
      const required = parameterFormat === "positional" ? countBodyPlaceholders(components) : 0;
      if (required > body.length) {
        return {
          success: false,
          error: `Template "${templateName}" exige ${required} variável(is) no corpo, mas o passo informa ${body.length}. Preencha as variáveis do template no passo.`,
        };
      }
    }

    let payload: unknown;
    try {
      payload = buildMetaTemplatePayload({
        to: recipient.to,
        templateName,
        language,
        parameterFormat,
        template,
        values: {
          header: headerParams
            .filter((item) => item?.text)
            .map((item) => ({
              key: item.key || "1",
              text: String(item.text),
            })),
          body,
          buttons: buttonParams
            .filter((item) => typeof item?.index === "number")
            .map((item) => ({
              index: item.index as number,
              params: (item.params || [])
                .filter((p) => p?.text)
                .map((p) => ({
                  key: "1",
                  text: String(p.text),
                })),
            })),
        },
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid template payload",
      };
    }

    const result = await sendWhatsAppPayload(credentials, payload);
    if (!result.ok) {
      return { success: false, error: result.error, details: result.data };
    }

    return { success: true, data: result.data };
  });
}
sendTemplateStep.maxRetries = 0;

export const _integrationType = "whatsapp";
