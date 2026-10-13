'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { CircleSlash } from 'lucide-react'
import {
  EiaAlert,
  EiaBadge,
  EiaButton,
  EiaField,
  EiaInput,
  EiaPanel,
  EiaSelect,
  EiaSkeleton,
} from '@/components/eia'
import { InternationalPhoneInput } from '@/components/app/international-phone-input'
import { PageDescription, PageTitle } from '@/components/app/page'
import { PUBLIC_FORM_COPY } from '@/components/features/lead-forms/public-form-copy'

type PublicLeadForm = {
  id: string
  name: string
  slug: string
  isActive: boolean
  collectEmail?: boolean
  successMessage?: string | null
  fields?: Array<{
    key: string
    label: string
    type: 'text' | 'number' | 'date' | 'select'
    required?: boolean
    options?: string[]
  }>
}

/*
 * Opção "Não informar" dos selects opcionais: o EiaSelect não volta ao
 * placeholder depois de uma escolha, então este valor sentinela é convertido
 * de volta para '' (o mesmo valor que o select antigo enviava sem resposta).
 */
const CLEAR_SELECT_VALUE = '__dispara_nao_informar__'

/** Erro de carregamento: título curto + o que a pessoa pode fazer. */
type LoadError = { title: string; description: string }

/*
 * Mensagens de erro próprias: a exceção de rede do fetch (TypeError) traz o
 * texto cru do navegador, em inglês ("Failed to fetch"), que não orienta.
 * A mensagem da API só é usada quando há resposta HTTP.
 */
const LINK_HINT = 'Confira se o link está completo ou peça um novo a quem enviou.'
const INVALID_LINK_ERROR: LoadError = { title: 'Link inválido', description: LINK_HINT }
const NETWORK_LOAD_ERROR: LoadError = {
  title: 'Não foi possível carregar o formulário',
  description: 'Verifique sua conexão e recarregue a página.',
}
const SERVER_LOAD_ERROR: LoadError = {
  title: 'Não foi possível carregar o formulário',
  description: 'Recarregue a página em alguns instantes. Se o erro continuar, avise quem enviou o link.',
}
const NETWORK_SUBMIT_ERROR = 'Verifique sua conexão e tente enviar de novo.'
const SERVER_SUBMIT_ERROR = 'Tente enviar de novo em alguns instantes.'

/** Mensagem `error` do corpo de uma resposta da API, se houver. */
function apiErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const error = (payload as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : undefined
}

/** Esqueleto do formulário enquanto o schema carrega (decorativo: o título anuncia o carregamento). */
function FormSkeleton() {
  return (
    <div className="flex flex-col gap-(--eia-space-5)">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-(--eia-space-2)">
          <EiaSkeleton variant="text" width="8rem" />
          <EiaSkeleton height="var(--eia-control-md)" />
        </div>
      ))}
      <EiaSkeleton height="var(--eia-control-md)" />
    </div>
  )
}

