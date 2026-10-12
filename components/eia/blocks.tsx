'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Download,
  Layers,
  Search,
  X,
} from 'lucide-react';
import {
  EiaAlert,
  EiaBadge,
  EiaButton,
  EiaCheckbox,
  EiaEmpty,
  EiaField,
  EiaInput,
  EiaLink,
  EiaPanel,
  EiaSelect,
  EiaTable,
  EiaTableBody,
  EiaTableCell,
  EiaTableHead,
  EiaTableHeader,
  EiaTableRow,
  EiaTextarea,
} from './index';

export type HeroBlockProps = {
  title?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  eyebrowAside?: ReactNode;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; href: string };
  /** Overrides the default action composition. Pass null to hide actions. */
  actions?: ReactNode;
  /** Overrides the decorative artwork. Pass null to hide it. */
  artwork?: ReactNode;
  artworkSrc?: string | null;
  aside?: ReactNode;
  children?: ReactNode;
  /** Pass null to hide the signoff. */
  signoff?: ReactNode;
  className?: string;
  id?: string;
};

/** Approved landing hero; optional slots keep copy and live previews composable. */
export function HeroBlock({
  title,
  description = 'Aprenda a usar IA, tire projetos do papel e construa uma operação que trabalha com você.',
  eyebrow = 'IA aplicada a negócios',
  eyebrowAside = 'Da ideia à prática',
  primaryAction,
  secondaryAction = { label: 'Conheça o caminho', href: '#caminho' },
  actions,
  artwork,
  artworkSrc = '/materials/empreende-glass-hero.jpg',
  aside,
  children,
  signoff,
  className = '',
  id,
}: HeroBlockProps) {
  const headingId = useId();
  const defaultActions = (
    <>
      {primaryAction && (
        <EiaButton
          variant="primary"
          size="lg"
          className="glass-button primary"
          onClick={primaryAction.onClick}
          trailingIcon={<ArrowUpRight size={19} />}
        >
          {primaryAction.label}
        </EiaButton>
      )}
      <EiaLink
        className="glass-button ghost"
        variant="ghost"
        href={secondaryAction.href}
      >
        {secondaryAction.label}
        <ArrowDown size={16} aria-hidden="true" />
      </EiaLink>
    </>
  );

  return (
    <section
      id={id}
      className={`eia-hero-block glass-hero ${className}`}
      aria-labelledby={headingId}
    >
      {artwork !== undefined
        ? artwork
        : artworkSrc && (
            <Image
              className="glass-hero-art"
              src={artworkSrc}
              width={1672}
              height={941}
              alt=""
              priority
              unoptimized
            />
          )}
      <div className="glass-hero-content">
        <span className="glass-kicker">
          <span className="kicker-mark">
            <Layers size={12} aria-hidden="true" />
          </span>
          {eyebrow}
          {eyebrowAside && (
            <>
              <span className="kicker-divider" aria-hidden="true" />
              {eyebrowAside}
            </>
          )}
        </span>
        <h1 id={headingId}>
          {title ?? (
            <>
              Inteligência
              <br />
              <span>para quem</span> faz<i>.</i>
            </>
          )}
        </h1>
        {description && <p>{description}</p>}
        {actions !== null && (
          <div className="glass-hero-actions">{actions ?? defaultActions}</div>
        )}
        {signoff !== null && (
          <div className="glass-hero-signoff">
            <span className="signoff-line" aria-hidden="true" />
            {signoff ?? (
              <span>
                Menos distância entre
                <br />
                <strong>saber e fazer.</strong>
              </span>
            )}
          </div>
        )}
      </div>
      {aside}
      {children}
    </section>
  );
}

export type MetricBlockProps = {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  description?: ReactNode;
  index?: ReactNode;
  material?: 'hero' | 'panel' | 'dense';
  className?: string;
};

/** Works as a standalone panel or as a cell of the approved .kpi-strip. */
export function MetricBlock({
  label,
  value,
  unit,
  description,
  index,
  material = 'dense',
  className = '',
}: MetricBlockProps) {
  return (
    <EiaPanel
      as="section"
      material={material}
      className={`eia-metric-block ${className}`}
    >
      <span className="kpi-label">
        {index !== undefined && <span className="kpi-index">{index}</span>}
        {label}
        <ArrowUpRight size={17} aria-hidden="true" />
      </span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      {description && <span className="kpi-detail">{description}</span>}
    </EiaPanel>
  );
}

export type ProjectFormValues = {
  name: string;
  category: string;
  description: string;
  notify: boolean;
};

