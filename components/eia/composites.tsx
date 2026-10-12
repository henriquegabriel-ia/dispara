'use client';

// oxlint-disable next/no-img-element -- Images here are local FileReader/blob/canvas previews, never network content for server optimization.
// oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG data figures require role=img to expose their accessible title.
// oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable code and diff regions need keyboard focus for horizontal scrolling.
// oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- Drag/drop and star-hover only enhance the equivalent native file button and radio controls.

import * as React from 'react';
import {
  Archive,
  Bell,
  Bold,
  Check,
  Code,
  Cookie,
  Copy,
  Download,
  FileText,
  Heading2,
  Heart,
  Info,
  Italic,
  Link2,
  List,
  Mail,
  Paperclip,
  RotateCw,
  Send,
  Star,
  Upload,
  X,
} from 'lucide-react';
import {
  EiaAlert,
  EiaBadge,
  EiaButton,
  EiaEmpty,
  EiaField,
  EiaIconButton,
  EiaInput,
  EiaLink,
  EiaPanel,
  EiaProgress,
  EiaSelect,
  EiaSkeleton,
  EiaSpinner,
  EiaTabs,
  EiaTextarea,
  type EiaAlertTone,
} from './index';
import {
  EiaAvatar,
  EiaPopover,
  EiaSlider,
  type EiaAvatarProps,
} from './extended';

function cn(...values: (string | false | undefined)[]) {
  return values.filter(Boolean).join(' ');
}
function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function fileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type EiaUploadFile = {
  id: string;
  file: File;
  progress: number;
  preview?: string;
  error?: string;
};
export type EiaUploadProps = {
  label?: string;
  accept?: string;
  maxFiles?: number;
  maxBytes?: number;
  onFilesChange?: (files: File[]) => void;
  className?: string;
};
export function EiaUpload({
  label = 'Adicionar arquivos',
  accept = '.pdf,.png,.jpg,.jpeg,.txt,.mp4',
  maxFiles = 10,
  maxBytes = 20 * 1024 * 1024,
  onFilesChange,
  className,
}: EiaUploadProps) {
  const [files, setFiles] = React.useState<EiaUploadFile[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);
  const readers = React.useRef(new Map<string, FileReader>());
  const currentFiles = React.useRef<File[]>([]);
  React.useEffect(() => {
    const activeReaders = readers.current;
    return () => {
      for (const reader of activeReaders.values()) reader.abort();
    };
  }, []);
  function addFiles(selected: File[]) {
    const allowed = accept
      .toLowerCase()
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const accepted: EiaUploadFile[] = [];
    const rejected: string[] = [];
    for (const file of selected) {
      if (currentFiles.current.length + accepted.length >= maxFiles) {
        rejected.push(`Limite de ${maxFiles} arquivos.`);
        break;
      }
      if (file.size > maxBytes) {
        rejected.push(`${file.name}: limite de ${fileSize(maxBytes)}.`);
        continue;
      }
      if (
        allowed.length &&
        !allowed.some((type) =>
          type.startsWith('.')
            ? file.name.toLowerCase().endsWith(type)
            : type.endsWith('/*')
              ? file.type.startsWith(type.slice(0, -1))
              : file.type === type,
        )
      ) {
        rejected.push(`${file.name}: formato não aceito.`);
        continue;
      }
      accepted.push({ id: uid(), file, progress: 0 });
    }
    setError([...new Set(rejected)].join(' '));
    currentFiles.current = [
      ...currentFiles.current,
      ...accepted.map((item) => item.file),
    ];
    onFilesChange?.(currentFiles.current);
    setFiles((previous) => [...previous, ...accepted]);
    for (const item of accepted) {
      const reader = new FileReader();
      readers.current.set(item.id, reader);
      reader.onprogress = (event) => {
        if (event.lengthComputable)
          setFiles((previous) =>
            previous.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    progress: Math.round((event.loaded / event.total) * 100),
                  }
                : entry,
            ),
          );
      };
      reader.onload = () => {
        setFiles((previous) =>
          previous.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  progress: 100,
                  preview: item.file.type.startsWith('image/')
                    ? typeof reader.result === 'string'
                      ? reader.result
                      : undefined
                    : undefined,
                }
              : entry,
          ),
        );
        readers.current.delete(item.id);
      };
      reader.onerror = () => {
        setFiles((previous) =>
          previous.map((entry) =>
            entry.id === item.id
              ? { ...entry, error: 'Não foi possível ler o arquivo.' }
              : entry,
          ),
        );
        readers.current.delete(item.id);
      };
      if (item.file.type.startsWith('image/')) reader.readAsDataURL(item.file);
      else reader.readAsArrayBuffer(item.file);
    }
  }
  function remove(item: EiaUploadFile) {
    readers.current.get(item.id)?.abort();
    readers.current.delete(item.id);
    setFiles((previous) => previous.filter((entry) => entry.id !== item.id));
    currentFiles.current = currentFiles.current.filter(
      (file) => file !== item.file,
    );
    onFilesChange?.(currentFiles.current);
  }
  return (
    <div className={cn('eia-c-upload eia-c-stack', className)}>
      <section
        className="eia-c-dropzone"
        data-dragging={dragging || undefined}
        aria-label={label}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <Upload size={26} aria-hidden="true" />
        <h3>{label}</h3>
        <p>
          Arraste os arquivos ou escolha no computador. Até {maxFiles} arquivos
          de {fileSize(maxBytes)}.
        </p>
        <EiaButton variant="secondary" onClick={() => input.current?.click()}>
          Escolher arquivos
        </EiaButton>
        <input
          ref={input}
          className="eia-sr-only"
          type="file"
          multiple
          accept={accept}
          aria-label={label}
          tabIndex={-1}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </section>
      {error && (
        <EiaAlert tone="danger" title="Revise os arquivos">
          {error}
        </EiaAlert>
      )}
      <ul className="eia-c-file-list">
        {files.map((item) => (
          <li key={item.id}>
            {item.preview ? (
              <img
                className="eia-c-file-preview"
                src={item.preview}
                alt={`Prévia de ${item.file.name}`}
              />
            ) : (
              <FileText size={22} aria-hidden="true" />
            )}
            <div className="eia-c-grow">
              <strong>{item.file.name}</strong>
              <p>
                {fileSize(item.file.size)} ·{' '}
                {item.error ??
                  (item.progress === 100
                    ? 'Pronto para envio'
                    : 'Preparando arquivo…')}
              </p>
              {item.progress < 100 && !item.error && (
                <EiaProgress
                  value={item.progress}
                  label={`Leitura de ${item.file.name}`}
                />
              )}
            </div>
            {item.progress === 100 && (
              <Check size={16} aria-label="Preparado" />
            )}
            <EiaIconButton
              label={`Remover ${item.file.name}`}
              size="sm"
              onClick={() => remove(item)}
            >
              <X />
            </EiaIconButton>
          </li>
        ))}
      </ul>
      <output className="eia-c-muted">
        {files.length
          ? `${files.length} arquivo(s) selecionado(s).`
          : 'Nenhum arquivo selecionado.'}
      </output>
    </div>
  );
}