export default function PublicLeadFormPage() {
  // Em Next.js 16, páginas Client podem não receber `params` da forma tradicional.
  // `useParams()` é a forma mais confiável para obter o slug no client.
  const params = useParams<{ slug?: string | string[] }>()
  const slug = useMemo(() => {
    const raw = params?.slug
    if (Array.isArray(raw)) return String(raw[0] || '')
    return String(raw || '')
  }, [params])

  const [form, setForm] = useState<PublicLeadForm | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<LoadError | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [customFields, setCustomFields] = useState<Record<string, string>>({})

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const successRef = useRef<HTMLDivElement>(null)

  const isInactive = form?.isActive === false && !loadError
  const collectEmail = form?.collectEmail ?? true
  const showForm = !isLoading && !!form && form.isActive !== false && !loadError && !successMessage

  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setLoadError(null)

      try {
        // fetch só rejeita sem resposta HTTP (rede/conexão): vira null aqui.
        const resp = await fetch(`/api/public/lead-forms/${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        }).catch(() => null)

        if (cancelled) return
        if (!resp) {
          setLoadError(NETWORK_LOAD_ERROR)
          return
        }

        const payload = await resp.json().catch(() => ({}))
        if (cancelled) return

        // Se estiver desativado, a API retorna 403 com um payload que inclui nome/slug.
        if (!resp.ok) {
          if (resp.status === 403 && payload && typeof payload === 'object' && payload.isActive === false) {
            setForm(payload as PublicLeadForm)
            return
          }
          setLoadError(
            resp.status === 404
              ? { title: apiErrorMessage(payload) ?? 'Formulário não encontrado', description: LINK_HINT }
              : SERVER_LOAD_ERROR
          )
          return
        }

        setForm(payload as PublicLeadForm)
      } catch {
        if (!cancelled) setLoadError(SERVER_LOAD_ERROR)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    if (slug) load()
    else {
      setLoadError(INVALID_LINK_ERROR)
      setIsLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [slug])

  // Se o form não coleta email, evita manter valor antigo no state.
  useEffect(() => {
    if ((form?.collectEmail ?? true) === false) {
      setEmail('')
    }
  }, [form?.collectEmail])

  // O formulário some depois do envio: o foco vai para a confirmação (senão cairia no body).
  useEffect(() => {
    if (successMessage) successRef.current?.focus()
  }, [successMessage])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSuccessMessage(null)

    if (!form || form.isActive === false) return

    setIsSubmitting(true)
    try {
      // fetch só rejeita sem resposta HTTP (rede/conexão): vira null aqui.
      const resp = await fetch(`/api/public/lead-forms/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          email: (form.collectEmail ?? true) ? (email.trim() ? email.trim() : null) : null,
          custom_fields: customFields,
          website,
        }),
      }).catch(() => null)

      if (!resp) {
        setSubmitError(NETWORK_SUBMIT_ERROR)
        return
      }

      const payload = await resp.json().catch(() => ({}))

      if (!resp.ok) {
        // Erro do servidor: a mensagem da API não orienta, então só pede nova tentativa.
        if (resp.status >= 500) {
          setSubmitError(SERVER_SUBMIT_ERROR)
          return
        }

        // Se vier mapa de erros do Zod, tenta mostrar algo legível.
        const zodDetails = payload?.details
        if (zodDetails && typeof zodDetails === 'object') {
          const firstKey = Object.keys(zodDetails)[0]
          const firstMsg = firstKey ? (zodDetails[firstKey]?.[0] as string | undefined) : undefined
          setSubmitError(firstMsg || apiErrorMessage(payload) || 'Confira os campos e tente enviar de novo.')
          return
        }

        setSubmitError(apiErrorMessage(payload) ?? SERVER_SUBMIT_ERROR)
        return
      }

      setSuccessMessage(payload?.message || form.successMessage || 'Cadastro recebido! Obrigado.')
      setName('')
      setPhone('')
      setEmail('')
      setWebsite('')
      setCustomFields({})
    } catch {
      setSubmitError(SERVER_SUBMIT_ERROR)
    } finally {
      setIsSubmitting(false)
    }
  }

  const setCustomField = (key: string, value: string) =>
    setCustomFields((prev) => ({ ...prev, [key]: value }))

  const description = isInactive
    ? 'Este formulário está temporariamente indisponível.'
    : showForm
      ? PUBLIC_FORM_COPY.description
      : null

  return (
    // Página pública fora do shell (pode ser embutida): canvas chapado do DS,
    // por isso o cartão é sólido (dense) e não vidro.
    <main className="flex min-h-dvh items-start justify-center bg-eia-bg px-4 py-6 text-eia-text sm:items-center sm:py-12">
      <EiaPanel
        as="section"
        material="dense"
        aria-labelledby="lead-form-title"
        aria-busy={isLoading || undefined}
        className="w-full max-w-xl"
      >
        <header className="mb-(--eia-space-6)">
          <div className="flex flex-wrap items-center gap-(--eia-space-3)">
            <PageTitle id="lead-form-title">
              {isLoading ? 'Carregando formulário…' : (form?.name || 'Formulário')}
            </PageTitle>
            {isInactive ? (
              <EiaBadge tone="neutral">
                <CircleSlash aria-hidden="true" />
                Desativado
              </EiaBadge>
            ) : null}
          </div>
          {description ? <PageDescription>{description}</PageDescription> : null}
        </header>

        {isLoading ? <FormSkeleton /> : null}

        {loadError ? (
          <EiaAlert tone="danger" title={loadError.title}>
            {loadError.description}
          </EiaAlert>
        ) : null}

        {isInactive ? (
          <EiaAlert tone="info" icon={<CircleSlash />}>
            Se você recebeu este link, peça um novo ou confirme com o responsável se o formulário
            foi reativado. Depois, recarregue esta página.
          </EiaAlert>
        ) : null}

        {successMessage ? (
          <EiaAlert ref={successRef} tabIndex={-1} tone="success" className="outline-none">
            {successMessage}
          </EiaAlert>
        ) : null}

        {showForm ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-(--eia-space-5)">
            <EiaField label={PUBLIC_FORM_COPY.nameLabel} htmlFor="name" required>
              <EiaInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={PUBLIC_FORM_COPY.namePlaceholder}
                autoComplete="name"
                required
              />
            </EiaField>

            {/*
             * Telefone com o campo internacional de components/app (o
             * EiaPhoneInput do DS cobre só 7 países). Ele não lê o contexto do
             * EiaField, então o id vai explícito: o <label for> nomeia o campo e
             * o `required` faz o leitor de tela anunciar "obrigatório".
             */}
            <EiaField label={PUBLIC_FORM_COPY.phoneLabel} htmlFor="phone" required>
              <InternationalPhoneInput
                id="phone"
                required
                value={phone}
                onChange={setPhone}
                // Importante: manter SSR/CSR determinístico para evitar hydration mismatch
                // (erro 418 do React em produção).
                defaultCountry="br"
                preferredCountries={['br', 'us', 'pt', 'mx', 'ar', 'cl', 'co', 'es']}
              />
            </EiaField>

            {collectEmail ? (
              <EiaField
                label={PUBLIC_FORM_COPY.emailLabel}
                htmlFor="email"
                description={PUBLIC_FORM_COPY.emailDescription}
              >
                <EiaInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={PUBLIC_FORM_COPY.emailPlaceholder}
                  autoComplete="email"
                />
              </EiaField>
            ) : null}

            {(form.fields || []).map((f) => {
              const key = f.key
              const fieldId = `cf_${key}`
              const value = customFields[key] ?? ''

              if (f.type === 'select') {
                // '' = sem seleção no EiaSelect: não pode virar opção; repetidas saem.
                const choices = Array.from(new Set((f.options || []).filter((opt) => opt !== '')))
                const options = [
                  ...(f.required ? [] : [{ value: CLEAR_SELECT_VALUE, label: 'Não informar' }]),
                  ...choices.map((opt) => ({ value: opt, label: opt })),
                ]
                return (
                  <EiaField key={key} label={f.label} htmlFor={fieldId} required={!!f.required}>
                    <EiaSelect
                      label={f.label}
                      name={fieldId}
                      value={value}
                      onValueChange={(next) =>
                        setCustomField(key, next === CLEAR_SELECT_VALUE ? '' : next)
                      }
                      options={options}
                      required={!!f.required}
                    />
                  </EiaField>
                )
              }

              const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'

              return (
                <EiaField key={key} label={f.label} htmlFor={fieldId} required={!!f.required}>
                  <EiaInput
                    value={value}
                    onChange={(e) => setCustomField(key, e.target.value)}
                    type={inputType}
                    required={!!f.required}
                  />
                </EiaField>
              )
            })}

            {/* Honeypot anti-spam (não mostrar) */}
            <div className="hidden" aria-hidden="true">
              <EiaField label="Website" htmlFor="website">
                <EiaInput
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </EiaField>
            </div>

            {submitError ? (
              <EiaAlert tone="danger" size="compact" title="Não foi possível enviar o cadastro">
                {submitError}
              </EiaAlert>
            ) : null}

            <div className="flex flex-col gap-(--eia-space-3)">
              {/* EiaButton não estica por className (eia.css sem @layer): largura via style. */}
              <EiaButton
                type="submit"
                size="lg"
                loading={isSubmitting}
                disabled={isLoading || !form}
                style={{ width: '100%' }}
              >
                {isSubmitting ? PUBLIC_FORM_COPY.submitting : PUBLIC_FORM_COPY.submit}
              </EiaButton>

              <p className="text-(length:--eia-type-label) text-eia-muted">{PUBLIC_FORM_COPY.consent}</p>
            </div>
          </form>
        ) : null}
      </EiaPanel>
    </main>
  )
}