export type FormBlockProps = {
  title?: string;
  description?: string;
  submitLabel?: string;
  initialValues?: Partial<ProjectFormValues>;
  /** Omit for a local demonstration. Resolve on success; reject on failure. */
  onSubmit?: (values: ProjectFormValues) => void | Promise<void>;
  className?: string;
};

const projectCategories = [
  { value: '', label: 'Selecione uma categoria' },
  { value: 'Agente de atendimento', label: 'Agente de atendimento' },
  { value: 'Marketing e conteúdo', label: 'Marketing e conteúdo' },
  { value: 'Automação comercial', label: 'Automação comercial' },
  { value: 'Base de conhecimento', label: 'Base de conhecimento' },
  { value: 'Processos internos', label: 'Processos internos' },
];

type FormErrors = Partial<Record<'name' | 'category', string>>;

/** A usable project form with validation and an explicitly local default submit. */
export function FormBlock({
  title = 'Seu próximo movimento',
  description = 'Dê um nome à ideia e escolha por onde começar.',
  submitLabel = 'Criar projeto',
  initialValues,
  onSubmit,
  className = '',
}: FormBlockProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submissionLock = useRef(false);
  const [values, setValues] = useState<ProjectFormValues>({
    name: initialValues?.name ?? '',
    category: initialValues?.category ?? '',
    description: initialValues?.description ?? '',
    notify: initialValues?.notify ?? false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [state, setState] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle');
  const [submittedName, setSubmittedName] = useState('');

  function updateValue<K extends keyof ProjectFormValues>(
    key: K,
    value: ProjectFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === 'name' || key === 'category')
      setErrors((current) => ({ ...current, [key]: undefined }));
    setState('idle');
  }

  async function submit() {
    if (submissionLock.current) return;
    const nextErrors: FormErrors = {};
    if (values.name.trim().length < 3)
      nextErrors.name = 'Use pelo menos 3 caracteres para o nome do projeto.';
    if (!values.category)
      nextErrors.category = 'Escolha uma categoria para continuar.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setState('idle');
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    submissionLock.current = true;
    setState('submitting');
    const submittedValues = {
      ...values,
      name: values.name.trim(),
      description: values.description.trim(),
    };
    try {
      if (onSubmit) await onSubmit(submittedValues);
      else await new Promise<void>((resolve) => setTimeout(resolve, 450));
      setSubmittedName(submittedValues.name);
      setState('success');
    } catch {
      setState('error');
    } finally {
      submissionLock.current = false;
    }
  }

  return (
    <EiaPanel
      as="section"
      material="panel"
      className={`eia-form-block ${className}`}
      aria-labelledby={`${id}-heading`}
    >
      <div className="eia-block-heading">
        <span className="eia-block-eyebrow">Da ideia à prática</span>
        <h2 id={`${id}-heading`}>{title}</h2>
        <p>{description}</p>
      </div>
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={state === 'submitting'} className="eia-form-fields">
          <legend className="sr-only">Informações do projeto</legend>
          <EiaField
            label="Nome do projeto"
            htmlFor={`${id}-name`}
            error={errors.name}
            required
          >
            <EiaInput
              id={`${id}-name`}
              name="name"
              autoComplete="off"
              placeholder="Ex.: Atendimento que resolve"
              required
              maxLength={100}
              value={values.name}
              aria-invalid={!!errors.name}
              onChange={(event) => updateValue('name', event.target.value)}
            />
          </EiaField>
          <EiaField
            label="Categoria"
            htmlFor={`${id}-category`}
            error={errors.category}
            required
          >
            <EiaSelect
              id={`${id}-category`}
              name="category"
              label="Categoria"
              required
              value={values.category}
              onValueChange={(value) => updateValue('category', value)}
              options={projectCategories}
              aria-invalid={!!errors.category}
              disabled={state === 'submitting'}
            />
          </EiaField>
          <EiaField
            label="O que você quer transformar?"
            htmlFor={`${id}-description`}
            description="Opcional. Descreva o resultado que você quer alcançar."
          >
            <EiaTextarea
              id={`${id}-description`}
              name="description"
              placeholder="Quero reduzir tarefas repetitivas e..."
              value={values.description}
              maxLength={600}
              rows={3}
              onChange={(event) =>
                updateValue('description', event.target.value)
              }
            />
          </EiaField>
          <EiaCheckbox
            label="Acompanhar as próximas etapas"
            description={
              onSubmit
                ? 'Salva sua preferência junto ao projeto.'
                : 'Preferência ilustrativa neste formulário de exemplo.'
            }
            checked={values.notify}
            onCheckedChange={(checked) => updateValue('notify', checked)}
            disabled={state === 'submitting'}
          />
        </fieldset>
        <div className="eia-form-feedback" aria-live="polite">
          {state === 'success' && (
            <EiaAlert
              tone="success"
              title={onSubmit ? 'Projeto criado' : 'Projeto criado no exemplo'}
            >
              {submittedName}
              {onSubmit
                ? ' está pronto para o próximo passo.'
                : ' foi validado nesta sessão. Nenhum dado foi enviado.'}
            </EiaAlert>
          )}
          {state === 'error' && (
            <EiaAlert tone="danger" title="Não foi possível criar o projeto">
              Seus dados continuam no formulário. Tente novamente.
            </EiaAlert>
          )}
        </div>
        <div className="eia-form-actions">
          <span>
            {onSubmit
              ? 'Um passo de cada vez.'
              : 'Demonstração local · sem envio de dados'}
          </span>
          <EiaButton
            type="submit"
            loading={state === 'submitting'}
            trailingIcon={<ArrowUpRight size={17} />}
          >
            {state === 'submitting' ? 'Criando projeto…' : submitLabel}
          </EiaButton>
        </div>
      </form>
    </EiaPanel>
  );
}

export type ProjectRow = {
  id: string;
  name: string;
  category: string;
  owner: string;
  initials: string;
  status: string;
  progress: number;
  hours: number;
};

export type DashboardTableBlockProps = {
  rows: ProjectRow[];
  title?: string;
  index?: ReactNode;
  query?: string;
  onQueryChange?: (value: string) => void;
  status?: string;
  onStatusChange?: (value: string) => void;
  onSelect?: (row: ProjectRow) => void;
  /** Receives exactly the rows currently shown. The host owns file generation. */
  onExport?: (visibleRows: ProjectRow[]) => void;
  exported?: boolean;
  actions?: ReactNode;
  demo?: boolean;
  className?: string;
  id?: string;
};

/** Presentation and filtering only; period, export and record details stay with the host. */
export function DashboardTableBlock({
  rows,
  title = 'Seus projetos',
  index = '02 /',
  query,
  onQueryChange,
  status,
  onStatusChange,
  onSelect,
  onExport,
  exported = false,
  actions,
  demo = true,
  className = '',
  id,
}: DashboardTableBlockProps) {
  const headingId = useId();
  const [localQuery, setLocalQuery] = useState('');
  const [localStatus, setLocalStatus] = useState('Todos');
  const currentQuery = query ?? localQuery;
  const currentStatus = status ?? localStatus;
  const canChangeQuery = query === undefined || !!onQueryChange;
  const canChangeStatus = status === undefined || !!onStatusChange;
  const normalizedQuery = currentQuery.trim().toLocaleLowerCase('pt-BR');
  const visible = rows.filter(
    (row) =>
      (currentStatus === 'Todos' || row.status === currentStatus) &&
      `${row.name} ${row.category} ${row.owner}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedQuery),
  );
  const statuses = Array.from(
    new Set([
      'Todos',
      'Em andamento',
      'Em revisão',
      'Concluído',
      ...rows.map((row) => row.status),
      currentStatus,
    ]),
  );

  function changeQuery(value: string) {
    if (query === undefined) setLocalQuery(value);
    onQueryChange?.(value);
  }
  function changeStatus(value: string) {
    if (status === undefined) setLocalStatus(value);
    onStatusChange?.(value);
  }
  function resetFilters() {
    if (canChangeQuery) changeQuery('');
    if (canChangeStatus) changeStatus('Todos');
  }

  return (
    <EiaPanel
      as="section"
      material="dense"
      id={id}
      className={`eia-table-block projects-panel ${className}`}
      aria-labelledby={headingId}
    >
      <div className="panel-title">
        <h2 id={headingId}>
          {index && <span className="table-index">{index}</span>}
          {title}
        </h2>
        <div className="eia-table-actions">
          {actions}
          {onExport && (
            <EiaButton
              variant="secondary"
              size="sm"
              className="export-button"
              onClick={() => onExport(visible)}
              leadingIcon={<Download size={16} />}
            >
              <span>{exported ? 'Exportar novamente' : 'Exportar CSV'}</span>
            </EiaButton>
          )}
        </div>
      </div>
      <div className="filter-bar">
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <EiaInput
            value={currentQuery}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Buscar projeto ou responsável"
            aria-label="Buscar projeto ou responsável"
            readOnly={!canChangeQuery}
          />
          {currentQuery && canChangeQuery && (
            <EiaButton
              variant="ghost"
              size="sm"
              aria-label="Limpar busca"
              className="eia-search-clear"
              onClick={() => changeQuery('')}
            >
              <X size={15} />
            </EiaButton>
          )}
        </div>
        <EiaSelect
          className="status-select"
          label="Filtrar por status"
          value={currentStatus}
          onValueChange={changeStatus}
          disabled={!canChangeStatus}
          options={statuses.map((item) => ({
            value: item,
            label: item === 'Todos' ? 'Todos os status' : item,
          }))}
        />
      </div>
      <EiaTable aria-label={title}>
        <EiaTableHeader>
          <EiaTableRow>
            <EiaTableHead>Projeto</EiaTableHead>
            <EiaTableHead>Responsável</EiaTableHead>
            <EiaTableHead>Status</EiaTableHead>
            <EiaTableHead>Progresso</EiaTableHead>
            {onSelect && (
              <EiaTableHead>
                <span className="sr-only">Detalhes</span>
              </EiaTableHead>
            )}
          </EiaTableRow>
        </EiaTableHeader>
        <EiaTableBody>
          {visible.map((row) => (
            <EiaTableRow key={row.id}>
              <EiaTableCell>
                {onSelect ? (
                  <EiaButton
                    variant="ghost"
                    className="project-name"
                    onClick={() => onSelect(row)}
                  >
                    <span className="project-number">{row.id}</span>
                    <span>
                      <strong>{row.name}</strong>
                      <small>{row.category}</small>
                    </span>
                  </EiaButton>
                ) : (
                  <span className="project-name">
                    <span className="project-number">{row.id}</span>
                    <span>
                      <strong>{row.name}</strong>
                      <small>{row.category}</small>
                    </span>
                  </span>
                )}
              </EiaTableCell>
              <EiaTableCell>
                <span className="owner">
                  <span className="avatar" aria-hidden="true">
                    {row.initials}
                  </span>
                  {row.owner}
                </span>
              </EiaTableCell>
              <EiaTableCell>
                <EiaBadge
                  tone={row.status === 'Concluído' ? 'success' : 'neutral'}
                  className={`status ${row.status === 'Concluído' ? 'complete' : ''}`}
                >
                  {row.status === 'Concluído' && (
                    <Check size={12} aria-hidden="true" />
                  )}
                  {row.status}
                </EiaBadge>
              </EiaTableCell>
              <EiaTableCell>
                <span className="progress-cell">
                  <span className="progress-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(0, Math.min(100, row.progress))}%`,
                      }}
                    />
                  </span>
                  {row.progress}%
                </span>
              </EiaTableCell>
              {onSelect && (
                <EiaTableCell>
                  <EiaButton
                    variant="ghost"
                    size="sm"
                    className="row-open"
                    onClick={() => onSelect(row)}
                    aria-label={`Abrir ${row.name}`}
                  >
                    <ArrowUpRight size={18} />
                  </EiaButton>
                </EiaTableCell>
              )}
            </EiaTableRow>
          ))}
        </EiaTableBody>
      </EiaTable>
      {!visible.length && (
        <EiaEmpty
          className="empty-results"
          icon={<Search size={24} />}
          title={
            rows.length
              ? 'Nenhum projeto encontrado'
              : 'Seu próximo projeto começa aqui'
          }
          description={
            rows.length
              ? 'Experimente outro nome ou remova o filtro de status.'
              : 'Os projetos aparecem aqui à medida que você começa a construir.'
          }
          action={
            rows.length > 0 && (canChangeQuery || canChangeStatus) ? (
              <EiaButton variant="secondary" size="sm" onClick={resetFilters}>
                Limpar filtros
              </EiaButton>
            ) : undefined
          }
        />
      )}
      <div className="table-footer">
        <span aria-live="polite">
          {visible.length} de {rows.length} projetos{demo ? ' de exemplo' : ''}
        </span>
        <span>
          {demo
            ? 'Todos os dados desta tela são fictícios.'
            : 'Do planejamento à prática.'}
        </span>
      </div>
      <output className="sr-only" aria-live="polite">
        {exported
          ? `Arquivo CSV${demo ? ' de demonstração' : ''} exportado.`
          : ''}
      </output>
    </EiaPanel>
  );
}