export type EiaChatMessage = {
  id: string;
  kind: 'user' | 'assistant' | 'system';
  text: string;
  time?: string;
  attachment?: string;
};
export type EiaChatProps = {
  title?: string;
  messages: EiaChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  onAttach?: (file: File) => void;
  typing?: boolean;
  className?: string;
};
export function EiaChat({
  title = 'Íris',
  messages,
  onSend,
  onAttach,
  typing = false,
  className,
}: EiaChatProps) {
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [messages, typing]);
  async function send(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(draft.trim());
      setDraft('');
    } catch {
      setError('A mensagem não foi enviada. Tente novamente.');
    } finally {
      setSending(false);
    }
  }
  return (
    <EiaPanel className={cn('eia-c-chat', className)} material="panel">
      <header className="eia-c-between">
        <div className="eia-c-row">
          <EiaAvatar name={title} status="online" />
          <div>
            <strong>{title}</strong>
            <p className="eia-c-muted">Atendimento com IA</p>
          </div>
        </div>
        <EiaBadge tone="success">Online</EiaBadge>
      </header>
      <div
        ref={body}
        className="eia-c-chat-log"
        role="log"
        aria-label={`Conversa com ${title}`}
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((message) => (
          <div
            className="eia-c-message"
            data-kind={message.kind}
            key={message.id}
          >
            <div className="eia-c-bubble">
              <span className="eia-sr-only">
                {message.kind === 'user'
                  ? 'Você: '
                  : message.kind === 'assistant'
                    ? `${title}: `
                    : 'Sistema: '}
              </span>
              {message.text}
              {message.attachment && (
                <span className="eia-c-chat-attachment">
                  <Paperclip size={13} aria-hidden="true" />
                  {message.attachment}
                </span>
              )}
            </div>
            {message.time && (
              <small>
                {message.kind === 'user' ? 'Você' : title} · {message.time}
              </small>
            )}
          </div>
        ))}
        {typing && (
          <output className="eia-c-typing">
            <EiaSpinner label={`${title} está escrevendo`} />
            <span>Escrevendo…</span>
          </output>
        )}
      </div>
      {error && <EiaAlert tone="danger" title={error} />}
      <form className="eia-c-chat-compose" onSubmit={send}>
        {onAttach && (
          <>
            <EiaIconButton
              label="Anexar arquivo à conversa"
              onClick={() => input.current?.click()}
            >
              <Paperclip />
            </EiaIconButton>
            <input
              ref={input}
              className="eia-sr-only"
              type="file"
              tabIndex={-1}
              aria-label="Arquivo para a conversa"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAttach(file);
                event.target.value = '';
              }}
            />
          </>
        )}
        <EiaInput
          aria-label="Mensagem"
          placeholder="Escreva sua mensagem…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={4000}
        />
        <EiaButton
          type="submit"
          loading={sending}
          disabled={!draft.trim()}
          leadingIcon={<Send />}
        >
          Enviar
        </EiaButton>
      </form>
    </EiaPanel>
  );
}

export type EiaAnnouncementProps = {
  title: string;
  description?: string;
  tone?: EiaAlertTone;
  action?: React.ReactNode;
  onDismiss?: () => void;
};
export function EiaAnnouncement({
  title,
  description,
  tone = 'info',
  action,
  onDismiss,
}: EiaAnnouncementProps) {
  return (
    <div className="eia-c-announcement">
      <EiaAlert tone={tone} title={title}>
        {description}
      </EiaAlert>
      <div className="eia-c-row">
        {action}
        {onDismiss && (
          <EiaIconButton label={`Dispensar: ${title}`} onClick={onDismiss}>
            <X />
          </EiaIconButton>
        )}
      </div>
    </div>
  );
}
export type EiaActivity = {
  id: string;
  actor: string;
  description: string;
  time: string;
  status?: EiaAvatarProps['status'];
  onOpen?: () => void;
};
export function EiaActivityFeed({
  items,
  label = 'Atividade recente',
}: {
  items: EiaActivity[];
  label?: string;
}) {
  return (
    <ol className="eia-c-activity" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <EiaAvatar name={item.actor} size="sm" status={item.status} />
          <div className="eia-c-grow">
            <strong>{item.actor}</strong>
            <p>{item.description}</p>
            <small>{item.time}</small>
          </div>
          {item.onOpen && (
            <EiaButton size="sm" variant="ghost" onClick={item.onOpen}>
              Ver
            </EiaButton>
          )}
        </li>
      ))}
    </ol>
  );
}
export function EiaAvatarGroup({
  people,
  max = 4,
  label = 'Pessoas na equipe',
}: {
  people: EiaAvatarProps[];
  max?: number;
  label?: string;
}) {
  return (
    <div className="eia-c-avatar-group" role="group" aria-label={label}>
      {people.slice(0, max).map((person) => (
        <EiaAvatar key={person.name} {...person} />
      ))}
      {people.length > max && (
        <span
          className="eia-c-avatar-more"
          title={people
            .slice(max)
            .map((person) => person.name)
            .join(', ')}
        >
          +{people.length - max}
        </span>
      )}
      <span className="eia-sr-only">
        {people
          .map(
            (person) =>
              `${person.name}${person.status ? `: ${person.status === 'online' ? 'online' : person.status === 'away' ? 'ausente' : 'offline'}` : ''}`,
          )
          .join('; ')}
      </span>
    </div>
  );
}

export type EiaNotification = {
  id: string;
  title: string;
  description: string;
  time: string;
  read?: boolean;
  starred?: boolean;
  archived?: boolean;
  tone?: EiaAlertTone;
};
export type EiaNotificationInboxProps = {
  items: EiaNotification[];
  onItemsChange: (items: EiaNotification[]) => void;
  compact?: boolean;
};
export function EiaNotificationInbox({
  items,
  onItemsChange,
  compact = false,
}: EiaNotificationInboxProps) {
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const filtered = items.filter(
    (item) =>
      (filter === 'archived' ? item.archived : !item.archived) &&
      (filter !== 'unread' || !item.read) &&
      (filter !== 'starred' || item.starred) &&
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visible = compact ? filtered.slice(0, 4) : filtered;
  function update(id: string, next: Partial<EiaNotification>) {
    onItemsChange(
      items.map((item) => (item.id === id ? { ...item, ...next } : item)),
    );
  }
  return (
    <div className="eia-c-inbox eia-c-stack">
      <div className="eia-c-between">
        <strong>Notificações</strong>
        <EiaButton
          size="sm"
          variant="ghost"
          disabled={!items.some((item) => !item.read && !item.archived)}
          onClick={() =>
            onItemsChange(items.map((item) => ({ ...item, read: true })))
          }
        >
          Marcar todas lidas
        </EiaButton>
      </div>
      {!compact && (
        <div className="eia-c-grid">
          <EiaInput
            type="search"
            aria-label="Buscar notificações"
            placeholder="Buscar na caixa de entrada"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <EiaSelect
            label="Exibir notificações"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'unread', label: 'Não lidas' },
              { value: 'starred', label: 'Favoritas' },
              { value: 'archived', label: 'Arquivadas' },
            ]}
          />
        </div>
      )}
      <ul className="eia-c-notifications">
        {visible.map((item) => (
          <li key={item.id} data-unread={!item.read || undefined}>
            <button
              type="button"
              className="eia-c-notification-open"
              onClick={() => update(item.id, { read: !item.read })}
              aria-label={`${item.read ? 'Marcar não lida' : 'Marcar lida'}: ${item.title}`}
            >
              <span className="eia-c-notification-dot" aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <small>
                  {item.time} · {item.read ? 'Lida' : 'Não lida'}
                </small>
              </span>
            </button>
            <div className="eia-c-row">
              <EiaIconButton
                label={`${item.starred ? 'Remover favorito' : 'Favoritar'}: ${item.title}`}
                size="sm"
                aria-pressed={Boolean(item.starred)}
                onClick={() => update(item.id, { starred: !item.starred })}
              >
                <Star fill={item.starred ? 'currentColor' : 'none'} />
              </EiaIconButton>
              <EiaIconButton
                label={`${item.archived ? 'Restaurar' : 'Arquivar'}: ${item.title}`}
                size="sm"
                onClick={() => update(item.id, { archived: !item.archived })}
              >
                <Archive />
              </EiaIconButton>
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <EiaEmpty
          title="Tudo em dia"
          description="Nenhuma notificação neste filtro."
          icon={<Bell />}
        />
      )}
    </div>
  );
}
export function EiaNotificationBell(props: EiaNotificationInboxProps) {
  const unread = props.items.filter(
    (item) => !item.read && !item.archived,
  ).length;
  return (
    <EiaPopover
      title="Notificações"
      align="end"
      trigger={
        <EiaButton
          variant="secondary"
          leadingIcon={<Bell />}
          aria-label={`Notificações: ${unread} não lidas`}
        >
          {unread}
        </EiaButton>
      }
    >
      <EiaNotificationInbox {...props} compact />
    </EiaPopover>
  );
}

