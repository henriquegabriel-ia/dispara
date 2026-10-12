'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Info,
  LoaderCircle,
  PackageOpen,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Toast,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from '@/components/ui/toast';

function classes(...values: (string | undefined | false)[]) {
  return values.filter(Boolean).join(' ');
}

function joinIds(...values: (string | undefined)[]) {
  return values.filter(Boolean).join(' ') || undefined;
}

export type EiaButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type EiaButtonSize = 'sm' | 'md' | 'lg';
export type EiaButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'variant' | 'size' | 'className' | 'children'
> & {
  variant?: EiaButtonVariant;
  size?: EiaButtonSize;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

export function EiaButton({
  variant = 'primary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: EiaButtonProps) {
  return (
    <Button
      {...props}
      type={type}
      className={classes('eia-button', className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy']}
    >
      {loading ? (
        <LoaderCircle className="eia-button-spinner" aria-hidden="true" />
      ) : (
        leadingIcon && (
          <span className="eia-button-icon" aria-hidden="true">
            {leadingIcon}
          </span>
        )
      )}
      <span className="eia-button-label">{children}</span>
      {trailingIcon && (
        <span
          className="eia-button-icon eia-button-trailing"
          aria-hidden="true"
        >
          {trailingIcon}
        </span>
      )}
    </Button>
  );
}

export type EiaIconButtonProps = EiaButtonProps & { label: string };
export function EiaIconButton({
  label,
  children,
  variant = 'ghost',
  className,
  ...props
}: EiaIconButtonProps) {
  return (
    <EiaButton
      {...props}
      variant={variant}
      className={classes('eia-icon-button', className)}
      aria-label={label}
    >
      <span aria-hidden="true">{children}</span>
    </EiaButton>
  );
}

export type EiaLinkProps = React.ComponentProps<'a'> & {
  variant?: 'default' | 'primary' | 'secondary' | 'ghost';
  size?: EiaButtonSize;
};
export function EiaLink({
  variant = 'default',
  size = 'md',
  className,
  rel,
  target,
  children,
  ...props
}: EiaLinkProps) {
  return (
    <a
      {...props}
      target={target}
      rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
      className={classes(
        'eia-link',
        variant !== 'default' && 'eia-button',
        className,
      )}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </a>
  );
}

type FieldContextValue = { id: string; describedBy?: string; invalid: boolean };
const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Stable IDs for custom controls composed with EiaField. */
export function eiaFieldIds(id: string) {
  return { description: `${id}-description`, error: `${id}-error` };
}

export type EiaInputProps = React.ComponentProps<'input'> & {
  state?: 'default' | 'success';
  controlSize?: 'sm' | 'md' | 'lg';
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
};
export function EiaInput({
  className,
  controlSize = 'md',
  state = 'default',
  leadingIcon,
  trailingIcon,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: EiaInputProps) {
  const field = React.useContext(FieldContext);
  const input = (
    <Input
      {...props}
      id={id ?? field?.id}
      aria-describedby={joinIds(describedBy, field?.describedBy)}
      aria-invalid={invalid ?? (field?.invalid || undefined)}
      className={classes('eia-input', className)}
      data-size={controlSize}
      data-state={state}
    />
  );
  return leadingIcon || trailingIcon ? (
    <span
      className="eia-input-shell"
      data-leading={!!leadingIcon || undefined}
      data-trailing={!!trailingIcon || undefined}
    >
      {leadingIcon && (
        <span className="eia-input-adornment" aria-hidden>
          {leadingIcon}
        </span>
      )}
      {input}
      {trailingIcon && (
        <span
          className="eia-input-adornment eia-input-adornment-end"
          aria-hidden
        >
          {trailingIcon}
        </span>
      )}
    </span>
  ) : (
    input
  );
}

export type EiaTextareaProps = React.ComponentProps<'textarea'>;
export function EiaTextarea({
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: EiaTextareaProps) {
  const field = React.useContext(FieldContext);
  return (
    <Textarea
      {...props}
      id={id ?? field?.id}
      aria-describedby={joinIds(describedBy, field?.describedBy)}
      aria-invalid={invalid ?? (field?.invalid || undefined)}
      className={classes('eia-input eia-textarea', className)}
    />
  );
}

export type EiaFieldProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  label: string;
  htmlFor: string;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
};
export function EiaField({
  label,
  htmlFor,
  description,
  error,
  required,
  children,
  className,
  ...props
}: EiaFieldProps) {
  const ids = eiaFieldIds(htmlFor);
  const context = {
    id: htmlFor,
    describedBy: joinIds(
      description ? ids.description : undefined,
      error ? ids.error : undefined,
    ),
    invalid: Boolean(error),
  };
  return (
    <FieldContext.Provider value={context}>
      <div
        {...props}
        className={classes('eia-field', className)}
        data-invalid={Boolean(error) || undefined}
      >
        <Label htmlFor={htmlFor} className="eia-field-label">
          {label}
          {required && (
            <span aria-hidden="true" className="eia-required">
              *
            </span>
          )}
        </Label>
        {children}
        {description && (
          <p id={ids.description} className="eia-field-description">
            {description}
          </p>
        )}
        {error && (
          <p id={ids.error} className="eia-field-error" role="alert">
            <CircleAlert size={14} aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export type EiaSelectOption = {
  value: string;
  label: React.ReactNode;
  /** Plain text for keyboard lookup when a rich label needs another reading. */
  textValue?: string;
  disabled?: boolean;
};
export type EiaSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: EiaSelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  size?: 'sm' | 'md';
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
};
export function EiaSelect({
  value,
  onValueChange,
  options,
  label,
  placeholder = 'Selecione uma opção',
  disabled,
  className,
  id,
  name,
  required,
  size = 'md',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: EiaSelectProps) {
  const generatedId = React.useId();
  const field = React.useContext(FieldContext);
  const controlId = id ?? field?.id ?? generatedId;
  return (
    <div className={classes('eia-field', className)}>
      {!field && (
        <Label htmlFor={controlId} className="eia-field-label">
          {label}
        </Label>
      )}
      <Select
        value={value === '' ? null : value}
        onValueChange={(next) => onValueChange(next ?? '')}
        items={options}
        disabled={disabled}
        name={name}
        required={required}
      >
        <SelectTrigger
          id={controlId}
          className="eia-select-trigger"
          data-size={size}
          aria-label={label}
          aria-describedby={joinIds(describedBy, field?.describedBy)}
          aria-invalid={invalid ?? (field?.invalid || undefined)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          className="eia-theme eia-popup eia-select-popup"
          align="start"
          alignItemWithTrigger={false}
          sideOffset={8}
        >
          {options.map((option) => (
            <SelectItem
              className="eia-option"
              value={option.value}
              disabled={option.disabled}
              key={option.value}
              label={option.textValue}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export type EiaCheckboxProps = Omit<
  React.ComponentProps<typeof Checkbox>,
  'checked' | 'onCheckedChange' | 'className'
> & {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
  className?: string;
};
export function EiaCheckbox({
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
  id,
  className,
  'aria-describedby': describedBy,
  ...props
}: EiaCheckboxProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  return (
    <div
      className={classes('eia-choice', className)}
      data-disabled={disabled || undefined}
    >
      <Checkbox
        {...props}
        id={controlId}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        aria-describedby={joinIds(
          describedBy,
          description ? `${controlId}-description` : undefined,
        )}
        className="eia-checkbox"
      />
      <div className="eia-choice-copy">
        <Label className="eia-choice-label" htmlFor={controlId}>
          {label}
        </Label>
        {description && (
          <p className="eia-field-description" id={`${controlId}-description`}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export type EiaRadioOption = EiaSelectOption & {
  description?: React.ReactNode;
};
export type EiaRadioGroupProps = Omit<
  React.ComponentProps<typeof RadioGroup>,
  'value' | 'onValueChange' | 'className' | 'children'
> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: EiaRadioOption[];
  className?: string;
};
export function EiaRadioGroup({
  label,
  value,
  onValueChange,
  options,
  disabled,
  className,
  ...props
}: EiaRadioGroupProps) {
  const id = React.useId();
  return (
    <div className={classes('eia-field', className)}>
      <span id={`${id}-label`} className="eia-field-label">
        {label}
      </span>
      <RadioGroup
        {...props}
        value={value}
        onValueChange={(next) => onValueChange(String(next))}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        className="eia-radio-group"
      >
        {options.map((option, index) => {
          const optionId = `${id}-${index}`;
          return (
            <div
              className="eia-choice eia-radio-option"
              data-disabled={disabled || option.disabled || undefined}
              key={option.value}
            >
              <RadioGroupItem
                className="eia-radio"
                value={option.value}
                disabled={option.disabled}
                id={optionId}
                aria-describedby={
                  option.description ? `${optionId}-description` : undefined
                }
              />
              <div className="eia-choice-copy">
                <Label className="eia-choice-label" htmlFor={optionId}>
                  {option.label}
                </Label>
                {option.description && (
                  <p
                    className="eia-field-description"
                    id={`${optionId}-description`}
                  >
                    {option.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}

export type EiaSwitchProps = Omit<
  React.ComponentProps<typeof Switch>,
  'checked' | 'onCheckedChange' | 'className'
> & {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
  className?: string;
};
export function EiaSwitch({
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
  id,
  className,
  'aria-describedby': describedBy,
  ...props
}: EiaSwitchProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  return (
    <div
      className={classes('eia-choice eia-switch-row', className)}
      data-disabled={disabled || undefined}
    >
      <div className="eia-choice-copy">
        <Label className="eia-choice-label" htmlFor={controlId}>
          {label}
        </Label>
        {description && (
          <p className="eia-field-description" id={`${controlId}-description`}>
            {description}
          </p>
        )}
      </div>
      <Switch
        {...props}
        className="eia-switch"
        id={controlId}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        aria-describedby={joinIds(
          describedBy,
          description ? `${controlId}-description` : undefined,
        )}
      />
    </div>
  );
}

export type EiaPanelProps<
  Element extends 'div' | 'section' | 'article' = 'div',
> = React.ComponentProps<Element> & {
  material?: 'hero' | 'panel' | 'dense';
  as?: Element;
  hoverable?: boolean;
  noPadding?: boolean;
};
export function EiaPanel<
  Element extends 'div' | 'section' | 'article' = 'div',
>({
  material = 'panel',
  as,
  className,
  hoverable = false,
  noPadding = false,
  ...props
}: EiaPanelProps<Element>) {
  return React.createElement(as ?? 'div', {
    ...props,
    className: classes('eia-panel', className),
    'data-material': material,
    'data-hoverable': hoverable || undefined,
    'data-no-padding': noPadding || undefined,
  });
}

export type EiaBadgeProps = React.ComponentProps<'span'> & {
  size?: 'sm' | 'md';
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
};
export function EiaBadge({
  tone = 'neutral',
  size = 'md',
  className,
  ...props
}: EiaBadgeProps) {
  return (
    <span
      {...props}
      className={classes('eia-badge', className)}
      data-tone={tone}
      data-size={size}
    />
  );
}

export type EiaTab = {
  value: string;
  label: string;
  badge?: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
  keepMounted?: boolean;
};
export type EiaTabsProps = Omit<
  React.ComponentProps<typeof Tabs>,
  'value' | 'onValueChange' | 'children' | 'className'
> & {
  value: string;
  onValueChange: (value: string) => void;
  tabs: EiaTab[];
  label: string;
  variant?: 'pills' | 'underline';
  className?: string;
};
export function EiaTabs({
  value,
  onValueChange,
  tabs,
  label,
  variant = 'pills',
  className,
  ...props
}: EiaTabsProps) {
  return (
    <Tabs
      {...props}
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      className={classes('eia-tabs', className)}
      data-variant={variant}
    >
      <TabsList className="eia-tabs-list" aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className="eia-tab"
          >
            {tab.label}
            {tab.badge != null && (
              <span className="eia-tab-badge">{tab.badge}</span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="eia-tab-content"
          keepMounted={tab.keepMounted}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export type EiaMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  shortcut?: string;
};
export type EiaMenuGroup = { id: string; label?: string; items: EiaMenuItem[] };
export type EiaMenuProps = {
  label: string;
  items?: EiaMenuItem[];
  groups?: EiaMenuGroup[];
  trigger?: React.ReactElement;
  align?: 'start' | 'end';
  disabled?: boolean;
  className?: string;
};
export function EiaMenu({
  label,
  items = [],
  groups,
  trigger,
  align = 'end',
  disabled,
  className,
}: EiaMenuProps) {
  const resolved = groups ?? [{ id: 'actions', items }];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={label}
        render={
          trigger ?? (
            <EiaButton
              variant="secondary"
              className={className}
              trailingIcon={<ChevronDown />}
            />
          )
        }
      >
        {trigger ? undefined : label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="eia-theme eia-popup eia-menu-popup"
        align={align}
        sideOffset={8}
        aria-label={label}
      >
        {resolved.map((group, groupIndex) => (
          <React.Fragment key={group.id}>
            {groupIndex > 0 && (
              <DropdownMenuSeparator className="eia-menu-separator" />
            )}
            <DropdownMenuGroup>
              {group.label && (
                <DropdownMenuLabel className="eia-menu-label">
                  {group.label}
                </DropdownMenuLabel>
              )}
              {group.items.map((item, index) => (
                <DropdownMenuItem
                  className="eia-option"
                  key={`${item.label}-${index}`}
                  disabled={item.disabled}
                  variant={item.danger ? 'destructive' : 'default'}
                  onClick={item.onSelect}
                >
                  {item.icon && (
                    <span className="eia-menu-icon" aria-hidden>
                      {item.icon}
                    </span>
                  )}
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <kbd className="eia-menu-shortcut">{item.shortcut}</kbd>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type EiaTableProps = React.ComponentProps<typeof Table>;
export function EiaTable({ className, ...props }: EiaTableProps) {
  return <Table {...props} className={classes('eia-table', className)} />;
}
export type EiaTableHeaderProps = React.ComponentProps<typeof TableHeader>;
export function EiaTableHeader({ className, ...props }: EiaTableHeaderProps) {
  return (
    <TableHeader
      {...props}
      className={classes('eia-table-header', className)}
    />
  );
}
export type EiaTableBodyProps = React.ComponentProps<typeof TableBody>;
export function EiaTableBody({ className, ...props }: EiaTableBodyProps) {
  return (
    <TableBody {...props} className={classes('eia-table-body', className)} />
  );
}
export type EiaTableRowProps = React.ComponentProps<typeof TableRow>;
export function EiaTableRow({ className, ...props }: EiaTableRowProps) {
  return (
    <TableRow {...props} className={classes('eia-table-row', className)} />
  );
}
export type EiaTableHeadProps = React.ComponentProps<typeof TableHead>;
export function EiaTableHead({
  className,
  scope = 'col',
  ...props
}: EiaTableHeadProps) {
  return (
    <TableHead
      {...props}
      scope={scope}
      className={classes('eia-table-head', className)}
    />
  );
}
export type EiaTableCellProps = React.ComponentProps<typeof TableCell>;
export function EiaTableCell({ className, ...props }: EiaTableCellProps) {
  return (
    <TableCell {...props} className={classes('eia-table-cell', className)} />
  );
}
export type EiaTableCaptionProps = React.ComponentProps<typeof TableCaption>;
export function EiaTableCaption({ className, ...props }: EiaTableCaptionProps) {
  return (
    <TableCaption
      {...props}
      className={classes('eia-table-caption', className)}
    />
  );
}

export type EiaDialogProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Popup>,
  'title' | 'children' | 'className'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  hideClose?: boolean;
  scrim?: boolean;
};
function EiaOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  drawer = false,
  side = 'right',
  size = 'md',
  hideClose = false,
  scrim = true,
  ...props
}: EiaDialogProps & { drawer?: boolean; side?: 'left' | 'right' | 'bottom' }) {
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPortal className="eia-theme eia-overlay-portal">
        <DialogOverlay
          className="eia-overlay-scrim"
          data-transparent={!scrim || undefined}
        />
        <DialogPrimitive.Popup
          {...props}
          data-size={size}
          data-side={drawer ? side : undefined}
          className={classes(
            'eia-overlay',
            drawer ? 'eia-drawer' : 'eia-dialog',
            className,
          )}
        >
          <header className="eia-overlay-header">
            <span className="eia-overlay-kicker">
              EMPREENDER COM INTELIGÊNCIA
            </span>
            <DialogTitle className="eia-overlay-title">{title}</DialogTitle>
            {description && (
              <DialogDescription className="eia-overlay-description">
                {description}
              </DialogDescription>
            )}
          </header>
          {!hideClose && (
            <DialogClose
              render={
                <EiaIconButton
                  label={drawer ? 'Fechar painel' : 'Fechar janela'}
                  className="eia-overlay-close"
                />
              }
            >
              <X aria-hidden="true" />
            </DialogClose>
          )}
          <div className="eia-overlay-body">{children}</div>
          {footer && <footer className="eia-overlay-footer">{footer}</footer>}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
export function EiaDialog(props: EiaDialogProps) {
  return <EiaOverlay {...props} />;
}
export type EiaDrawerProps = EiaDialogProps & {
  side?: 'left' | 'right' | 'bottom';
};
export function EiaDrawer(props: EiaDrawerProps) {
  return <EiaOverlay {...props} drawer />;
}

export type EiaAlertTone = 'info' | 'success' | 'warning' | 'danger';
const toneIcons = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
  danger: CircleAlert,
};
export type EiaAlertProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  tone?: EiaAlertTone;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  size?: 'compact' | 'banner';
};
export function EiaAlert({
  tone = 'info',
  title,
  children,
  className,
  role,
  icon,
  action,
  onDismiss,
  dismissLabel = 'Fechar alerta',
  size = 'banner',
  ...props
}: EiaAlertProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      {...props}
      className={classes('eia-alert', className)}
      data-tone={tone}
      data-size={size}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
    >
      <span className="eia-feedback-icon" aria-hidden="true">
        {icon ?? <Icon />}
      </span>
      <div className="eia-alert-copy">
        {title != null && <p className="eia-feedback-title">{title}</p>}
        {children && <div className="eia-feedback-description">{children}</div>}
      </div>
      {action && <div className="eia-alert-action">{action}</div>}
      {onDismiss && (
        <EiaIconButton
          className="eia-alert-close"
          label={dismissLabel}
          onClick={onDismiss}
          size="sm"
        >
          <X size={16} />
        </EiaIconButton>
      )}
    </div>
  );
}

export type EiaToastProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  tone?: 'success' | 'danger' | 'info';
  duration?: number;
};
function EiaToastBridge({
  open,
  onOpenChange,
  title,
  description,
  tone = 'success',
  duration = 6000,
}: EiaToastProps) {
  const { toasts, add, close } = useToastManager();
  const wasOpen = React.useRef(false);
  const activeId = React.useRef<string | null>(null);
  const changeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    changeRef.current = onOpenChange;
  }, [onOpenChange]);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      activeId.current = add({
        title,
        description,
        type: tone,
        timeout: duration,
        priority: tone === 'danger' ? 'high' : 'low',
        onClose: () => changeRef.current(false),
      });
    } else if (!open && wasOpen.current && activeId.current) {
      close(activeId.current);
      activeId.current = null;
    }
    wasOpen.current = open;
  }, [open, title, description, tone, duration, add, close]);
  return (
    <ToastPortal>
      <ToastViewport
        className="eia-theme eia-toast-viewport"
        aria-label="Notificações"
      >
        {toasts.map((item) => {
          const Icon =
            toneIcons[(item.type as EiaToastProps['tone']) ?? 'info'];
          return (
            <Toast
              key={item.id}
              toast={item}
              className="eia-toast"
              data-tone={item.type}
            >
              <ToastContent className="eia-toast-content">
                <Icon className="eia-feedback-icon" aria-hidden="true" />
                <div className="eia-toast-copy">
                  <ToastTitle className="eia-feedback-title" />
                  <ToastDescription className="eia-feedback-description" />
                </div>
                <ToastClose
                  aria-label="Fechar notificação"
                  render={
                    <EiaIconButton label="Fechar notificação" size="sm" />
                  }
                />
              </ToastContent>
            </Toast>
          );
        })}
      </ToastViewport>
    </ToastPortal>
  );
}
export function EiaToast(props: EiaToastProps) {
  return (
    <ToastProvider limit={1}>
      <EiaToastBridge {...props} />
    </ToastProvider>
  );
}

export type EiaEmptyProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
};
export function EiaEmpty({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: EiaEmptyProps) {
  return (
    <div {...props} className={classes('eia-empty', className)}>
      <span className="eia-empty-icon" aria-hidden="true">
        {icon ?? <PackageOpen />}
      </span>
      <p className="eia-empty-title">{title}</p>
      {description && <p className="eia-empty-description">{description}</p>}
      {action && <div className="eia-empty-action">{action}</div>}
    </div>
  );
}

export type EiaSkeletonProps = React.ComponentProps<'div'> & {
  label?: string;
  variant?: 'text' | 'circle' | 'rect';
  lines?: number;
  width?: React.CSSProperties['width'];
  height?: React.CSSProperties['height'];
};
export function EiaSkeleton({
  label,
  className,
  children,
  variant = 'rect',
  lines = 1,
  width,
  height,
  style,
  ...props
}: EiaSkeletonProps) {
  const count = Math.max(1, Math.min(50, Math.floor(lines)));
  if (count > 1)
    return (
      <div
        {...props}
        className="eia-skeleton-lines"
        role={label ? 'status' : undefined}
        aria-hidden={label ? undefined : true}
      >
        {label && <span className="eia-sr-only">{label}</span>}
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={classes('eia-skeleton', className)}
            data-variant={variant}
            style={{ width: i === count - 1 ? '70%' : width, height, ...style }}
          />
        ))}
      </div>
    );
  return (
    <div
      {...props}
      className={classes('eia-skeleton', className)}
      data-variant={variant}
      style={{ width, height, ...style }}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label && <span className="eia-sr-only">{label}</span>}
      {children}
    </div>
  );
}
export type EiaSpinnerProps = React.ComponentProps<'output'> & {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'accent' | 'danger';
};
export function EiaSpinner({
  label = 'Carregando',
  className,
  size = 'md',
  tone = 'accent',
  ...props
}: EiaSpinnerProps) {
  return (
    <output
      {...props}
      className={classes('eia-spinner', className)}
      data-size={size}
      data-tone={tone}
    >
      <LoaderCircle aria-hidden="true" />
      <span className="eia-sr-only">{label}</span>
    </output>
  );
}
export type EiaProgressProps = React.ComponentProps<'div'> & {
  value: number;
  label: string;
  showValue?: boolean;
  tone?: 'neutral' | 'accent' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};
export function EiaProgress({
  value,
  label,
  className,
  showValue = true,
  tone = 'accent',
  size = 'md',
  ...props
}: EiaProgressProps) {
  const progress = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  return (
    <div
      {...props}
      className={classes('eia-progress', className)}
      data-tone={tone}
      data-size={size}
    >
      <div className="eia-progress-label">
        <span>{label}</span>
        {showValue && <span>{Math.round(progress)}%</span>}
      </div>
      <progress
        className="eia-progress-track"
        aria-label={label}
        value={progress}
        max={100}
      >
        {Math.round(progress)}%
      </progress>
    </div>
  );
}

export type EiaToastItem = {
  id: string;
  title: string;
  description?: string;
  tone?: EiaAlertTone;
  duration?: number;
  action?: { label: string; onClick: () => void };
};
export type EiaToastStackProps = {
  toasts: EiaToastItem[];
  onDismiss: (id: string) => void;
  position?: 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';
};
function EiaStackItem({
  item,
  onDismiss,
}: {
  item: EiaToastItem;
  onDismiss: (id: string) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const paused = hovered || focused;
  const dismiss = React.useRef(onDismiss);
  React.useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);
  React.useEffect(() => {
    if (paused || item.duration === 0) return;
    const timer = setTimeout(
      () => dismiss.current(item.id),
      item.duration ?? 6000,
    );
    return () => clearTimeout(timer);
  }, [item.id, item.duration, paused]);
  return (
    <div
      className="eia-stack-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false);
      }}
    >
      <EiaAlert tone={item.tone ?? 'info'} title={item.title}>
        {item.description}
        {item.action && (
          <EiaButton
            variant="secondary"
            size="sm"
            onClick={item.action.onClick}
          >
            {item.action.label}
          </EiaButton>
        )}
      </EiaAlert>
      <EiaIconButton
        className="eia-stack-close"
        label={`Fechar notificação: ${item.title}`}
        size="sm"
        onClick={() => onDismiss(item.id)}
      >
        <X />
      </EiaIconButton>
    </div>
  );
}
/** Declarative notification stack. Duration 0 is persistent; hover/focus pauses dismissal. */
function subscribeToClient() {
  return () => undefined;
}
export function EiaToastStack({
  toasts,
  onDismiss,
  position = 'top-right',
}: EiaToastStackProps) {
  const mounted = React.useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <section
      className="eia-theme eia-toast-stack"
      data-position={position}
      aria-label="Notificações empilhadas"
    >
      {toasts.map((item) => (
        <EiaStackItem key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </section>,
    document.body,
  );
}
export function useEiaToasts() {
  const prefix = React.useId();
  const sequence = React.useRef(0);
  const [toasts, setToasts] = React.useState<EiaToastItem[]>([]);
  const push = React.useCallback(
    (item: Omit<EiaToastItem, 'id'>) => {
      const id = `${prefix}-${++sequence.current}`;
      setToasts((current) => [...current, { ...item, id }]);
      return id;
    },
    [prefix],
  );
  const dismiss = React.useCallback(
    (id: string) =>
      setToasts((current) => current.filter((item) => item.id !== id)),
    [],
  );
  const clear = React.useCallback(() => setToasts([]), []);
  return { toasts, push, dismiss, clear };
}
