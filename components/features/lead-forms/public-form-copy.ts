/*
 * Textos do formulário público (/f/[slug]).
 *
 * A pré-visualização do editor (LeadFormPreview) promete mostrar "como o
 * formulário aparece para quem abre o link", então os dois leem daqui para não
 * divergirem.
 */
export const PUBLIC_FORM_COPY = {
  description: 'Preencha seus dados para ser adicionado automaticamente na lista.',
  nameLabel: 'Nome',
  namePlaceholder: 'Seu nome',
  phoneLabel: 'Telefone (WhatsApp)',
  emailLabel: 'E-mail',
  emailDescription: 'Opcional.',
  emailPlaceholder: 'voce@exemplo.com',
  submit: 'Enviar cadastro',
  submitting: 'Enviando…',
  consent: 'Ao enviar, você concorda em receber mensagens relacionadas ao conteúdo/curso.',
} as const