export type EiaCookieChoice = 'essential' | 'all' | null;
export function EiaCookieConsent({
  value,
  onValueChange,
  policyHref,
}: {
  value: EiaCookieChoice;
  onValueChange: (choice: EiaCookieChoice) => void;
  policyHref?: string;
}) {
  return value ? (
    <div className="eia-c-between">
      <output className="eia-c-muted">
        Preferência:{' '}
        {value === 'all' ? 'essenciais e opcionais' : 'somente essenciais'}.
      </output>
      <EiaButton variant="ghost" size="sm" onClick={() => onValueChange(null)}>
        Revisar preferências
      </EiaButton>
    </div>
  ) : (
    <EiaPanel className="eia-c-cookie">
      <Cookie size={26} aria-hidden="true" />
      <div className="eia-c-grow">
        <h3>Sua escolha sobre cookies</h3>
        <p>
          Cookies essenciais permitem o funcionamento da plataforma. Os
          opcionais ajudam a entender o uso.
        </p>
        {policyHref && (
          <EiaLink href={policyHref}>Ler a política de cookies</EiaLink>
        )}
      </div>
      <div className="eia-c-row">
        <EiaButton
          variant="secondary"
          onClick={() => onValueChange('essential')}
        >
          Só os essenciais
        </EiaButton>
        <EiaButton onClick={() => onValueChange('all')}>
          Aceitar todos
        </EiaButton>
      </div>
    </EiaPanel>
  );
}
export function EiaNewsletter({
  onSubscribe,
  title = 'Ideias que viram prática',
  successMessage = 'Solicitação registrada.',
}: {
  onSubscribe: (email: string) => void | Promise<void>;
  title?: string;
  successMessage?: string;
}) {
  const id = React.useId();
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'success' | 'error'>(
    'idle',
  );
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus('idle');
    try {
      await onSubscribe(email.trim());
      setStatus('success');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <EiaPanel className="eia-c-stack">
      <div>
        <Mail size={23} aria-hidden="true" />
        <h3>{title}</h3>
        <p className="eia-c-muted">Receba a próxima edição no seu e-mail.</p>
      </div>
      <form onSubmit={submit} className="eia-c-row">
        <EiaField
          label="E-mail para newsletter"
          htmlFor={id}
          className="eia-c-grow"
        >
          <EiaInput
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setStatus('idle');
            }}
            placeholder="seu@email.com"
          />
        </EiaField>
        <EiaButton type="submit" loading={busy} disabled={status === 'success'}>
          Assinar
        </EiaButton>
      </form>
      {status === 'success' && (
        <EiaAlert tone="success" title={successMessage} />
      )}
      {status === 'error' && (
        <EiaAlert
          tone="danger"
          title="Não foi possível concluir. Tente novamente."
        />
      )}
    </EiaPanel>
  );
}
export type EiaComment = {
  id: string;
  author: string;
  text: string;
  time: string;
  likes?: number;
  liked?: boolean;
  replyTo?: string;
};
export function EiaComments({
  comments,
  onCommentsChange,
  currentUser = 'Você',
}: {
  comments: EiaComment[];
  onCommentsChange: (comments: EiaComment[]) => void;
  currentUser?: string;
}) {
  const [draft, setDraft] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<EiaComment | null>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    onCommentsChange([
      ...comments,
      {
        id: uid(),
        author: currentUser,
        text: draft.trim(),
        time: 'Agora',
        likes: 0,
        replyTo: replyTo?.id,
      },
    ]);
    setDraft('');
    setReplyTo(null);
  }
  return (
    <div className="eia-c-stack">
      <h3>{comments.length} comentários</h3>
      <ul className="eia-c-comments">
        {comments.map((comment) => (
          <li
            key={comment.id}
            data-reply={Boolean(comment.replyTo) || undefined}
          >
            <EiaAvatar name={comment.author} size="sm" />
            <div className="eia-c-grow">
              <div className="eia-c-between">
                <strong>{comment.author}</strong>
                <small>{comment.time}</small>
              </div>
              <p>{comment.text}</p>
              <div className="eia-c-row">
                <EiaButton
                  size="sm"
                  variant="ghost"
                  leadingIcon={
                    <Heart fill={comment.liked ? 'currentColor' : 'none'} />
                  }
                  aria-label={`Curtir comentário de ${comment.author}`}
                  aria-pressed={Boolean(comment.liked)}
                  onClick={() =>
                    onCommentsChange(
                      comments.map((item) =>
                        item.id === comment.id
                          ? {
                              ...item,
                              liked: !item.liked,
                              likes: Math.max(
                                0,
                                (item.likes ?? 0) + (item.liked ? -1 : 1),
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {comment.likes ?? 0}
                </EiaButton>
                <EiaButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReplyTo(comment);
                    input.current?.focus();
                  }}
                >
                  Responder
                </EiaButton>
                {comment.author === currentUser && (
                  <EiaButton
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onCommentsChange(
                        comments.filter((item) => item.id !== comment.id),
                      )
                    }
                  >
                    Excluir
                  </EiaButton>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <form className="eia-c-stack" onSubmit={submit}>
        {replyTo && (
          <div className="eia-c-between">
            <span>Respondendo a {replyTo.author}</span>
            <EiaIconButton
              label="Cancelar resposta"
              size="sm"
              onClick={() => setReplyTo(null)}
            >
              <X />
            </EiaIconButton>
          </div>
        )}
        <EiaTextarea
          ref={input}
          aria-label="Escreva seu comentário"
          placeholder="Compartilhe uma ideia…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={3000}
        />
        <EiaButton
          type="submit"
          disabled={!draft.trim()}
          leadingIcon={<Send />}
        >
          Publicar comentário
        </EiaButton>
      </form>
    </div>
  );
}
export function EiaFileCard({
  name,
  description,
  href,
  download,
}: {
  name: string;
  description?: string;
  href: string;
  download?: string;
}) {
  return (
    <EiaPanel material="dense" className="eia-c-file-card">
      <FileText size={23} aria-hidden="true" />
      <div className="eia-c-grow">
        <strong>{name}</strong>
        {description && <p>{description}</p>}
      </div>
      <EiaLink
        href={href}
        download={download}
        variant="secondary"
        aria-label={`Baixar ${name}`}
      >
        <Download size={16} aria-hidden="true" />
        Baixar
      </EiaLink>
    </EiaPanel>
  );
}

export function EiaRating({
  label,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  const [hover, setHover] = React.useState<number | null>(null);
  return (
    <fieldset className="eia-c-rating" disabled={disabled}>
      <legend>{label}</legend>
      <div onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score} onMouseEnter={() => setHover(score)}>
            <input
              className="eia-sr-only"
              type="radio"
              name={id}
              value={score}
              checked={value === score}
              onChange={() => onValueChange(score)}
            />
            <span aria-hidden="true">
              <Star
                fill={(hover ?? value) >= score ? 'currentColor' : 'none'}
              />
            </span>
            <span className="eia-sr-only">{score} de 5 estrelas</span>
          </label>
        ))}
      </div>
      <output>{value ? `${value} de 5 estrelas` : 'Sem avaliação'}</output>
    </fieldset>
  );
}

export type EiaPhoneCountry = 'BR' | 'US' | 'PT' | 'AR' | 'MX' | 'CL' | 'CO';
const phoneCountries = [
  { value: 'BR', label: 'Brasil · +55', dial: '55', max: 11 },
  { value: 'US', label: 'Estados Unidos · +1', dial: '1', max: 10 },
  { value: 'PT', label: 'Portugal · +351', dial: '351', max: 9 },
  { value: 'AR', label: 'Argentina · +54', dial: '54', max: 11 },
  { value: 'MX', label: 'México · +52', dial: '52', max: 10 },
  { value: 'CL', label: 'Chile · +56', dial: '56', max: 9 },
  { value: 'CO', label: 'Colômbia · +57', dial: '57', max: 10 },
];
export function eiaFormatPhone(value: string, country: EiaPhoneCountry = 'BR') {
  const digits = value.replace(/\D/g, '');
  if (country !== 'BR') return digits;
  const number = digits.slice(0, 11);
  if (number.length <= 2) return number ? `(${number}` : '';
  const first = number.length > 10 ? 5 : 4;
  const local = number.slice(2);
  return `(${number.slice(0, 2)}) ${local.slice(0, first)}${local.length > first ? `-${local.slice(first)}` : ''}`;
}
export function EiaPhoneInput({
  label = 'Telefone',
  value,
  country,
  onValueChange,
  onCountryChange,
  disabled,
}: {
  label?: string;
  value: string;
  country: EiaPhoneCountry;
  onValueChange: (digits: string) => void;
  onCountryChange: (country: EiaPhoneCountry) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  const current =
    phoneCountries.find((item) => item.value === country) ?? phoneCountries[0];
  return (
    <div className="eia-c-stack">
      <div className="eia-c-phone">
        <EiaSelect
          label="País e código"
          value={country}
          onValueChange={(next) => onCountryChange(next as EiaPhoneCountry)}
          disabled={disabled}
          options={phoneCountries}
        />
        <EiaField label={label} htmlFor={id}>
          <EiaInput
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={eiaFormatPhone(value, country)}
            disabled={disabled}
            placeholder={
              country === 'BR' ? '(11) 99999-9999' : 'Número com código de área'
            }
            onChange={(event) =>
              onValueChange(
                event.target.value.replace(/\D/g, '').slice(0, current.max),
              )
            }
          />
        </EiaField>
      </div>
      <output className="eia-c-muted">
        {value
          ? `Formato internacional: +${current.dial}${value.replace(/\D/g, '')}`
          : 'Informe um número para visualizar o formato internacional.'}
      </output>
    </div>
  );
}

export function EiaAvatarCropper({
  onSave,
}: {
  onSave?: (image: Blob) => void;
}) {
  const [source, setSource] = React.useState('');
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [saved, setSaved] = React.useState('');
  const [error, setError] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);
  const image = React.useRef<HTMLImageElement>(null);
  React.useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );
  function choose(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      setError('Escolha uma imagem de até 10 MB.');
      return;
    }
    setSource(URL.createObjectURL(file));
    setSaved('');
    setZoom(1);
    setRotation(0);
    setError('');
  }
  function save() {
    const img = image.current;
    if (!img?.naturalWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('O navegador não disponibilizou o editor.');
      return;
    }
    context.beginPath();
    context.arc(256, 256, 256, 0, Math.PI * 2);
    context.clip();
    const scale =
      Math.max(512 / img.naturalWidth, 512 / img.naturalHeight) * zoom;
    context.translate(256, 256);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(
      img,
      (-img.naturalWidth * scale) / 2,
      (-img.naturalHeight * scale) / 2,
      img.naturalWidth * scale,
      img.naturalHeight * scale,
    );
    setSaved(canvas.toDataURL('image/png'));
    canvas.toBlob((blob) => {
      if (blob) onSave?.(blob);
    }, 'image/png');
  }
  return (
    <div className="eia-c-grid">
      <div className="eia-c-crop-stage">
        {source ? (
          <div className="eia-c-crop-circle">
            <img
              ref={image}
              src={source}
              alt="Imagem para recorte"
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              onError={() => setError('Não foi possível abrir esta imagem.')}
            />
          </div>
        ) : (
          <EiaEmpty
            title="Seu próximo avatar"
            description="Escolha uma imagem para ajustar o recorte."
            icon={<Upload />}
            action={
              <EiaButton onClick={() => input.current?.click()}>
                Escolher imagem
              </EiaButton>
            }
          />
        )}
      </div>
      <div className="eia-c-stack">
        <input
          ref={input}
          className="eia-sr-only"
          type="file"
          accept="image/*"
          aria-label="Imagem de avatar"
          tabIndex={-1}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <EiaSlider
          label="Zoom do recorte"
          value={zoom}
          onValueChange={(next) => setZoom(Number(next))}
          min={1}
          max={3}
          step={0.05}
          disabled={!source}
          formatValue={(value) => `${value.toFixed(2)}×`}
        />
        <div className="eia-c-row">
          <EiaButton
            variant="secondary"
            disabled={!source}
            leadingIcon={<RotateCw />}
            onClick={() => setRotation((previous) => (previous + 90) % 360)}
          >
            Girar {rotation}°
          </EiaButton>
          <EiaButton variant="ghost" onClick={() => input.current?.click()}>
            Trocar imagem
          </EiaButton>
        </div>
        <EiaButton disabled={!source || Boolean(error)} onClick={save}>
          Salvar recorte
        </EiaButton>
        {error && <EiaAlert tone="danger" title={error} />}
        {saved && (
          <div className="eia-c-row">
            <img
              className="eia-c-crop-result"
              src={saved}
              alt="Avatar recortado"
            />
            <EiaLink href={saved} download="avatar-empreende.png">
              Baixar avatar PNG
            </EiaLink>
          </div>
        )}
      </div>
    </div>
  );
}

function inlineMarkdown(text: string): React.ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
    .map((piece, index) => {
      if (piece.startsWith('**') && piece.endsWith('**'))
        return <strong key={index}>{piece.slice(2, -2)}</strong>;
      if (piece.startsWith('*') && piece.endsWith('*'))
        return <em key={index}>{piece.slice(1, -1)}</em>;
      if (piece.startsWith('`') && piece.endsWith('`'))
        return <code key={index}>{piece.slice(1, -1)}</code>;
      const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link && /^(https?:\/\/|mailto:|\/[^/]|#)/i.test(link[2]))
        return (
          <EiaLink key={index} href={link[2]}>
            {link[1]}
          </EiaLink>
        );
      return piece;
    });
}
export function EiaMarkdownPreview({ value }: { value: string }) {
  const lines = value.split('\n');
  const blocks: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (++index < lines.length && !lines[index].startsWith('```'))
        code.push(lines[index]);
      blocks.push(
        <pre key={index}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
    } else if (line.startsWith('- ')) {
      const list: string[] = [line.slice(2)];
      while (index + 1 < lines.length && lines[index + 1].startsWith('- '))
        list.push(lines[++index].slice(2));
      blocks.push(
        <ul key={index}>
          {list.map((item, row) => (
            <li key={row}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
    } else if (/^#{1,3} /.test(line)) {
      blocks.push(
        <h3 key={index}>{inlineMarkdown(line.replace(/^#{1,3} /, ''))}</h3>,
      );
    } else if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={index}>{inlineMarkdown(line.slice(2))}</blockquote>,
      );
    } else if (line.trim())
      blocks.push(<p key={index}>{inlineMarkdown(line)}</p>);
  }
  return (
    <div className="eia-c-markdown">
      {blocks.length ? (
        blocks
      ) : (
        <p className="eia-c-muted">O conteúdo escrito aparecerá aqui.</p>
      )}
    </div>
  );
}
export function EiaMarkdownEditor({
  value,
  onValueChange,
  onSave,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSave?: (value: string) => void;
}) {
  const [tab, setTab] = React.useState('write');
  const input = React.useRef<HTMLTextAreaElement>(null);
  function wrap(prefix: string, suffix = prefix) {
    const textarea = input.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const selection = value.slice(start, end) || 'texto';
    onValueChange(
      `${value.slice(0, start)}${prefix}${selection}${suffix}${value.slice(end)}`,
    );
    setTab('write');
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selection.length,
      );
    });
  }
  const tools = [
    { label: 'Negrito', icon: Bold, start: '**', end: '**' },
    { label: 'Itálico', icon: Italic, start: '*', end: '*' },
    { label: 'Título', icon: Heading2, start: '\n## ', end: '\n' },
    { label: 'Lista', icon: List, start: '\n- ', end: '\n' },
    { label: 'Link', icon: Link2, start: '[', end: '](https://exemplo.com)' },
    { label: 'Código', icon: Code, start: '`', end: '`' },
  ];
  return (
    <div className="eia-c-editor eia-c-stack">
      <div className="eia-c-row" role="group" aria-label="Formatação Markdown">
        {tools.map((tool) => (
          <EiaIconButton
            key={tool.label}
            label={tool.label}
            size="sm"
            onClick={() => wrap(tool.start, tool.end)}
          >
            <tool.icon />
          </EiaIconButton>
        ))}
      </div>
      <EiaTabs
        value={tab}
        onValueChange={setTab}
        label="Modo do editor"
        tabs={[
          {
            value: 'write',
            label: 'Escrever',
            content: (
              <EiaTextarea
                ref={input}
                className="eia-c-editor-input"
                aria-label="Conteúdo Markdown"
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                onKeyDown={(event) => {
                  if (!(event.metaKey || event.ctrlKey)) return;
                  if (event.key.toLowerCase() === 'b') {
                    event.preventDefault();
                    wrap('**');
                  } else if (event.key.toLowerCase() === 'i') {
                    event.preventDefault();
                    wrap('*');
                  } else if (event.key === 'Enter' && value.trim()) {
                    event.preventDefault();
                    onSave?.(value);
                  }
                }}
              />
            ),
          },
          {
            value: 'preview',
            label: 'Prévia',
            content: <EiaMarkdownPreview value={value} />,
          },
        ]}
      />
      <div className="eia-c-between">
        <small>{value.length} caracteres · ⌘/Ctrl + Enter para salvar</small>
        {onSave && (
          <EiaButton disabled={!value.trim()} onClick={() => onSave(value)}>
            Salvar nota
          </EiaButton>
        )}
      </div>
    </div>
  );
}

export type EiaCodeBlockProps = {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
};
function codeTokens(line: string) {
  return line
    .split(
      /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|function|return|import|from|export|default|async|await|if|else|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g,
    )
    .map((part, index) => {
      const kind = part.startsWith('//')
        ? 'comment'
        : /^["']/.test(part)
          ? 'string'
          : /^\d/.test(part)
            ? 'number'
            : /^(const|let|function|return|import|from|export|default|async|await|if|else|true|false|null|undefined)$/.test(
                  part,
                )
              ? 'keyword'
              : undefined;
      return (
        <span key={index} data-token={kind}>
          {part}
        </span>
      );
    });
}
export function EiaCodeBlock({
  code,
  language = 'tsx',
  filename = 'exemplo.tsx',
  showLineNumbers = true,
  highlightLines = [],
}: EiaCodeBlockProps) {
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);
  const copied = copiedCode === code;
  const [fallback, setFallback] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
    } catch {
      setFallback(true);
    }
  }
  return (
    <div className="eia-c-code">
      <header className="eia-c-between">
        <span>
          {filename} · {language}
        </span>
        <EiaButton
          size="sm"
          variant="ghost"
          leadingIcon={copied ? <Check /> : <Copy />}
          onClick={copy}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </EiaButton>
      </header>
      <pre tabIndex={0} aria-label={`Código em ${language}`}>
        <code>
          {code.split('\n').map((line, index) => (
            <span
              className="eia-c-code-line"
              key={index}
              data-highlighted={highlightLines.includes(index + 1) || undefined}
            >
              {showLineNumbers && (
                <span className="eia-c-line-number" aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <span>{codeTokens(line || '\u00a0')}</span>
            </span>
          ))}
        </code>
      </pre>
      {fallback && (
        <EiaTextarea
          aria-label="Código para copiar manualmente"
          value={code}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}
export function EiaTerminal({
  title = 'Terminal de demonstração',
}: {
  title?: string;
}) {
  const [command, setCommand] = React.useState('');
  const [lines, setLines] = React.useState([
    'Comandos locais: help, status, echo <texto>, clear.',
  ]);
  function run(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    if (value === 'clear') setLines([]);
    else
      setLines((previous) => [
        ...previous,
        `$ ${value}`,
        value === 'help'
          ? 'help · lista comandos | status · estado do exemplo | echo · escreve texto | clear · limpa saída'
          : value === 'status'
            ? 'Interface pronta. Nenhum processo de servidor foi iniciado.'
            : value.startsWith('echo ')
              ? value.slice(5)
              : 'Comando não disponível. Use help para listar comandos.',
      ]);
    setCommand('');
  }
  return (
    <div className="eia-c-code">
      <header>{title}</header>
      <pre className="eia-c-terminal-output" role="log" aria-live="polite">
        {lines.join('\n')}
      </pre>
      <form className="eia-c-row" onSubmit={run}>
        <EiaInput
          aria-label="Comando local"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Digite help"
          spellCheck={false}
        />
        <EiaButton type="submit" variant="secondary" disabled={!command.trim()}>
          Executar
        </EiaButton>
      </form>
    </div>
  );
}
type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };
export function eiaDiffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n').slice(0, 500);
  const b = after.split('\n').slice(0, 500);
  const rows = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      rows[i][j] =
        a[i] === b[j]
          ? rows[i + 1][j + 1] + 1
          : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i++] });
      j++;
    } else if (
      j < b.length &&
      (i === a.length || rows[i][j + 1] >= rows[i + 1][j])
    )
      result.push({ kind: 'added', text: b[j++] });
    else result.push({ kind: 'removed', text: a[i++] });
  }
  return result;
}
export function EiaDiff({
  before,
  after,
  label = 'Alterações no código',
}: {
  before: string;
  after: string;
  label?: string;
}) {
  const lines = React.useMemo(
    () => eiaDiffLines(before, after),
    [before, after],
  );
  return (
    <div className="eia-c-code">
      <header className="eia-c-between">
        <strong>{label}</strong>
        <span>
          +{lines.filter((line) => line.kind === 'added').length} / −
          {lines.filter((line) => line.kind === 'removed').length}
        </span>
      </header>
      <div className="eia-c-diff-head">
        <span>Antes</span>
        <span>Depois</span>
      </div>
      <div className="eia-c-diff" tabIndex={0} role="region" aria-label={label}>
        {lines.map((line, index) => (
          <div key={index} className="eia-c-diff-row" data-kind={line.kind}>
            <pre>
              {line.kind === 'added'
                ? ' '
                : `${line.kind === 'removed' ? '−' : ' '} ${line.text}`}
            </pre>
            <pre>
              {line.kind === 'removed'
                ? ' '
                : `${line.kind === 'added' ? '+' : ' '} ${line.text}`}
            </pre>
          </div>
        ))}
      </div>
      {(before.split('\n').length > 500 || after.split('\n').length > 500) && (
        <p>Prévia limitada às primeiras 500 linhas.</p>
      )}
    </div>
  );
}

