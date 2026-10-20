/**
 * Variáveis de run reservadas que o compile referencia e o executor preenche.
 *
 * TRIGGER_MESSAGE_VAR: a mensagem que disparou o fluxo, persistida em
 * `variables` (sobrevive à retomada de um "Perguntar", ao contrário da saída do
 * nó __trigger). Usada por condições que só rodam depois de uma retomada.
 */
export const TRIGGER_MESSAGE_VAR = "__trigger_message";
