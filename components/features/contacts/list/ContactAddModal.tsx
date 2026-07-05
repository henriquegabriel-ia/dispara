'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { CustomFieldDefinition, NewContactForm } from './types';

export interface ContactAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (contact: NewContactForm) => void;
  customFields: CustomFieldDefinition[];
}

const initialFormState: NewContactForm = {
  name: '',
  phone: '',
  email: '',
  tags: '',
  custom_fields: {}
};

export const ContactAddModal: React.FC<ContactAddModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  customFields
}) => {
  const [form, setForm] = useState<NewContactForm>(initialFormState);

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSubmit(form);
    setForm(initialFormState);
  };

  const updateCustomField = (key: string, value: string) => {
    setForm({
      ...form,
      custom_fields: { ...form.custom_fields, [key]: value }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-[var(--ds-border-subtle)] rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Novo Contato</h2>
          <button
            type="button"
            aria-label="Fechar formulário de novo contato"
            onClick={onClose}
          >
            <X className="text-slate-500 hover:text-white" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Nome Completo</label>
            <input
              className="w-full bg-slate-900 border border-[var(--ds-border-subtle)] rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: João Silva"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Telefone (WhatsApp) *</label>
            <input
              className="w-full bg-slate-900 border border-[var(--ds-border-subtle)] rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors"
              placeholder="+55 11 99999-9999"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">E-mail</label>
            <input
              className="w-full bg-slate-900 border border-[var(--ds-border-subtle)] rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors"
              placeholder="email@exemplo.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Tags (separadas por vírgula)</label>
            <input
              className="w-full bg-slate-900 border border-[var(--ds-border-subtle)] rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors"
              placeholder="VIP, Lead, Cliente"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <div className="pt-2 border-t border-[var(--ds-border-subtle)] mt-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Campos Personalizados
              </h3>
              <div className="space-y-3">
                {customFields.map(field => (
                  <CustomFieldInput
                    key={field.id}
                    field={field}
                    value={form.custom_fields[field.key] || ''}
                    onChange={(value) => updateCustomField(field.key, value)}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="pt-4">
            <button
              onClick={handleSubmit}
              className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-slate-200 transition-colors"
            >
              Salvar Contato
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface CustomFieldInputProps {
  field: CustomFieldDefinition;
  value: string;
  onChange: (value: string) => void;
}

const CustomFieldInput: React.FC<CustomFieldInputProps> = ({ field, value, onChange }) => {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{field.label}</label>
      {field.type === 'select' ? (
        <select
          className="w-full bg-slate-900 border border-[var(--ds-border-subtle)] rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors appearance-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione...</option>
          {field.options?.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          className="w-full bg-slate-900 border border-[var(--ds-border-subtle)] rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === 'date' ? '' : `Digite ${field.label}...`}
        />
      )}
    </div>
  );
};
