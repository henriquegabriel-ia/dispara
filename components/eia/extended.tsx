'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Folder,
  FileText,
  GripVertical,
  X,
} from 'lucide-react';
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { ptBR } from 'date-fns/locale';
import { DateLib, type DateRange, type Matcher } from 'react-day-picker';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '@/components/ui/popover';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Calendar } from '@/components/ui/calendar';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  useCarousel,
} from '@/components/ui/carousel';
import {
  EiaBadge,
  EiaButton,
  EiaCheckbox,
  EiaDialog,
  EiaEmpty,
  EiaField,
  EiaIconButton,
  EiaInput,
  EiaLink,
  EiaPanel,
  EiaTable,
  EiaTableHeader,
  EiaTableBody,
  EiaTableRow,
  EiaTableHead,
  EiaTableCell,
  type EiaDialogProps,
} from './index';

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(' ');
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const dateLabel = (date?: Date) => date?.toLocaleDateString('pt-BR') ?? '';

export type EiaAvatarProps = {
  name: string;
  src?: string;
  initials?: string;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'away' | 'offline';
  className?: string;
};
export function EiaAvatar({
  name,
  src,
  initials,
  size = 'md',
  status,
  className,
}: EiaAvatarProps) {
  return (
    <span className={cx('eia-x-avatar-wrap', className)}>
      <Avatar className="eia-x-avatar" size={size === 'md' ? 'default' : size}>
        {src && <AvatarImage src={src} alt={name} />}
        <AvatarFallback aria-label={name}>
          {initials ??
            name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {status && (
        <span className="eia-x-avatar-status" data-status={status}>
          <span className="eia-sr-only">
            {
              { online: 'Disponível', away: 'Ausente', offline: 'Offline' }[
                status
              ]
            }
          </span>
        </span>
      )}
    </span>
  );
}
export type EiaIconProps = {
  children: React.ReactNode;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'accent' | 'danger';
  surface?: boolean;
  className?: string;
};
export function EiaIcon({
  children,
  label,
  size = 'md',
  tone = 'neutral',
  surface = false,
  className,
}: EiaIconProps) {
  return (
    <span
      className={cx('eia-x-icon', className)}
      data-size={size}
      data-tone={tone}
      data-surface={surface}
      aria-hidden={label ? undefined : true}
    >
      {label && <span className="eia-sr-only">{label}</span>}
      {children}
    </span>
  );
}
export function EiaTooltip({
  children,
  content,
  side = 'top',
  delay = 200,
}: {
  children: React.ReactElement;
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}) {
  return (
    <TooltipProvider delay={delay}>
      <Tooltip>
        <TooltipTrigger render={children} />
        <TooltipContent
          side={side}
          className="eia-theme eia-extended-popup eia-x-tooltip"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
export function EiaSignatureAnimation({
  mode = 'loop',
  size = '48px',
  className,
}: {
  mode?: 'loop' | 'open' | 'close';
  size?: string;
  className?: string;
}) {
  return (
    <span
      className={cx('eia-x-signature', className)}
      data-mode={mode}
      style={{ fontSize: size }}
    >
      <span className="eia-sr-only">Empreende.IA</span>
      <span className="eia-x-signature-word" aria-hidden="true">
        Empreende<span>.</span>IA
      </span>
      <svg
        className="eia-x-signature-mark"
        viewBox="0 0 231 264"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M210.1 70.3Q206.5 82.3 194.8 86.5L42.1 142.3Q28.8 147.2 32.3 133.5L46.1 80.3Q49.6 66.4 63.2 61.5L222.1 3.3Q231.2 0 228.4 9.3Z"
        />
        <path
          transform="translate(-29.6 117.4)"
          fill="currentColor"
          d="M210.1 70.3Q206.5 82.3 194.8 86.5L42.1 142.3Q28.8 147.2 32.3 133.5L46.1 80.3Q49.6 66.4 63.2 61.5L222.1 3.3Q231.2 0 228.4 9.3Z"
        />
      </svg>
    </span>
  );
}
export type EiaBreadcrumbItem = {
  label: string;
  href?: string;
  onClick?: () => void;
};
export function EiaBreadcrumb({
  items,
  label = 'Caminho de navegação',
  separator = <ChevronRight size={14} aria-hidden="true" />,
}: {
  items: EiaBreadcrumbItem[];
  label?: string;
  separator?: React.ReactNode;
}) {
  return (
    <nav aria-label={label} className="eia-x-breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 && <span aria-hidden="true">{separator}</span>}
            {index === items.length - 1 ? (
              <span aria-current="page">{item.label}</span>
            ) : item.href ? (
              <EiaLink href={item.href}>{item.label}</EiaLink>
            ) : item.onClick ? (
              <EiaButton size="sm" variant="ghost" onClick={item.onClick}>
                {item.label}
              </EiaButton>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
export type EiaPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
  maxVisible?: number;
};
export function EiaPagination({
  page,
  totalPages,
  onPageChange,
  disabled,
  label = 'Paginação',
  maxVisible = 5,
}: EiaPaginationProps) {
  const total = Math.max(1, Math.floor(totalPages));
  const current = clamp(Math.floor(page), 1, total);
  const limit = Number.isFinite(maxVisible)
    ? clamp(Math.floor(maxVisible), 3, 25)
    : 5;
  const middleCount = Math.max(1, limit - 2);
  const firstMiddle = clamp(
    current - Math.floor(middleCount / 2),
    2,
    Math.max(2, total - middleCount),
  );
  const pages = Array.from(
    new Set(
      [
        1,
        total,
        ...Array.from(
          { length: middleCount },
          (_, index) => firstMiddle + index,
        ),
      ].filter((n) => n >= 1 && n <= total),
    ),
  ).sort((a, b) => a - b);
  return (
    <nav className="eia-x-pagination" aria-label={label}>
      <EiaIconButton
        label="Página anterior"
        size="sm"
        disabled={disabled || current === 1}
        onClick={() => onPageChange(current - 1)}
      >
        <ChevronLeft />
      </EiaIconButton>
      {pages.map((n, i) => (
        <React.Fragment key={n}>
          {i > 0 && n - pages[i - 1] > 1 && <span aria-hidden="true">…</span>}
          <EiaButton
            size="sm"
            variant={n === current ? 'primary' : 'ghost'}
            aria-current={n === current ? 'page' : undefined}
            aria-label={`Página ${n}`}
            disabled={disabled}
            onClick={() => onPageChange(n)}
          >
            {n}
          </EiaButton>
        </React.Fragment>
      ))}
      <EiaIconButton
        label="Próxima página"
        size="sm"
        disabled={disabled || current === total}
        onClick={() => onPageChange(current + 1)}
      >
        <ChevronRight />
      </EiaIconButton>
    </nav>
  );
}
export type EiaAccordionProps = {
  items: {
    id: string;
    title: React.ReactNode;
    content: React.ReactNode;
    disabled?: boolean;
  }[];
  multiple?: boolean;
  variant?: 'flush' | 'separated';
  defaultOpen?: string[];
  value?: string[];
  onValueChange?: (ids: string[]) => void;
};
export function EiaAccordion({
  items,
  multiple = false,
  variant = 'flush',
  defaultOpen = [],
  value,
  onValueChange,
}: EiaAccordionProps) {
  return (
    <Accordion
      className="eia-x-accordion"
      data-variant={variant}
      multiple={multiple}
      defaultValue={defaultOpen}
      value={value}
      onValueChange={(values) => onValueChange?.(values.map(String))}
    >
      {items.map((item) => (
        <AccordionItem value={item.id} key={item.id} disabled={item.disabled}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
export type EiaStepperProps = {
  steps: {
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }[];
  current: number;
  onStepChange?: (index: number) => void;
  orientation?: 'horizontal' | 'vertical';
  label?: string;
};
export function EiaStepper({
  steps,
  current,
  onStepChange,
  orientation = 'horizontal',
  label = 'Etapas do projeto',
}: EiaStepperProps) {
  return (
    <nav
      aria-label={label}
      className="eia-x-stepper"
      data-orientation={orientation}
    >
      <ol>
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={current === index ? 'step' : undefined}
            data-complete={index < current}
          >
            <EiaButton
              variant="ghost"
              disabled={step.disabled || index > current || !onStepChange}
              onClick={() => onStepChange?.(index)}
            >
              <span className="eia-x-step-number">
                {index < current ? <Check size={15} /> : index + 1}
              </span>
              <span>
                {step.label}
                {step.description && <small>{step.description}</small>}
              </span>
            </EiaButton>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type EiaOption = {
  value: string;
  label: string;
  content?: React.ReactNode;
  searchText?: string;
  disabled?: boolean;
};
const optionMatches = (item: EiaOption, query: string) =>
  (item.searchText ?? item.label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .includes(
      query
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('pt-BR'),
    );
export type EiaComboboxProps = {
  label: string;
  options: EiaOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  error?: string;
  size?: 'sm' | 'md';
  hint?: string;
};
export function EiaCombobox({
  label,
  options,
  value,
  onValueChange,
  disabled,
  placeholder = 'Buscar opção…',
  error,
  emptyLabel = 'Nenhuma opção encontrada.',
  size = 'md',
  hint,
}: EiaComboboxProps) {
  const id = React.useId();
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <EiaField label={label} htmlFor={id} error={error} description={hint}>
      <ComboboxPrimitive.Root
        items={options}
        filter={optionMatches}
        value={selected}
        onValueChange={(next) => onValueChange(next?.value ?? '')}
        itemToStringLabel={(item) => item.label}
        isItemEqualToValue={(a, b) => a.value === b.value}
        disabled={disabled}
      >
        <div className="eia-x-combobox-control">
          <ComboboxPrimitive.Input
            id={id}
            className="eia-input"
            data-size={size}
            placeholder={placeholder}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <ComboboxPrimitive.Trigger
            aria-label={`Abrir ${label}`}
            className="eia-x-combobox-trigger"
          >
            <ChevronDown size={16} />
          </ComboboxPrimitive.Trigger>
        </div>
        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner
            className="eia-x-positioner"
            sideOffset={6}
          >
            <ComboboxPrimitive.Popup className="eia-theme eia-extended-popup eia-x-combobox-popup">
              <ComboboxPrimitive.Empty className="eia-x-empty">
                {emptyLabel}
              </ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List>
                {(option: EiaOption) => (
                  <ComboboxPrimitive.Item
                    key={option.value}
                    value={option}
                    disabled={option.disabled}
                    className="eia-x-option"
                  >
                    <span>{option.content ?? option.label}</span>
                    <ComboboxPrimitive.ItemIndicator>
                      <Check size={16} />
                    </ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                )}
              </ComboboxPrimitive.List>
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </ComboboxPrimitive.Root>
    </EiaField>
  );
}
export type EiaMultiSelectProps = Omit<
  EiaComboboxProps,
  'value' | 'onValueChange'
> & {
  value: string[];
  onValueChange: (values: string[]) => void;
  max?: number;
};
export function EiaMultiSelect({
  label,
  options,
  value,
  onValueChange,
  disabled,
  placeholder = 'Buscar e selecionar…',
  error,
  emptyLabel = 'Nenhuma opção encontrada.',
  max = 0,
  size = 'md',
  hint,
}: EiaMultiSelectProps) {
  const id = React.useId();
  const selected = options.filter((option) => value.includes(option.value));
  return (
    <EiaField
      label={label}
      htmlFor={id}
      error={error}
      description={
        [hint, max > 0 ? `${value.length} de ${max} opções selecionadas` : '']
          .filter(Boolean)
          .join(' · ') || undefined
      }
    >
      <ComboboxPrimitive.Root
        multiple
        items={options}
        filter={optionMatches}
        value={selected}
        onValueChange={(next) => {
          if (!max || next.length <= max)
            onValueChange(next.map((option) => option.value));
        }}
        itemToStringLabel={(item) => item.label}
        isItemEqualToValue={(a, b) => a.value === b.value}
        disabled={disabled}
      >
        <ComboboxPrimitive.Chips className="eia-x-chips" data-size={size}>
          {selected.map((option) => (
            <ComboboxPrimitive.Chip key={option.value} className="eia-x-chip">
              {option.label}
              <ComboboxPrimitive.ChipRemove
                className="eia-x-chip-remove"
                aria-label={`Remover ${option.label}`}
                disabled={disabled || option.disabled}
              >
                <X size={14} />
              </ComboboxPrimitive.ChipRemove>
            </ComboboxPrimitive.Chip>
          ))}
          <ComboboxPrimitive.Input
            id={id}
            className="eia-x-chip-input"
            placeholder={placeholder}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </ComboboxPrimitive.Chips>
        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner
            className="eia-x-positioner"
            sideOffset={6}
          >
            <ComboboxPrimitive.Popup className="eia-theme eia-extended-popup eia-x-combobox-popup">
              <ComboboxPrimitive.Empty className="eia-x-empty">
                {emptyLabel}
              </ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List>
                {(option: EiaOption) => (
                  <ComboboxPrimitive.Item
                    key={option.value}
                    value={option}
                    disabled={
                      option.disabled ||
                      (!!max &&
                        value.length >= max &&
                        !value.includes(option.value))
                    }
                    className="eia-x-option"
                  >
                    <span>{option.content ?? option.label}</span>
                    <ComboboxPrimitive.ItemIndicator>
                      <Check size={16} />
                    </ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                )}
              </ComboboxPrimitive.List>
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </ComboboxPrimitive.Root>
    </EiaField>
  );
}
export type EiaPopoverProps = {
  trigger: React.ReactElement;
  children: React.ReactNode;
  title: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
};
export function EiaPopover({
  trigger,
  children,
  title,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  closeOnOutsideClick = true,
  closeOnEscape = true,
}: EiaPopoverProps) {
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (
          (!closeOnOutsideClick &&
            (details.reason === 'outside-press' ||
              details.reason === 'focus-out')) ||
          (!closeOnEscape && details.reason === 'escape-key')
        ) {
          details.cancel();
          return;
        }
        onOpenChange?.(next);
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side={side}
        align={align}
        className="eia-theme eia-extended-popup"
      >
        <PopoverTitle className="eia-x-popup-title">{title}</PopoverTitle>
        {children}
      </PopoverContent>
    </Popover>
  );
}
export function EiaHoverCard({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  openDelay = 300,
  closeDelay = 200,
}: {
  trigger: React.ReactElement;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  openDelay?: number;
  closeDelay?: number;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger
        render={trigger}
        delay={openDelay}
        closeDelay={closeDelay}
      />
      <HoverCardContent
        side={side}
        align={align}
        className="eia-theme eia-extended-popup"
      >
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}
export type EiaCommandItem = {
  id: string;
  label: string;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  group?: string;
  icon?: React.ReactNode;
  hint?: string;
};
export function EiaCommand({
  open,
  onOpenChange,
  items,
  onSelect,
  placeholder = 'Buscar comandos…',
  emptyLabel = 'Nenhum resultado.',
  title = 'O que você quer fazer?',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: EiaCommandItem[];
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyLabel?: React.ReactNode;
  title?: string;
}) {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const groups = Array.from(
    new Set(items.map((item) => item.group ?? 'Ações')),
  );
  return (
    <EiaDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Busque uma ação. Use as setas e Enter para escolher."
      className="eia-x-command-dialog"
      initialFocus={searchRef}
    >
      <Command
        className="eia-x-command"
        filter={(value, search, keywords) => {
          const normalize = (text: string) =>
            text
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLocaleLowerCase('pt-BR');
          const haystack = normalize([value, ...(keywords ?? [])].join(' '));
          return normalize(search)
            .trim()
            .split(/\s+/)
            .every((token) => haystack.includes(token))
            ? 1
            : 0;
        }}
      >
        <CommandInput
          ref={searchRef}
          placeholder={placeholder}
          aria-label="Buscar comandos"
        />
        <CommandList>
          <CommandEmpty>{emptyLabel}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {items
                .filter((item) => (item.group ?? 'Ações') === group)
                .map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    keywords={[
                      item.label,
                      item.hint ?? '',
                      ...(item.keywords ?? []),
                    ]}
                    disabled={item.disabled}
                    onSelect={() => {
                      onSelect(item.id);
                      onOpenChange(false);
                    }}
                  >
                    {item.icon && <span aria-hidden="true">{item.icon}</span>}
                    <span>
                      {item.label}
                      {item.hint && (
                        <small className="eia-x-command-hint">
                          {item.hint}
                        </small>
                      )}
                    </span>
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </EiaDialog>
  );
}
export type EiaCalendarProps = React.ComponentProps<typeof Calendar>;
const portugueseCalendarLabels: EiaCalendarProps['labels'] = {
  labelNav: () => 'Navegação do calendário',
  labelNext: () => 'Ir para o próximo mês',
  labelPrevious: () => 'Ir para o mês anterior',
  labelMonthDropdown: () => 'Escolher mês',
  labelYearDropdown: () => 'Escolher ano',
  labelWeekNumber: (week) => `Semana ${week}`,
  labelWeekNumberHeader: () => 'Número da semana',
  labelDayButton: (date, modifiers, options, dateLib) =>
    [
      modifiers.today ? 'Hoje' : '',
      (dateLib ?? new DateLib(options)).format(date, 'PPPP'),
      modifiers.selected ? 'Selecionado' : '',
      modifiers.disabled ? 'Indisponível' : '',
    ]
      .filter(Boolean)
      .join(', '),
  labelGridcell: (date, modifiers, options, dateLib) =>
    [
      modifiers?.today ? 'Hoje' : '',
      (dateLib ?? new DateLib(options)).format(date, 'PPPP'),
    ]
      .filter(Boolean)
      .join(', '),
};
export function EiaCalendar({
  locale = ptBR,
  labels,
  ...props
}: EiaCalendarProps) {
  return (
    <Calendar
      locale={locale}
      weekStartsOn={1}
      {...props}
      labels={{
        ...(locale.code?.startsWith('pt') ? portugueseCalendarLabels : {}),
        ...labels,
      }}
      className={cx('eia-x-calendar', props.className)}
    />
  );
}
function dateBounds(min?: Date, max?: Date): Matcher[] {
  return [...(min ? [{ before: min }] : []), ...(max ? [{ after: max }] : [])];
}
export type EiaDatePickerProps = {
  label: string;
  value?: Date;
  onValueChange: (value: Date | undefined) => void;
  min?: Date;
  max?: Date;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  weekStartsOn?: 0 | 1;
  formatLabel?: (date: Date) => string;
};
export function EiaDatePicker({
  label,
  value,
  onValueChange,
  min,
  max,
  disabled,
  error,
  placeholder = 'Escolher data',
  weekStartsOn = 1,
  formatLabel = dateLabel,
}: EiaDatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <EiaField label={label} htmlFor={id} error={error}>
      <EiaPopover
        open={open}
        onOpenChange={setOpen}
        title={label}
        trigger={
          <EiaButton
            id={id}
            variant="secondary"
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            trailingIcon={<ChevronDown size={16} />}
          >
            {value ? formatLabel(value) : placeholder}
          </EiaButton>
        }
      >
        <EiaCalendar
          mode="single"
          weekStartsOn={weekStartsOn}
          selected={value}
          onSelect={(date) => {
            onValueChange(date);
            setOpen(false);
          }}
          defaultMonth={value ?? min}
          disabled={dateBounds(min, max)}
        />
        <EiaButton
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => {
            onValueChange(undefined);
            setOpen(false);
          }}
        >
          Limpar data
        </EiaButton>
      </EiaPopover>
    </EiaField>
  );
}
export type EiaDateRange = DateRange;
export function EiaDateRangePicker({
  label,
  value,
  onValueChange,
  min,
  max,
  disabled,
  showPresets = false,
  numMonths = 2,
  defaultMonth,
  locale,
  formatLabel = dateLabel,
}: {
  label: string;
  value?: DateRange;
  onValueChange: (range: DateRange | undefined) => void;
  min?: Date;
  max?: Date;
  disabled?: boolean;
  showPresets?: boolean;
  numMonths?: number;
  defaultMonth?: Date;
  locale?: EiaCalendarProps['locale'];
  formatLabel?: (date?: Date) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <EiaField label={label} htmlFor={id}>
      <EiaPopover
        title={label}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <EiaButton
            id={id}
            variant="secondary"
            disabled={disabled}
            trailingIcon={<ChevronDown size={16} />}
          >
            {value?.from
              ? `${formatLabel(value.from)} — ${formatLabel(value.to) || 'Fim'}`
              : 'Escolher período'}
          </EiaButton>
        }
      >
        <EiaCalendar
          className="eia-x-range-calendar"
          mode="range"
          numberOfMonths={
            Number.isFinite(numMonths) ? Math.max(1, Math.floor(numMonths)) : 2
          }
          selected={value}
          onSelect={onValueChange}
          defaultMonth={defaultMonth ?? value?.from ?? min}
          {...(locale ? { locale } : {})}
          disabled={dateBounds(min, max)}
          excludeDisabled
        />
        {showPresets && (
          <div className="eia-x-row">
            {[7, 30, 90].map((days) => (
              <EiaButton
                key={days}
                variant="ghost"
                size="sm"
                onClick={() => {
                  const to = new Date();
                  to.setHours(0, 0, 0, 0);
                  if (max && to > max) to.setTime(max.getTime());
                  const from = new Date(to);
                  from.setDate(from.getDate() - days + 1);
                  if (min && from < min) from.setTime(min.getTime());
                  if (from <= to) onValueChange({ from, to });
                }}
              >
                Últimos {days} dias
              </EiaButton>
            ))}
          </div>
        )}
        <div className="eia-x-row">
          <EiaButton
            variant="ghost"
            size="sm"
            onClick={() => onValueChange(undefined)}
          >
            Limpar
          </EiaButton>
          <EiaButton size="sm" onClick={() => setOpen(false)}>
            Concluir
          </EiaButton>
        </div>
      </EiaPopover>
    </EiaField>
  );
}
export type EiaSliderProps = {
  label: string;
  value: number | number[];
  onValueChange: (value: number | number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  hint?: string;
  id?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'accent';
  showValue?: boolean;
  marks?: { value: number; label: string }[];
};
export function EiaSlider({
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  formatValue = String,
  hint,
  marks,
  id: providedId,
  name,
  size = 'md',
  tone = 'accent',
  showValue = true,
}: EiaSliderProps) {
  const generatedId = React.useId();
  const id = providedId ?? generatedId;
  const values = Array.isArray(value) ? value : [value];
  return (
    <div className="eia-x-slider" id={id} data-size={size} data-tone={tone}>
      <div className="eia-x-row">
        <span id={`${id}-label`}>{label}</span>
        {showValue && <output>{values.map(formatValue).join(' — ')}</output>}
      </div>
      <SliderPrimitive.Root
        name={name}
        value={value}
        onValueChange={onValueChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      >
        <SliderPrimitive.Control className="eia-x-slider-control">
          <SliderPrimitive.Track className="eia-x-slider-track">
            <SliderPrimitive.Indicator className="eia-x-slider-fill" />
          </SliderPrimitive.Track>
          {values.map((_, index) => (
            <SliderPrimitive.Thumb
              key={index}
              index={index}
              className="eia-x-slider-thumb"
              aria-label={`${label}${values.length > 1 ? ` ${index === 0 ? 'mínimo' : 'máximo'}` : ''}`}
              getAriaValueText={(_formatted, next) => formatValue(next)}
            />
          ))}
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
      {marks && (
        <div className="eia-x-slider-marks">
          {marks.map((mark) => (
            <span
              key={mark.value}
              style={{
                left: `${clamp(((mark.value - min) / (max - min)) * 100, 0, 100)}%`,
              }}
            >
              {mark.label}
            </span>
          ))}
        </div>
      )}
      {hint && <p className="eia-x-hint">{hint}</p>}
    </div>
  );
}
export function EiaOTPInput({
  label,
  value,
  onValueChange,
  length = 6,
  onComplete,
  disabled,
  error,
  inputType = 'numeric',
  hint,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  length?: number;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: string;
  inputType?: 'numeric' | 'text';
  hint?: string;
  autoFocus?: boolean;
}) {
  const id = React.useId();
  const count = clamp(Math.floor(length), 1, 12);
  return (
    <EiaField label={label} htmlFor={id} error={error} description={hint}>
      <InputOTP
        id={id}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Explicit host opt-in, disabled by default; restores original wrapper capability.
        autoFocus={autoFocus}
        maxLength={count}
        value={value}
        onChange={onValueChange}
        onComplete={onComplete}
        inputMode={inputType}
        pattern={inputType === 'numeric' ? '^[0-9]+$' : '^[a-zA-Z0-9]+$'}
        autoComplete="one-time-code"
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        containerClassName="eia-x-otp"
      >
        <InputOTPGroup>
          {Array.from({ length: count }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </EiaField>
  );
}
export function EiaTagInput({
  label,
  value,
  onValueChange,
  max = 0,
  disabled,
  error,
  suggestions = [],
  allowDuplicates = false,
  size = 'md',
  hint,
}: {
  label: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  max?: number;
  disabled?: boolean;
  error?: string;
  suggestions?: string[];
  allowDuplicates?: boolean;
  size?: 'sm' | 'md';
  hint?: string;
}) {
  const id = React.useId();
  const [draft, setDraft] = React.useState('');
  const [feedback, setFeedback] = React.useState('');
  function add(raw: string) {
    const tag = raw.trim();
    if (!tag || disabled) return;
    if (
      !allowDuplicates &&
      value.some(
        (item) =>
          item.toLocaleLowerCase('pt-BR') === tag.toLocaleLowerCase('pt-BR'),
      )
    ) {
      setFeedback('Essa palavra já foi adicionada.');
      return;
    }
    if (max > 0 && value.length >= max) {
      setFeedback(`Você pode adicionar até ${max} palavras.`);
      return;
    }
    onValueChange([...value, tag]);
    setDraft('');
    setFeedback(`${tag} adicionada.`);
  }
  return (
    <EiaField
      label={label}
      htmlFor={id}
      error={error}
      description={[
        hint,
        'Enter ou vírgula adiciona. Backspace no campo vazio remove a última palavra.',
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <div className="eia-x-chips" data-size={size}>
        {value.map((tag, index) => (
          <span className="eia-x-chip" key={`${tag}-${index}`}>
            {tag}
            <button
              type="button"
              className="eia-x-chip-remove"
              aria-label={`Remover ${tag}`}
              disabled={disabled}
              onClick={() => onValueChange(value.filter((_, i) => i !== index))}
            >
              <X size={14} />
            </button>
          </span>
        ))}
        <EiaInput
          id={id}
          className="eia-x-chip-input"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add(draft);
            } else if (event.key === 'Backspace' && !draft && value.length) {
              onValueChange(value.slice(0, -1));
            }
          }}
          placeholder="Adicionar palavra…"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="eia-x-row">
          {suggestions
            .filter((item) => !value.includes(item))
            .map((item) => (
              <EiaButton
                size="sm"
                variant="ghost"
                key={item}
                disabled={disabled || (!!max && value.length >= max)}
                onClick={() => add(item)}
              >
                + {item}
              </EiaButton>
            ))}
        </div>
      )}
      <output className="eia-x-hint">{feedback}</output>
    </EiaField>
  );
}
export function EiaTimePicker({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 15,
  disabled,
  error,
  size = 'md',
  hint,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  step?: number;
  disabled?: boolean;
  error?: string;
  size?: 'sm' | 'md';
  hint?: string;
}) {
  const id = React.useId();
  return (
    <EiaField
      label={label}
      htmlFor={id}
      error={error}
      description={[hint, `Formato 24 horas · intervalos de ${step} minutos`]
        .filter(Boolean)
        .join(' · ')}
    >
      <EiaInput
        id={id}
        type="time"
        controlSize={size}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        min={min}
        max={max}
        step={step * 60}
        disabled={disabled}
      />
    </EiaField>
  );
}
export type EiaSheetProps = EiaDialogProps & {
  maxHeight?: React.CSSProperties['maxHeight'];
  showHandle?: boolean;
};
export function EiaSheet({
  maxHeight,
  showHandle = true,
  style,
  ...props
}: EiaSheetProps) {
  return (
    <EiaDialog
      {...props}
      data-handle={showHandle || undefined}
      style={(state) => ({
        ...(typeof style === 'function' ? style(state) : style),
        ...(maxHeight === undefined ? {} : { maxHeight }),
      })}
      className={cx('eia-x-sheet', props.className)}
    />
  );
}
export type EiaContextMenuItem = {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  shortcut?: string;
};
export function EiaContextMenu({
  children,
  items,
  label = 'Ações do conteúdo',
}: {
  children: React.ReactNode;
  items: EiaContextMenuItem[];
  label?: string;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="eia-x-context-target"
        tabIndex={0}
        aria-label={label}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="eia-theme eia-extended-popup">
        {items.map((item, index) => (
          <React.Fragment key={`${item.label}-${index}`}>
            {item.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={item.disabled}
              variant={item.danger ? 'destructive' : 'default'}
              onClick={item.onSelect}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              {item.label}
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </ContextMenuItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export type EiaTreeNode = {
  id: string;
  label: React.ReactNode;
  textValue?: string;
  highlighted?: boolean;
  children?: EiaTreeNode[];
  disabled?: boolean;
  icon?: React.ReactNode;
  count?: number;
};
export type EiaTreeViewProps = {
  nodes: EiaTreeNode[];
  label: string;
  selected?: string;
  onSelect?: (id: string) => void;
  expanded?: string[];
  onExpandedChange?: (ids: string[]) => void;
  defaultExpanded?: string[];
};
export function EiaTreeView({
  nodes,
  label,
  selected,
  onSelect,
  expanded,
  onExpandedChange,
  defaultExpanded = [],
}: EiaTreeViewProps) {
  const id = React.useId();
  const [localExpanded, setLocalExpanded] = React.useState(defaultExpanded);
  const [active, setActive] = React.useState('');
  const [localSelected, setLocalSelected] = React.useState('');
  const treeRef = React.useRef<HTMLDivElement>(null);
  const open = expanded ?? localExpanded;
  type VisibleNode = {
    node: EiaTreeNode;
    parent?: string;
    level: number;
    position: number;
    siblings: number;
  };
  const visible: VisibleNode[] = [];
  function flatten(items: EiaTreeNode[], level: number, parent?: string) {
    items.forEach((node, index) => {
      visible.push({
        node,
        level,
        parent,
        position: index + 1,
        siblings: items.length,
      });
      if (node.children?.length && open.includes(node.id))
        flatten(node.children, level + 1, node.id);
    });
  }
  flatten(nodes, 1);
  const enabled = visible.filter((item) => !item.node.disabled);
  const currentId = enabled.some((item) => item.node.id === active)
    ? active
    : enabled[0]?.node.id;
  function toggle(nodeId: string, nextOpen: boolean) {
    const next = nextOpen
      ? [...new Set([...open, nodeId])]
      : open.filter((item) => item !== nodeId);
    if (expanded === undefined) setLocalExpanded(next);
    onExpandedChange?.(next);
  }
  function focus(nodeId: string) {
    setActive(nodeId);
  }
  function choose(nodeId: string) {
    setLocalSelected(nodeId);
    onSelect?.(nodeId);
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((item) => item.node.id === currentId);
    const item = enabled[index];
    if (!item) return;
    const branch = !!item.node.children?.length;
    const isOpen = open.includes(item.node.id);
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'Enter',
        ' ',
      ].includes(event.key)
    )
      event.preventDefault();
    if (event.key === 'ArrowDown')
      focus(enabled[Math.min(index + 1, enabled.length - 1)].node.id);
    if (event.key === 'ArrowUp') focus(enabled[Math.max(index - 1, 0)].node.id);
    if (event.key === 'Home') focus(enabled[0].node.id);
    if (event.key === 'End') focus(enabled[enabled.length - 1].node.id);
    if (event.key === 'ArrowRight' && branch) {
      if (!isOpen) toggle(item.node.id, true);
      else if (enabled[index + 1]?.parent === item.node.id)
        focus(enabled[index + 1].node.id);
    }
    if (event.key === 'ArrowLeft') {
      if (branch && isOpen) toggle(item.node.id, false);
      else if (
        item.parent &&
        enabled.some((row) => row.node.id === item.parent)
      )
        focus(item.parent);
    }
    if (event.key === 'Enter' || event.key === ' ') {
      choose(item.node.id);
      if (branch) toggle(item.node.id, !isOpen);
    }
    if (event.key.length === 1 && event.key !== ' ') {
      const match = [
        ...enabled.slice(index + 1),
        ...enabled.slice(0, index + 1),
      ].find((row) =>
        (
          row.node.textValue ??
          (typeof row.node.label === 'string' ? row.node.label : '')
        )
          .toLocaleLowerCase('pt-BR')
          .startsWith(event.key.toLocaleLowerCase('pt-BR')),
      );
      if (match) focus(match.node.id);
    }
  }
  return (
    <div
      ref={treeRef}
      role="tree"
      className="eia-x-tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={currentId ? `${id}-${currentId}` : undefined}
      onKeyDown={keyDown}
    >
      {visible.map(({ node, level, position, siblings }) => (
        <div
          role="treeitem"
          tabIndex={-1}
          onKeyDown={(event) => {
            event.stopPropagation();
            keyDown(event);
          }}
          id={`${id}-${node.id}`}
          key={node.id}
          aria-level={level}
          aria-posinset={position}
          aria-setsize={siblings}
          aria-selected={(selected ?? localSelected) === node.id}
          aria-expanded={
            node.children?.length ? open.includes(node.id) : undefined
          }
          aria-disabled={node.disabled || undefined}
          className="eia-x-tree-item"
          data-active={currentId === node.id}
          data-highlighted={node.highlighted || undefined}
          style={{ paddingInlineStart: (level - 1) * 20 + 12 }}
          onClick={() => {
            if (node.disabled) return;
            focus(node.id);
            choose(node.id);
            if (node.children?.length) toggle(node.id, !open.includes(node.id));
            treeRef.current?.focus();
          }}
        >
          <span className="eia-x-tree-chevron" aria-hidden="true">
            {node.children?.length ? (
              open.includes(node.id) ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )
            ) : null}
          </span>
          {node.icon ??
            (node.children ? <Folder size={16} /> : <FileText size={16} />)}
          <span>{node.label}</span>
          {node.count !== undefined && <EiaBadge>{node.count}</EiaBadge>}
        </div>
      ))}
    </div>
  );
}
export type EiaSplitterProps = {
  start: React.ReactNode;
  end: React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
  defaultSplit?: number;
  split?: number;
  min?: number;
  max?: number;
  onSplitChange?: (percentage: number) => void;
  label?: string;
  disabled?: boolean;
};
export function EiaSplitter({
  start,
  end,
  orientation = 'horizontal',
  defaultSplit = 40,
  split,
  min = 15,
  max = 85,
  onSplitChange,
  label = 'Redimensionar painéis',
  disabled,
}: EiaSplitterProps) {
  const firstPanel = React.useRef<PanelImperativeHandle | null>(null);
  const initial = clamp(split ?? defaultSplit, min, max);
  React.useEffect(() => {
    if (split !== undefined)
      firstPanel.current?.resize(`${clamp(split, min, max)}%`);
  }, [split, min, max]);
  return (
    <ResizablePanelGroup
      className="eia-x-splitter"
      orientation={orientation}
      disabled={disabled}
      onLayoutChanged={(layout) => onSplitChange?.(layout.start)}
    >
      <ResizablePanel
        id="start"
        panelRef={firstPanel}
        className="eia-x-split-panel"
        defaultSize={`${initial}%`}
        minSize={`${min}%`}
        maxSize={`${max}%`}
      >
        {start}
      </ResizablePanel>
      <ResizableHandle className="eia-x-split-handle" aria-label={label}>
        <GripVertical size={16} />
      </ResizableHandle>
      <ResizablePanel
        id="end"
        className="eia-x-split-panel"
        defaultSize={`${100 - initial}%`}
        minSize={`${100 - max}%`}
      >
        {end}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
export type EiaVirtualListProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T) => string;
  label: string;
  itemHeight?: number;
  height?: number;
  overscan?: number;
  onSelect?: (item: T) => void;
  selectedKey?: string;
  emptyState?: React.ReactNode;
  mode?: 'listbox' | 'list';
};
// oxlint-disable jsx-a11y/prefer-tag-over-role -- Windowed listbox needs ARIA options with absolute positioning and active-descendant keyboard focus.
export function EiaVirtualList<T>({
  items,
  renderItem,
  getKey,
  label,
  itemHeight = 56,
  height = 320,
  overscan = 4,
  onSelect,
  selectedKey,
  emptyState,
  mode = 'listbox',
}: EiaVirtualListProps<T>): React.ReactNode {
  const id = React.useId();
  const ref = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [localSelected, setLocalSelected] = React.useState('');
  const rowHeight = Math.max(24, itemHeight);
  const viewport = Math.max(rowHeight, height);
  const current = clamp(active, 0, Math.max(0, items.length - 1));
  const top = Math.min(
    scrollTop,
    Math.max(0, items.length * rowHeight - viewport),
  );
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(
    items.length,
    Math.ceil((top + viewport) / rowHeight) + overscan,
  );
  const indices = [
    ...new Set([
      ...Array.from({ length: end - start }, (_, i) => i + start),
      current,
    ]),
  ]
    .filter((index) => index < items.length)
    .sort((a, b) => a - b);
  function move(index: number) {
    const next = clamp(index, 0, items.length - 1);
    setActive(next);
    if (ref.current) {
      const topEdge = next * rowHeight;
      const bottomEdge = topEdge + rowHeight;
      if (topEdge < ref.current.scrollTop) ref.current.scrollTop = topEdge;
      else if (bottomEdge > ref.current.scrollTop + viewport)
        ref.current.scrollTop = bottomEdge - viewport;
    }
  }
  function select(index: number) {
    setActive(index);
    setLocalSelected(getKey(items[index]));
    onSelect?.(items[index]);
  }
  if (!items.length)
    return (
      emptyState ?? (
        <EiaEmpty
          title="Nenhum item para mostrar"
          description="A lista será preenchida quando houver resultados."
        />
      )
    );
  // oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Native scroll region must be focusable so keyboard users can scroll generic, nonselectable content.
  if (mode === 'list')
    return (
      <div
        ref={ref}
        className="eia-x-virtual-list"
        data-mode="list"
        role="region"
        aria-label={label}
        tabIndex={0}
        style={{ height: viewport }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ul
          style={{
            height: items.length * rowHeight,
            position: 'relative',
            margin: 0,
            padding: 0,
          }}
        >
          {indices.map((index) => (
            <li
              key={getKey(items[index])}
              className="eia-x-virtual-item"
              style={{
                top: index * rowHeight,
                height: rowHeight,
                listStyle: 'none',
              }}
              aria-posinset={index + 1}
              aria-setsize={items.length}
              onFocusCapture={() => setActive(index)}
            >
              {renderItem(items[index], index)}
            </li>
          ))}
        </ul>
      </div>
    );
  // oxlint-enable jsx-a11y/no-noninteractive-tabindex
  return (
    <div
      ref={ref}
      role="listbox"
      tabIndex={0}
      className="eia-x-virtual-list"
      aria-label={label}
      aria-activedescendant={`${id}-${current}`}
      style={{ height: viewport }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={(event) => {
        const commands: Record<string, number> = {
          ArrowDown: current + 1,
          ArrowUp: current - 1,
          Home: 0,
          End: items.length - 1,
          PageDown: current + Math.floor(viewport / rowHeight),
          PageUp: current - Math.floor(viewport / rowHeight),
        };
        if (event.key in commands) {
          event.preventDefault();
          move(commands[event.key]);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(current);
        }
      }}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {indices.map((index) => (
          <div
            id={`${id}-${index}`}
            role="option"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                select(index);
              }
            }}
            key={getKey(items[index])}
            aria-posinset={index + 1}
            aria-setsize={items.length}
            aria-selected={
              (selectedKey ?? localSelected) === getKey(items[index])
            }
            className="eia-x-virtual-item"
            data-active={current === index}
            style={{ top: index * rowHeight, height: rowHeight }}
            onClick={() => {
              select(index);
              ref.current?.focus();
            }}
          >
            {renderItem(items[index], index)}
          </div>
        ))}
      </div>
    </div>
  );
}
// oxlint-enable jsx-a11y/prefer-tag-over-role
export type EiaCarouselProps = {
  items: { id: string; content: React.ReactNode }[];
  label?: string;
  loop?: boolean;
  index?: number;
  onIndexChange?: (index: number) => void;
  showArrows?: boolean;
  showDots?: boolean;
  autoPlay?: number;
};
function CarouselControls({
  count,
  index,
  onIndexChange,
  showArrows,
  showDots,
  autoPlay,
  paused,
  onPauseChange,
  suspended,
}: Omit<EiaCarouselProps, 'items'> & {
  count: number;
  suspended: boolean;
  paused: boolean;
  onPauseChange: (paused: boolean) => void;
}) {
  const { api, scrollPrev, scrollNext, canScrollPrev, canScrollNext } =
    useCarousel();
  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!api) return () => {};
      api.on('select', notify);
      api.on('reInit', notify);
      return () => {
        api.off('select', notify);
        api.off('reInit', notify);
      };
    },
    [api],
  );
  const current = React.useSyncExternalStore(
    subscribe,
    () => api?.selectedScrollSnap() ?? 0,
    () => 0,
  );
  React.useEffect(() => {
    if (index !== undefined && api && index !== api.selectedScrollSnap())
      api.scrollTo(clamp(index, 0, count - 1));
  }, [api, index, count]);
  React.useEffect(() => {
    if (!api || !onIndexChange) return;
    const notify = () => onIndexChange(api.selectedScrollSnap());
    api.on('select', notify);
    return () => {
      api.off('select', notify);
    };
  }, [api, onIndexChange]);
  React.useEffect(() => {
    if (!api || !autoPlay || paused || suspended || count < 2) return;
    const interval = window.setInterval(
      () => {
        if (
          !document.hidden &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
          api.scrollNext();
      },
      Math.max(1500, autoPlay),
    );
    return () => window.clearInterval(interval);
  }, [api, autoPlay, paused, suspended, count]);
  return (
    <div className="eia-x-row eia-x-carousel-controls">
      {showArrows && (
        <EiaIconButton
          label="Slide anterior"
          size="sm"
          disabled={!canScrollPrev}
          onClick={scrollPrev}
        >
          <ChevronLeft />
        </EiaIconButton>
      )}
      <output aria-live={autoPlay && !paused && !suspended ? 'off' : 'polite'}>
        {count ? current + 1 : 0} de {count}
      </output>
      {showDots && (
        <div className="eia-x-row">
          {Array.from({ length: count }, (_, dot) => (
            <EiaIconButton
              key={dot}
              label={`Ir para slide ${dot + 1}`}
              size="sm"
              variant={dot === current ? 'primary' : 'ghost'}
              aria-current={dot === current ? 'true' : undefined}
              onClick={() => api?.scrollTo(dot)}
            >
              <span aria-hidden="true">•</span>
            </EiaIconButton>
          ))}
        </div>
      )}
      {showArrows && (
        <EiaIconButton
          label="Próximo slide"
          size="sm"
          disabled={!canScrollNext}
          onClick={scrollNext}
        >
          <ChevronRight />
        </EiaIconButton>
      )}
      {!!autoPlay && (
        <EiaButton
          size="sm"
          variant="ghost"
          onClick={() => onPauseChange(!paused)}
        >
          {paused ? 'Reproduzir' : 'Pausar'}
        </EiaButton>
      )}
    </div>
  );
}
export function EiaCarousel({
  items,
  label = 'Conteúdo em destaque',
  loop = false,
  index,
  onIndexChange,
  showArrows = true,
  showDots = true,
  autoPlay = 0,
}: EiaCarouselProps) {
  const [paused, setPaused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  return (
    <Carousel
      opts={{ loop }}
      className="eia-x-carousel"
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <CarouselContent>
        {items.map((item, slide) => (
          <CarouselItem
            key={item.id}
            aria-label={`${slide + 1} de ${items.length}`}
          >
            <EiaPanel className="eia-x-carousel-card">{item.content}</EiaPanel>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselControls
        count={items.length}
        index={index}
        onIndexChange={onIndexChange}
        showArrows={showArrows}
        showDots={showDots}
        autoPlay={autoPlay}
        paused={paused}
        suspended={hovered || focused}
        onPauseChange={setPaused}
      />
    </Carousel>
  );
}
export type EiaLightboxImage = {
  src: string;
  alt: string;
  caption?: string;
  downloadHref?: string;
};
export function EiaLightbox({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
  showDownload = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: EiaLightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  showDownload?: boolean;
}) {
  const current = clamp(index, 0, Math.max(0, images.length - 1));
  const item = images[current];
  const swipe = React.useRef<number | null>(null);
  function move(delta: number) {
    if (images.length)
      onIndexChange((current + delta + images.length) % images.length);
  }
  return (
    <EiaDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Galeria de imagens"
      description={item?.caption ?? item?.alt ?? 'Nenhuma imagem disponível.'}
      className="eia-x-lightbox"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      footer={
        <>
          <EiaIconButton
            label="Imagem anterior"
            disabled={images.length < 2}
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </EiaIconButton>
          <output>
            {images.length ? current + 1 : 0} / {images.length}
          </output>
          {showDownload && item && (
            <EiaLink
              href={item.downloadHref ?? item.src}
              download
              variant="secondary"
            >
              Baixar imagem <Download size={16} />
            </EiaLink>
          )}
          <EiaIconButton
            label="Próxima imagem"
            disabled={images.length < 2}
            onClick={() => move(1)}
          >
            <ChevronRight />
          </EiaIconButton>
        </>
      }
    >
      {item ? (
        <div
          className="eia-x-lightbox-stage"
          onTouchStart={(event) => {
            swipe.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            if (swipe.current === null) return;
            const delta =
              (event.changedTouches[0]?.clientX ?? swipe.current) -
              swipe.current;
            if (Math.abs(delta) > 40) move(delta > 0 ? -1 : 1);
            swipe.current = null;
          }}
        >
          <Image
            src={item.src}
            alt={item.alt}
            width={1200}
            height={800}
            unoptimized
          />
        </div>
      ) : (
        <EiaEmpty title="Nenhuma imagem disponível" />
      )}
    </EiaDialog>
  );
}
export type EiaColorSwatch = { hex: string; name: string };
const defaultPalette: EiaColorSwatch[] = [
  { hex: '#0fa968', name: 'Verde da marca' },
  { hex: '#080a09', name: 'Grafite' },
  { hex: '#929f96', name: 'Cinza' },
  { hex: '#f6f7f6', name: 'Branco' },
];
export function EiaColorPicker({
  label,
  value,
  onValueChange,
  palette = defaultPalette,
  disabled,
  allowCustom = true,
}: {
  label: string;
  value: string;
  onValueChange: (hex: string) => void;
  palette?: EiaColorSwatch[];
  disabled?: boolean;
  allowCustom?: boolean;
}) {
  const id = React.useId();
  const [draft, setDraft] = React.useState(value);
  const [previous, setPrevious] = React.useState(value);
  if (previous !== value) {
    setPrevious(value);
    setDraft(value);
  }
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  return (
    <fieldset className="eia-x-color-picker" disabled={disabled}>
      <legend>{label}</legend>
      <div className="eia-x-row">
        {palette.map((color) => (
          <button
            type="button"
            key={color.hex}
            className="eia-x-swatch"
            style={{ backgroundColor: color.hex }}
            aria-label={color.name}
            aria-pressed={value.toLowerCase() === color.hex.toLowerCase()}
            onClick={() => onValueChange(color.hex)}
          >
            <span className="eia-sr-only">{color.hex}</span>
            {value.toLowerCase() === color.hex.toLowerCase() && (
              <Check size={16} />
            )}
          </button>
        ))}
      </div>
      {allowCustom && (
        <div className="eia-x-row">
          <input
            type="color"
            aria-label={`Escolher ${label.toLowerCase()}`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#0fa968'}
            onChange={(event) => onValueChange(event.target.value)}
          />
          <EiaField
            label="Código hexadecimal"
            htmlFor={id}
            error={
              !valid ? 'Use # e seis caracteres de 0 a 9 ou A a F.' : undefined
            }
          >
            <EiaInput
              id={id}
              value={draft}
              maxLength={7}
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                if (/^#[0-9a-f]{6}$/i.test(next)) onValueChange(next);
              }}
            />
          </EiaField>
        </div>
      )}
    </fieldset>
  );
}
export type EiaDataColumn<T> = {
  key: string;
  label: React.ReactNode;
  width?: string | number;
  accessor: (row: T) => string | number | Date | null | undefined;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
};
export type EiaDataSort = { key: string; direction: 'asc' | 'desc' };
export type EiaDataTableProps<T> = {
  rows: T[];
  columns: EiaDataColumn<T>[];
  getRowId: (row: T) => string;
  label: string;
  pageSize?: number;
  selected?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onRowSelect?: (row: T) => void;
  searchText?: (row: T) => string;
  density?: 'comfortable' | 'compact';
  initialSort?: EiaDataSort | null;
  sort?: EiaDataSort | null;
  onSortChange?: (sort: EiaDataSort | null) => void;
  zebra?: boolean;
  emptyState?: React.ReactNode;
};
export function EiaDataTable<T>({
  rows,
  columns,
  getRowId,
  label,
  pageSize = 5,
  selected,
  onSelectionChange,
  onRowSelect,
  searchText,
  density = 'comfortable',
  initialSort = null,
  sort: controlledSort,
  onSortChange,
  zebra = false,
  emptyState,
}: EiaDataTableProps<T>) {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [localSort, setLocalSort] = React.useState<EiaDataSort | null>(
    initialSort,
  );
  const sort = controlledSort === undefined ? localSort : controlledSort;
  function setSort(next: EiaDataSort | null) {
    if (controlledSort === undefined) setLocalSort(next);
    onSortChange?.(next);
  }
  const [localSelection, setLocalSelection] = React.useState<string[]>([]);
  const selectedIds = selected ?? localSelection;
  const filtered = rows.filter((row) =>
    (
      searchText?.(row) ??
      columns.map((column) => column.accessor(row) ?? '').join(' ')
    )
      .toLocaleLowerCase('pt-BR')
      .includes(query.trim().toLocaleLowerCase('pt-BR')),
  );
  const sorted = [...filtered];
  const sortColumn = columns.find((column) => column.key === sort?.key);
  if (sort && sortColumn)
    sorted.sort((a, b) => {
      const first = sortColumn.accessor(a);
      const second = sortColumn.accessor(b);
      const left = first instanceof Date ? first.getTime() : (first ?? '');
      const right = second instanceof Date ? second.getTime() : (second ?? '');
      const comparison =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'pt-BR', {
              numeric: true,
            });
      return comparison * (sort.direction === 'asc' ? 1 : -1);
    });
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = clamp(page, 1, pages);
  const visible = sorted.slice((current - 1) * size, current * size);
  const allSelected =
    visible.length > 0 &&
    visible.every((row) => selectedIds.includes(getRowId(row)));
  const someSelected =
    !allSelected && visible.some((row) => selectedIds.includes(getRowId(row)));
  function changeSelection(next: string[]) {
    if (selected === undefined) setLocalSelection(next);
    onSelectionChange?.(next);
  }
  function toggleRow(row: T, checked: boolean) {
    const key = getRowId(row);
    changeSelection(
      checked
        ? [...new Set([...selectedIds, key])]
        : selectedIds.filter((id) => id !== key),
    );
  }
  return (
    <EiaPanel
      material="dense"
      className="eia-x-data-table"
      data-density={density}
      data-zebra={zebra}
    >
      <div className="eia-x-data-toolbar">
        <h3>{label}</h3>
        <EiaInput
          aria-label={`Buscar em ${label}`}
          placeholder="Buscar nesta tabela…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <EiaTable aria-label={label}>
        <EiaTableHeader>
          <EiaTableRow>
            <EiaTableHead>
              <EiaCheckbox
                className="eia-x-header-checkbox"
                label="Selecionar linhas desta página"
                aria-label={`Selecionar linhas desta página de ${label}`}
                checked={allSelected}
                indeterminate={someSelected}
                disabled={!visible.length}
                onCheckedChange={(checked) => {
                  const pageIds = visible.map(getRowId);
                  changeSelection(
                    checked
                      ? [...new Set([...selectedIds, ...pageIds])]
                      : selectedIds.filter((id) => !pageIds.includes(id)),
                  );
                }}
              />
            </EiaTableHead>
            {columns.map((column) => (
              <EiaTableHead
                key={column.key}
                style={{ textAlign: column.align, width: column.width }}
                aria-sort={
                  sort?.key === column.key
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                {column.sortable === false ? (
                  column.label
                ) : (
                  <EiaButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPage(1);
                      setSort(
                        sort?.key === column.key
                          ? sort.direction === 'asc'
                            ? { key: column.key, direction: 'desc' }
                            : null
                          : { key: column.key, direction: 'asc' },
                      );
                    }}
                    trailingIcon={<ChevronsUpDown size={14} />}
                  >
                    {column.label}
                  </EiaButton>
                )}
              </EiaTableHead>
            ))}
            {onRowSelect && <EiaTableHead>Detalhes</EiaTableHead>}
          </EiaTableRow>
        </EiaTableHeader>
        <EiaTableBody>
          {visible.map((row) => (
            <EiaTableRow
              key={getRowId(row)}
              data-selected={selectedIds.includes(getRowId(row))}
            >
              <EiaTableCell>
                <EiaCheckbox
                  label={`Selecionar registro ${getRowId(row)}`}
                  className="eia-x-row-checkbox"
                  checked={selectedIds.includes(getRowId(row))}
                  onCheckedChange={(checked) => toggleRow(row, checked)}
                />
              </EiaTableCell>
              {columns.map((column) => (
                <EiaTableCell
                  key={column.key}
                  style={{ textAlign: column.align, width: column.width }}
                >
                  {column.render
                    ? column.render(row)
                    : String(column.accessor(row) ?? '—')}
                </EiaTableCell>
              ))}
              {onRowSelect && (
                <EiaTableCell>
                  <EiaButton
                    variant="ghost"
                    size="sm"
                    onClick={() => onRowSelect(row)}
                  >
                    Abrir
                  </EiaButton>
                </EiaTableCell>
              )}
            </EiaTableRow>
          ))}
        </EiaTableBody>
      </EiaTable>
      {!visible.length &&
        (emptyState ?? (
          <EiaEmpty
            title="Nenhum registro encontrado"
            description="Altere a busca para encontrar outros registros."
            action={
              query ? (
                <EiaButton
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setPage(1);
                  }}
                >
                  Limpar busca
                </EiaButton>
              ) : undefined
            }
          />
        ))}
      <div className="eia-x-data-footer">
        <output>
          {filtered.length} {filtered.length === 1 ? 'registro' : 'registros'} ·{' '}
          {selectedIds.length}{' '}
          {selectedIds.length === 1 ? 'selecionado' : 'selecionados'}
        </output>
        <EiaPagination
          page={current}
          totalPages={pages}
          onPageChange={setPage}
        />
      </div>
    </EiaPanel>
  );
}