export function EiaAudioPlayer({
  src,
  title,
  description,
  variant = 'mini',
  transcript,
  captionsSrc,
}: {
  src: string;
  title: string;
  description?: string;
  variant?: 'mini' | 'episode';
  transcript?: string;
  captionsSrc?: string;
}) {
  const media = React.useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = React.useState('1');
  const [error, setError] = React.useState(false);
  return (
    <EiaPanel className="eia-c-audio eia-c-stack" data-variant={variant}>
      <div>
        <EiaBadge>Áudio</EiaBadge>
        <h3>{title}</h3>
        {description && <p className="eia-c-muted">{description}</p>}
      </div>
      {variant === 'episode' && (
        <div className="eia-c-wave" aria-hidden="true">
          {Array.from({ length: 44 }, (_, index) => (
            <span
              key={index}
              style={{
                height: `${14 + Math.abs(Math.sin(index * 1.3)) * 38}px`,
              }}
            />
          ))}
        </div>
      )}
      <audio
        ref={media}
        controls
        preload="metadata"
        src={src}
        aria-label={title}
        onError={() => setError(true)}
        onLoadedMetadata={() => {
          setError(false);
          if (media.current) media.current.playbackRate = Number(speed);
        }}
      >
        <track
          kind="captions"
          label="Português"
          srcLang="pt-BR"
          src={captionsSrc}
        />
      </audio>
      <EiaSelect
        label="Velocidade de reprodução"
        value={speed}
        onValueChange={(next) => {
          setSpeed(next);
          if (media.current) media.current.playbackRate = Number(next);
        }}
        options={[
          { value: '0.75', label: '0,75×' },
          { value: '1', label: '1×' },
          { value: '1.25', label: '1,25×' },
          { value: '1.5', label: '1,5×' },
          { value: '2', label: '2×' },
        ]}
      />
      {transcript && (
        <details>
          <summary>Transcrição / descrição do áudio</summary>
          <p>{transcript}</p>
        </details>
      )}
      {error && (
        <EiaAlert
          tone="danger"
          title="Não foi possível reproduzir este áudio."
        />
      )}
    </EiaPanel>
  );
}
export function EiaVideoPlayer({
  src,
  title,
  poster,
  captionsSrc,
  transcript,
  onFileSelect,
}: {
  src?: string;
  title: string;
  poster?: string;
  captionsSrc?: string;
  transcript?: string;
  onFileSelect?: (file: File) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [errorSource, setErrorSource] = React.useState<string | null>(null);
  const error = Boolean(src && errorSource === src);
  return (
    <EiaPanel className="eia-c-stack">
      <h3>{title}</h3>
      {src ? (
        <video
          className="eia-c-video"
          controls
          preload="metadata"
          src={src}
          poster={poster}
          aria-label={title}
          onError={() => setErrorSource(src ?? '')}
        >
          <track
            kind="captions"
            label="Português"
            srcLang="pt-BR"
            src={captionsSrc}
            default={Boolean(captionsSrc)}
          />
        </video>
      ) : (
        <EiaEmpty
          title="Escolha um vídeo"
          description="O player lê o arquivo selecionado no seu computador."
          icon={<Upload />}
        />
      )}
      {onFileSelect && (
        <>
          <EiaButton variant="secondary" onClick={() => input.current?.click()}>
            {src ? 'Trocar vídeo' : 'Escolher vídeo'}
          </EiaButton>
          <input
            ref={input}
            type="file"
            className="eia-sr-only"
            accept="video/*"
            tabIndex={-1}
            aria-label="Vídeo para reproduzir"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFileSelect(file);
              event.target.value = '';
            }}
          />
        </>
      )}
      {transcript && (
        <details>
          <summary>Transcrição / descrição do vídeo</summary>
          <p>{transcript}</p>
        </details>
      )}
      {error && (
        <EiaAlert
          tone="danger"
          title="Formato indisponível. Escolha outro vídeo."
        />
      )}
    </EiaPanel>
  );
}

