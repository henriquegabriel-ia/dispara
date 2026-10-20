import "server-only";

import { buildTextMessage } from "@/lib/whatsapp/text";
import { buildListMessage, buildReplyButtons } from "@/lib/whatsapp/interactive";
import { WhatsAppSendTextRequestSchema } from "@/lib/shared/whatsapp-schema";
import { withStepLogging, type StepInput } from "../step-handler";
import {
  getCredentials,
  resolveRecipient,
  sendWhatsAppPayload,
} from "./shared";

type AskQuestionResult =
  | { success: true; data: unknown }
  | { success: false; error: string; details?: unknown };

export type AskQuestionInput = StepInput & {
  to?: string;
  toSource?: string;
  message?: string;
  previewUrl?: boolean | string;
  /** rótulos dos botões (branches do "Perguntar"), emitidos pelo compile */
  buttons?: unknown;
  triggerData?: Record<string, unknown>;
  _debugAskQuestion?: Record<string, unknown> | null;
};

/** Limites do WhatsApp para mensagens interativas. */
const MAX_REPLY_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const MAX_BUTTON_TITLE = 20;
const MAX_LIST_TITLE = 24;
const MAX_OPTION_ID = 256;
const MAX_INTERACTIVE_BODY = 1024;
const LIST_BUTTON_TEXT = "Ver opções";

/** Rótulos válidos (texto não vazio, sem repetição), no máximo 10. */
function askOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const label = String(item ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.slice(0, MAX_LIST_ROWS);
}

export async function askQuestionStep(
  input: AskQuestionInput
): Promise<AskQuestionResult> {
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

    const message = String(input.message || "").trim();
    if (!message) {
      return { success: false, error: "Message is required" };
    }

    const options = askOptions(input.buttons);
    let payload: unknown;
    if (options.length > 0 && message.length <= MAX_INTERACTIVE_BODY) {
      // Botões interativos (até 3) ou lista (4 a 10 opções). O id de cada opção
      // é o próprio rótulo: a retomada casa a resposta pelo id ou pelo título.
      payload =
        options.length <= MAX_REPLY_BUTTONS
          ? buildReplyButtons({
              to: recipient.to,
              body: message,
              buttons: options.map((label) => ({
                id: label.slice(0, MAX_OPTION_ID),
                title: label.slice(0, MAX_BUTTON_TITLE),
              })),
            })
          : buildListMessage({
              to: recipient.to,
              body: message,
              buttonText: LIST_BUTTON_TEXT,
              sections: [
                {
                  rows: options.map((label) => ({
                    id: label.slice(0, MAX_OPTION_ID),
                    title: label.slice(0, MAX_LIST_TITLE),
                  })),
                },
              ],
            });
    } else {
      const previewUrl =
        typeof input.previewUrl === "boolean"
          ? input.previewUrl
          : input.previewUrl === "true";

      const textPayload = buildTextMessage({
        to: recipient.to,
        text: message,
        previewUrl,
      });

      const parsed = WhatsAppSendTextRequestSchema.safeParse(textPayload);
      if (!parsed.success) {
        return {
          success: false,
          error: "Invalid WhatsApp payload",
          details: parsed.error.flatten(),
        };
      }
      payload = parsed.data;
    }

    const result = await sendWhatsAppPayload(credentials, payload);
    if (!result.ok) {
      return { success: false, error: result.error, details: result.data };
    }

    const debugPayload = input._debugAskQuestion;
    const responseData: Record<string, unknown> =
      result.data && typeof result.data === "object"
        ? { ...(result.data as Record<string, unknown>) }
        : { value: result.data };
    if (debugPayload) {
      responseData._debugAskQuestion = debugPayload;
    }

    return { success: true, data: responseData };
  });
}
askQuestionStep.maxRetries = 0;

export const _integrationType = "whatsapp";