export type EiaChartDatum = { label: string; [key: string]: string | number };
export type EiaChartSeries = { key: string; label: string };
export type EiaChartProps = {
  title: string;
  data: EiaChartDatum[];
  series: EiaChartSeries[];
  type?: 'area' | 'line' | 'bar';
  projectedFrom?: number;
  max?: number;
  compact?: boolean;
  unit?: string;
};
export function EiaChart({
  title,
  data,
  series,
  type = 'line',
  projectedFrom,
  max,
  compact = false,
  unit = '',
}: EiaChartProps) {
  const [selected, setSelected] = React.useState(0);
  const activeIndex = Math.max(0, Math.min(selected, data.length - 1));
  const point = data[activeIndex];
  const safeMax =
    max !== undefined && Number.isFinite(max) && max > 0
      ? max
      : Math.max(
          1,
          ...data.flatMap((item) =>
            series.map((line) => Number(item[line.key]) || 0),
          ),
        ) * 1.12;
  const width = 600;
  const height = 190;
  const padding = 20;
  const x = (index: number) =>
    padding + (index / Math.max(1, data.length - 1)) * (width - padding * 2);
  const y = (value: number) =>
    height - padding - (Math.max(0, value) / safeMax) * (height - padding * 2);
  if (!data.length)
    return <EiaEmpty title="Ainda não há dados" description={title} />;
  return (
    <EiaPanel material="dense" className="eia-c-chart">
      <div className="eia-c-between">
        <h3>{title}</h3>
        {projectedFrom !== undefined && (
          <EiaBadge>Tracejado = projeção</EiaBadge>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}. ${series.map((line) => line.label).join(', ')}. Dados disponíveis abaixo.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position =
            ((event.clientX - bounds.left) / bounds.width) * width;
          setSelected(
            Math.max(
              0,
              Math.min(
                data.length - 1,
                Math.round(
                  ((position - padding) / (width - padding * 2)) *
                    (data.length - 1),
                ),
              ),
            ),
          );
        }}
      >
        <title>{title}</title>
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding}
            x2={width - padding}
            y1={y(safeMax * ratio)}
            y2={y(safeMax * ratio)}
            className="eia-c-chart-grid"
          />
        ))}
        {series.map((line, seriesIndex) => {
          const color = `var(--eia-color-chart-${(seriesIndex % 5) + 1})`;
          const projectionStart =
            projectedFrom === undefined
              ? data.length
              : Math.max(1, projectedFrom);
          const realPath = data
            .slice(0, projectionStart)
            .map(
              (item, index) =>
                `${index ? 'L' : 'M'}${x(index)},${y(Number(item[line.key]) || 0)}`,
            )
            .join(' ');
          const projectedPath = data
            .slice(projectionStart - 1)
            .map(
              (item, index) =>
                `${index ? 'L' : 'M'}${x(projectionStart - 1 + index)},${y(Number(item[line.key]) || 0)}`,
            )
            .join(' ');
          return (
            <g key={line.key}>
              {type === 'bar' ? (
                data.map((item, index) => {
                  const band = (width - padding * 2) / data.length;
                  const barWidth = Math.max(2, band / series.length - 6);
                  const value = Number(item[line.key]) || 0;
                  return (
                    <rect
                      key={item.label}
                      x={padding + index * band + seriesIndex * (barWidth + 3)}
                      y={y(value)}
                      width={barWidth}
                      height={Math.max(0, height - padding - y(value))}
                      fill={color}
                      rx="3"
                      opacity={selected === index ? 1 : 0.65}
                    />
                  );
                })
              ) : (
                <>
                  {type === 'area' && (
                    <path
                      d={`${realPath} L${x(Math.min(data.length, projectionStart) - 1)},${height - padding} L${x(0)},${height - padding} Z`}
                      fill={color}
                      opacity="0.12"
                    />
                  )}
                  <path
                    d={realPath}
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    strokeDasharray={seriesIndex ? '7 5' : undefined}
                  />
                  {projectionStart < data.length && (
                    <path
                      d={projectedPath}
                      fill="none"
                      stroke={color}
                      strokeWidth="3"
                      strokeDasharray="6 6"
                    />
                  )}
                  <circle
                    cx={x(activeIndex)}
                    cy={y(Number(point[line.key]) || 0)}
                    r="4"
                    fill={color}
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="eia-c-chart-axis">
        <span>0 {unit}</span>
        <span>
          {data[0].label} → {data[data.length - 1].label}
        </span>
        <span>
          {Math.round(safeMax).toLocaleString('pt-BR')} {unit}
        </span>
      </div>
      <output className="eia-c-chart-readout">
        <strong>
          {point.label}
          {projectedFrom !== undefined && activeIndex >= projectedFrom
            ? ' · projeção'
            : ''}
        </strong>
        {series.map((line, index) => (
          <span key={line.key}>
            <i
              style={{
                background: `var(--eia-color-chart-${(index % 5) + 1})`,
              }}
            />
            {line.label}: {Number(point[line.key]).toLocaleString('pt-BR')}{' '}
            {unit}
          </span>
        ))}
      </output>
      {!compact && (
        <EiaSelect
          label={`Detalhar período em ${title}`}
          value={String(Math.min(selected, data.length - 1))}
          onValueChange={(next) => setSelected(Number(next))}
          options={data.map((item, index) => ({
            value: String(index),
            label: item.label,
          }))}
        />
      )}
      <details className="eia-c-chart-data">
        <summary>Ver dados e escala</summary>
        <p>
          Escala comum: 0–{Math.round(safeMax).toLocaleString('pt-BR')} {unit}.
        </p>
        <table>
          <caption className="eia-sr-only">Dados de {title}</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              {series.map((line) => (
                <th key={line.key} scope="col">
                  {line.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                {series.map((line) => (
                  <td key={line.key}>
                    {Number(item[line.key]).toLocaleString('pt-BR')} {unit}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </EiaPanel>
  );
}
export function EiaDonut({
  title,
  data,
}: {
  title: string;
  data: { label: string; value: number }[];
}) {
  const [selected, setSelected] = React.useState(0);
  const textureId = React.useId().replace(/:/g, '');
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const active = data[Math.min(selected, data.length - 1)];
  return (
    <EiaPanel className="eia-c-stack" material="dense">
      <h3>{title}</h3>
      <div className="eia-c-donut">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={`${title}: total ${total.toLocaleString('pt-BR')}`}
        >
          <defs>
            <pattern
              id={textureId}
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="7" height="7" fill="var(--eia-color-chart-2)" />
              <line
                x1="0"
                x2="0"
                y1="0"
                y2="7"
                stroke="var(--eia-color-surface)"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          <circle
            cx="100"
            cy="100"
            r="72"
            fill="none"
            className="eia-c-chart-track"
            strokeWidth="24"
          />
          {data.map((item, index) => {
            const percent = total ? (Math.max(0, item.value) / total) * 100 : 0;
            const start = total
              ? (data
                  .slice(0, index)
                  .reduce((sum, item) => sum + Math.max(0, item.value), 0) /
                  total) *
                100
              : 0;
            return (
              <circle
                key={item.label}
                cx="100"
                cy="100"
                r="72"
                pathLength="100"
                fill="none"
                stroke={
                  index === 1
                    ? `url(#${textureId})`
                    : `var(--eia-color-chart-${(index % 5) + 1})`
                }
                strokeWidth={index === selected ? 28 : 22}
                strokeDasharray={`${percent} ${100 - percent}`}
                strokeDashoffset={-start}
                transform="rotate(-90 100 100)"
              />
            );
          })}
          <text
            x="100"
            y="101"
            textAnchor="middle"
            className="eia-c-chart-value"
          >
            {total.toLocaleString('pt-BR')}
          </text>
          <text
            x="100"
            y="121"
            textAnchor="middle"
            className="eia-c-chart-label"
          >
            total
          </text>
        </svg>
      </div>
      <div className="eia-c-row">
        {data.map((item, index) => (
          <EiaButton
            key={item.label}
            variant={selected === index ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {item.label}
          </EiaButton>
        ))}
      </div>
      <output>
        {active
          ? `${active.label}: ${active.value.toLocaleString('pt-BR')} · ${total ? ((active.value / total) * 100).toFixed(1) : 0}% do total`
          : 'Sem dados.'}
      </output>
    </EiaPanel>
  );
}
export function EiaFunnel({
  title,
  stages,
}: {
  title: string;
  stages: { label: string; value: number }[];
}) {
  const base = Math.max(1, stages[0]?.value ?? 1);
  return (
    <EiaPanel className="eia-c-stack" material="dense">
      <h3>{title}</h3>
      <ol className="eia-c-funnel">
        {stages.map((stage, index) => (
          <li key={stage.label}>
            <div className="eia-c-between">
              <strong>{stage.label}</strong>
              <span>{stage.value.toLocaleString('pt-BR')}</span>
            </div>
            <div className="eia-c-funnel-track">
              <span
                style={{
                  width: `${Math.min(100, Math.max(0, (stage.value / base) * 100))}%`,
                }}
              />
            </div>
            <small>
              {index
                ? `${stages[index - 1].value ? ((stage.value / stages[index - 1].value) * 100).toFixed(1) : 0}% da etapa anterior`
                : '100% da entrada'}
            </small>
          </li>
        ))}
      </ol>
    </EiaPanel>
  );
}
export function EiaHeatmap({
  values,
  label = 'Atividade ao longo do ano',
  startDate = '2026-01-01',
}: {
  values: number[];
  label?: string;
  startDate?: string;
}) {
  const [selected, setSelected] = React.useState(0);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const max = Math.max(1, ...values);
  const firstDay = new Date(`${startDate}T12:00:00`);
  const offset = (firstDay.getDay() + 6) % 7;
  const total = values.reduce((sum, value) => sum + value, 0);
  const activeDays = values.filter((value) => value > 0).length;
  let streak = 0,
    longestStreak = 0;
  for (const value of values) {
    streak = value > 0 ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
  }
  const peakIndex = values.indexOf(Math.max(0, ...values));
  const monthLabels = values.flatMap((_, index) => {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + index);
    return index === 0 || day.getDate() === 1
      ? [{ index, label: day.toLocaleDateString('pt-BR', { month: 'short' }) }]
      : [];
  });
  function date(index: number) {
    const day = new Date(`${startDate}T12:00:00`);
    day.setDate(day.getDate() + index);
    return day.toLocaleDateString('pt-BR');
  }
  function key(event: React.KeyboardEvent, index: number) {
    const change = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[
      event.key
    ];
    if (change === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(values.length - 1, index + change));
    setSelected(next);
    refs.current[next]?.focus();
  }
  return (
    <EiaPanel className="eia-c-stack" material="dense">
      <h3>{label}</h3>
      <div className="eia-c-heatmap-scroll">
        <div
          className="eia-c-heatmap-months"
          aria-hidden="true"
          style={{
            gridTemplateColumns: `repeat(${Math.ceil((offset + values.length) / 7)}, 13px)`,
          }}
        >
          {monthLabels.map((month) => (
            <span
              key={month.index}
              style={{ gridColumn: Math.floor((offset + month.index) / 7) + 1 }}
            >
              {month.label}
            </span>
          ))}
        </div>
        <div
          className="eia-c-heatmap"
          role="group"
          aria-label={`${label}. Use as setas para navegar pelos dias.`}
        >
          {Array.from({ length: offset }, (_, index) => (
            <span key={`offset-${index}`} aria-hidden="true" />
          ))}
          {values.map((value, index) => (
            <button
              type="button"
              key={index}
              ref={(element) => {
                refs.current[index] = element;
              }}
              tabIndex={index === selected ? 0 : -1}
              aria-label={`${date(index)}: ${value} atividades`}
              title={`${date(index)}: ${value}`}
              data-level={
                value === 0 ? 0 : Math.max(1, Math.ceil((value / max) * 4))
              }
              data-selected={index === selected || undefined}
              onClick={() => setSelected(index)}
              onFocus={() => setSelected(index)}
              onKeyDown={(event) => key(event, index)}
            />
          ))}
        </div>
      </div>
      <dl className="eia-c-heatmap-facts">
        <div>
          <dt>Atividades</dt>
          <dd>{total.toLocaleString('pt-BR')}</dd>
        </div>
        <div>
          <dt>Dias ativos</dt>
          <dd>
            {activeDays} de {values.length}
          </dd>
        </div>
        <div>
          <dt>Maior sequência</dt>
          <dd>{longestStreak} dias</dd>
        </div>
        <div>
          <dt>Pico</dt>
          <dd>
            {peakIndex >= 0
              ? `${values[peakIndex]} · ${date(peakIndex)}`
              : 'Sem dados'}
          </dd>
        </div>
      </dl>
      <div className="eia-c-between">
        <output>
          {values.length
            ? `${date(selected)} · ${values[selected] ?? 0} atividades`
            : 'Sem atividade registrada.'}
        </output>
        <span className="eia-c-muted">Menos ░ ▒ ▓ Mais</span>
      </div>
    </EiaPanel>
  );
}
export function EiaSparkline({
  title,
  values,
  unit = '',
  kind = 'line',
  labels,
  projectedFrom,
  lowerIsBetter = false,
}: {
  title: string;
  values: number[];
  unit?: string;
  kind?: 'line' | 'area' | 'bar' | 'step';
  labels?: string[];
  projectedFrom?: number;
  lowerIsBetter?: boolean;
}) {
  const [selected, setSelected] = React.useState<number | null>(null);
  const lastReal =
    projectedFrom === undefined
      ? values.length - 1
      : Math.max(0, Math.min(values.length - 1, projectedFrom - 1));
  const max = Math.max(1, ...values);
  const x = (index: number) =>
    4 + (index / Math.max(1, values.length - 1)) * 152;
  const y = (value: number) => 48 - (Math.max(0, value) / max) * 42;
  const path = (start: number, end: number) =>
    values
      .slice(start, end + 1)
      .map((value, offset) => {
        const index = start + offset;
        return offset === 0
          ? `M${x(index)},${y(value)}`
          : kind === 'step'
            ? `H${x(index)} V${y(value)}`
            : `L${x(index)},${y(value)}`;
      })
      .join(' ');
  const first = values[0] ?? 0;
  const last = values[lastReal] ?? 0;
  const active = Math.max(0, Math.min(values.length - 1, selected ?? lastReal));
  const delta = last - first;
  const good = lowerIsBetter ? delta <= 0 : delta >= 0;
  const readout = values[active] ?? 0;
  const labelAt = (index: number) => labels?.[index] ?? `Leitura ${index + 1}`;
  const barWidth = 152 / Math.max(1, values.length);
  function follow(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setSelected(
      Math.max(
        0,
        Math.min(
          values.length - 1,
          Math.round(
            ((event.clientX - rect.left) / rect.width) * (values.length - 1),
          ),
        ),
      ),
    );
  }
  return (
    <EiaPanel className="eia-c-sparkline">
      <p>{title}</p>
      <strong>
        {last.toLocaleString('pt-BR')} {unit}
      </strong>
      <svg
        viewBox="0 0 160 55"
        role="img"
        aria-label={`${title}: ${values.join(', ')}. Escala de zero a ${max}.`}
        onPointerMove={follow}
        onPointerLeave={() => setSelected(null)}
      >
        <line x1="0" x2="160" y1="48" y2="48" className="eia-c-chart-grid" />
        {kind === 'bar' ? (
          values.map((value, index) => (
            <rect
              key={index}
              x={4 + index * barWidth}
              y={y(value)}
              width={Math.max(1, barWidth - 3)}
              height={48 - y(value)}
              fill="var(--eia-color-chart-1)"
              opacity={index === active ? 1 : 0.6}
              rx="1"
            />
          ))
        ) : (
          <>
            {kind === 'area' && values.length > 0 && (
              <path
                d={`${path(0, lastReal)} L${x(lastReal)},48 L${x(0)},48 Z`}
                fill="var(--eia-color-chart-1)"
                opacity=".13"
              />
            )}
            <path
              d={path(0, lastReal)}
              fill="none"
              stroke="var(--eia-color-chart-1)"
              strokeWidth="2.5"
            />
            {lastReal < values.length - 1 && (
              <path
                d={path(lastReal, values.length - 1)}
                fill="none"
                stroke="var(--eia-color-chart-1)"
                strokeWidth="2.5"
                strokeDasharray="4 3"
              />
            )}
            {values.length > 0 && (
              <circle
                cx={x(active)}
                cy={y(readout)}
                r="3"
                fill="var(--eia-color-text)"
              />
            )}
          </>
        )}
      </svg>
      <EiaBadge tone={delta === 0 ? 'neutral' : good ? 'success' : 'warning'}>
        {delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : '= '}
        {first
          ? `${(((last - first) / first) * 100).toFixed(1)}% no período`
          : 'Evolução do período'}
        {' · '}
        {lowerIsBetter ? 'menor é melhor' : 'maior é melhor'}
      </EiaBadge>
      {projectedFrom !== undefined && (
        <p className="eia-c-muted">
          Traço contínuo: realizado. Tracejado: projeção.
        </p>
      )}
      {values.length > 0 && (
        <label className="eia-c-spark-control">
          Detalhar leitura
          <input
            type="range"
            min={0}
            max={values.length - 1}
            step={1}
            value={active}
            onChange={(event) => setSelected(Number(event.target.value))}
            aria-label={`Detalhar leitura de ${title}`}
          />
        </label>
      )}
      <output className="eia-c-spark-readout">
        {values.length
          ? `${labelAt(active)} · ${readout.toLocaleString('pt-BR')} ${unit}${projectedFrom !== undefined && active >= projectedFrom ? ' · projeção' : ''}`
          : 'Sem dados.'}
      </output>
    </EiaPanel>
  );
}
export function EiaGauge({
  label,
  value,
  max = 100,
  target = 80,
  unit = '%',
  lowerIsBetter = false,
  tolerance = 0,
}: {
  label: string;
  value: number;
  max?: number;
  target?: number;
  unit?: string;
  lowerIsBetter?: boolean;
  tolerance?: number;
}) {
  const ceiling = Math.max(1, max);
  const fraction = Math.max(0, Math.min(1, value / ceiling));
  const angle = Math.PI + Math.max(0, Math.min(1, target / ceiling)) * Math.PI;
  const distance = lowerIsBetter ? target - value : value - target;
  const reached = distance >= 0;
  const near = !reached && -distance <= Math.max(0, tolerance);
  return (
    <EiaPanel className="eia-c-gauge" material="dense">
      <h3>{label}</h3>
      <svg
        viewBox="0 0 240 145"
        role="img"
        aria-label={`${label}: ${value}${unit}, ${lowerIsBetter ? 'limite' : 'meta'} ${target}${unit}, escala de 0 a ${max}. ${lowerIsBetter ? 'Menor é melhor.' : 'Maior é melhor.'}`}
      >
        <path
          d="M25 115 A95 95 0 0 1 215 115"
          fill="none"
          className="eia-c-chart-track"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M25 115 A95 95 0 0 1 215 115"
          pathLength="100"
          fill="none"
          stroke="var(--eia-color-chart-1)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${fraction * 100} 100`}
        />
        <line
          x1={120 + Math.cos(angle) * 84}
          y1={115 + Math.sin(angle) * 84}
          x2={120 + Math.cos(angle) * 106}
          y2={115 + Math.sin(angle) * 106}
          stroke="var(--eia-color-text)"
          strokeWidth="3"
        />
        <text x="120" y="98" textAnchor="middle" className="eia-c-chart-value">
          {value}
          {unit}
        </text>
        <text x="25" y="140" textAnchor="middle" className="eia-c-chart-label">
          0
        </text>
        <text x="215" y="140" textAnchor="middle" className="eia-c-chart-label">
          {max}
        </text>
      </svg>
      <EiaBadge tone={reached ? 'success' : near ? 'warning' : 'danger'}>
        {reached ? 'Dentro do alvo' : near ? 'Atenção' : 'Fora do alvo'}
      </EiaBadge>
      <p className="eia-c-muted">
        {lowerIsBetter ? 'Limite' : 'Meta'}: {target}
        {unit} · {Math.abs(distance).toLocaleString('pt-BR')}
        {unit} {distance >= 0 ? 'de folga' : 'de diferença'} ·{' '}
        {lowerIsBetter ? 'menor é melhor' : 'maior é melhor'}.
      </p>
    </EiaPanel>
  );
}

export type EiaStateKind =
  | 'loading'
  | '500'
  | '403'
  | 'maintenance'
  | 'empty'
  | 'offline'
  | 'success';
const stateCopy: Record<
  Exclude<EiaStateKind, 'loading'>,
  { title: string; description: string }
> = {
  '500': {
    title: 'O serviço encontrou um problema',
    description:
      'Tente carregar novamente. Seu trabalho permanece nesta página.',
  },
  '403': {
    title: 'Este conteúdo precisa de permissão',
    description:
      'Use uma conta autorizada ou peça acesso à pessoa responsável.',
  },
  maintenance: {
    title: 'Uma pausa para melhorar',
    description:
      'O serviço está em manutenção. Volte a consultar a disponibilidade.',
  },
  empty: {
    title: 'O primeiro projeto começa aqui',
    description: 'Adicione um projeto para acompanhar suas próximas entregas.',
  },
  offline: {
    title: 'A conexão foi interrompida',
    description: 'Verifique sua conexão e tente novamente.',
  },
  success: {
    title: 'Tudo pronto para continuar',
    description: 'A etapa foi concluída e você já pode seguir para a próxima.',
  },
};
export function EiaState({
  kind,
  title,
  description,
  action,
}: {
  kind: EiaStateKind;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  if (kind === 'loading')
    return (
      <EiaPanel className="eia-c-state-loading">
        <EiaSpinner label="Carregando conteúdo" />
        <h3>{title ?? 'Preparando sua área'}</h3>
        <EiaSkeleton
          label="Buscando os dados"
          style={{ width: '65%', height: 18 }}
        />
        <EiaSkeleton style={{ width: '85%', height: 80 }} />
      </EiaPanel>
    );
  const copy = stateCopy[kind];
  return (
    <EiaPanel material="panel">
      <EiaEmpty
        title={title ?? copy.title}
        description={description ?? copy.description}
        icon={
          kind === 'success' ? (
            <Check />
          ) : kind === 'empty' ? (
            <FileText />
          ) : (
            <Info />
          )
        }
        action={action}
      />
    </EiaPanel>
  );
}
