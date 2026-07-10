# Graph Report - .  (2026-07-09)

## Corpus Check
- Large corpus: 1155 files · ~781,565 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 6601 nodes · 16973 edges · 310 communities (274 shown, 36 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 154 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- shadcn/ui Primitives
- Meta Diagnostics & Flow Preview
- Form Dialogs & Buttons
- Page Layout Patterns
- Inbox & Conversations
- Send Flow & Layout Primitives
- API & Domain Types
- AI / RAG Engine
- Manual Template Builder
- AI SDK Dependencies
- Template Management
- API Validation & Auth
- Workflow DB Layer
- Suppressions & DB Helpers
- Campaign Details View
- Template Projects & Submissions
- Campaign & Contact Lists
- Conversation UI
- Campaign Wizard Logic
- Campaign Service & Dashboard
- Calendar & Health Business Logic
- Wizard: Review & Launch
- AI Agent Form & Inputs
- Contacts & WhatsApp Pricing
- AI Agents & Knowledge Base
- Google Calendar Integration
- WhatsApp Credentials & HTTP
- OpenAPI Spec & DB Schema
- Supabase Realtime Hooks
- Settings API & DB
- Calendar Booking
- Campaign Wizard View
- Contact Management
- Quick Replies & Attendants
- Campaign Query Hooks
- Onboarding & Webhook Setup
- WhatsApp Flow Endpoints
- WhatsApp Status Webhooks
- Flow Form Builder
- Builder Plugins & Credentials
- Storage Validation
- Dashboard Page Chrome
- Meta Account Limits
- Template Service (Meta Payload)
- Template Contract & Prechecks
- Phone Normalization (BR)
- Template Selection Hooks
- Self-Install Wizard (Supabase/Vercel)
- Flow Builder Steps
- Dynamic Flow Engine
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237
- Community 238
- Community 239
- Community 240
- Community 241
- Community 242
- Community 243
- Community 244
- Community 245
- Community 246
- Community 247
- Community 248
- Community 249
- Community 250
- Community 251
- Community 252
- Community 253
- Community 254
- Community 255
- Community 256
- Community 257
- Community 258
- Community 259
- Community 260
- Community 261
- Community 262
- Community 263
- Community 264
- Community 265
- Community 266
- Community 267
- Community 268
- Community 269
- Community 270
- Community 271
- Community 272
- Community 273
- Community 274
- Community 275
- Community 276
- Community 277
- Community 278
- Community 279
- Community 281
- Community 282
- Community 290
- Community 292
- Community 293
- Community 294
- Community 295
- Community 296
- Community 297
- Community 300
- Community 301
- Community 302
- Community 303
- Community 304
- Community 305
- Community 306
- Community 307
- Community 308

## God Nodes (most connected - your core abstractions)
1. `cn()` - 340 edges
2. `getSupabaseAdmin()` - 117 edges
3. `Button` - 105 edges
4. `getWhatsAppCredentials()` - 88 edges
5. `isSupabaseConfigured()` - 87 edges
6. `supabase` - 72 edges
7. `normalizePhoneNumber()` - 69 edges
8. `fetchWithTimeout()` - 69 edges
9. `Container()` - 57 edges
10. `Template` - 56 edges

## Surprising Connections (you probably didn't know these)
- `Stack (Next.js 16, React 19, Supabase, Upstash QStash/Workflow, Meta Cloud API v24.0, Vercel AI SDK v6)` --semantically_similar_to--> `pg_cron background clock`  [INFERRED] [semantically similar]
  README.md → CLAUDE.md
- `StatCard()` --calls--> `cn()`  [EXTRACTED]
  app/(dashboard)/templates/[id]/page.tsx → lib/utils.ts
- `GET()` --calls--> `getSupabaseAdmin()`  [EXTRACTED]
  app/api/ai-agents/embedding-providers/route.ts → lib/supabase.ts
- `GET()` --calls--> `getSupabaseAdmin()`  [EXTRACTED]
  app/api/ai-agents/llm-providers/route.ts → lib/supabase.ts
- `GET()` --calls--> `getSupabaseAdmin()`  [EXTRACTED]
  app/api/builder/workflows/[workflowId]/executions/route.ts → lib/supabase.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI Test Pipeline (type check + unit tests)** — _github_workflows_test_tests_job, _github_workflows_test_type_check, _github_workflows_test_unit_tests [EXTRACTED 0.90]
- **pg_cron background clock dispatch flow** — claude_pg_cron_clock, claude_dispara_cron_tick, claude_backend_pattern, claude_workflow_engine [EXTRACTED 0.85]
- **Wizard onboarding provisioning flow** — supabase_migrations_wizard_guide_wizard_flow, supabase_migrations_wizard_guide_init_sql, supabase_migrations_wizard_guide_schema_validator, supabase_migrations_wizard_guide_storage_bucket, supabase_migrations_wizard_guide_default_ai_agent [EXTRACTED 0.85]

## Communities (310 total, 36 thin omitted)

### Community 0 - "shadcn/ui Primitives"
Cohesion: 0.03
Nodes (87): ColorsSection(), ColorSwatch(), CopyButton(), DesignSystemLightPage(), ShadowsSection(), TypographySection(), ColorsSection(), ColorSwatch() (+79 more)

### Community 1 - "Meta Diagnostics & Flow Preview"
Cohesion: 0.06
Nodes (80): MetaDiagnosticsPage(), ActionButtons(), ActionButtonsProps, QuickStartCard(), QuickStartCardProps, Simulate10033Card(), TokenScopesCard(), TokenScopesCardProps (+72 more)

### Community 2 - "Form Dialogs & Buttons"
Cohesion: 0.07
Nodes (57): PermissionValidationResult, ContactBulkTagsModalProps, CreateFlowFromTemplateDialog(), FlowJsonEditorPanel(), safeStringify(), LeadFormsView(), CreateFormDialog(), CreateFormDialogProps (+49 more)

### Community 3 - "Page Layout Patterns"
Cohesion: 0.04
Nodes (84): ActionButtonProps, ActionGroup(), ActionGroupProps, DestructiveAction(), HighlightAction(), IconAction(), IconActionProps, iconVariantStyles (+76 more)

### Community 4 - "Inbox & Conversations"
Cohesion: 0.04
Nodes (61): InboxInitialData, AIAgentForm, InboxConversationPageContent(), InboxConversationPageProps, AIAgentForm, InboxClientWrapper(), InboxClientWrapperProps, ConversationHeaderProps (+53 more)

### Community 5 - "Send Flow & Layout Primitives"
Cohesion: 0.07
Nodes (61): CreateFlowWithAIDialog, FlowBuilderListView(), formatDateTime(), FlowSubmissionsView(), formatDateTime(), safePrettyJson(), AddButtonDropdown(), AddButtonDropdownProps (+53 more)

### Community 6 - "API & Domain Types"
Cohesion: 0.04
Nodes (86): ApiError, BaseFilterParams, BulkOperationResult, ChannelStatus, ChartDataPoint, CountResponse, CreateResponse, DashboardStats (+78 more)

### Community 7 - "AI / RAG Engine"
Cohesion: 0.05
Nodes (67): EMBEDDING_API_KEY_MAP, GET(), baseResponseSchema, chatRequestSchema, ChatResponse, ChatSession, cleanOldSessions(), EMBEDDING_API_KEY_MAP (+59 more)

### Community 8 - "Manual Template Builder"
Cohesion: 0.06
Nodes (65): FloatingPreviewButton(), FloatingPreviewButtonProps, HeaderFormat, HeaderMediaPreview, PreviewDrawer(), PreviewDrawerProps, Spec, StepButtons() (+57 more)

### Community 9 - "AI SDK Dependencies"
Cohesion: 0.03
Nodes (75): dependencies, ai, @ai-sdk/anthropic, @ai-sdk/cohere, @ai-sdk/devtools, @ai-sdk/google, @ai-sdk/openai, @ai-sdk/react (+67 more)

### Community 10 - "Template Management"
Cohesion: 0.06
Nodes (52): StepTemplateConfigProps, BulkGenerationModalProps, BulkDeleteDraftsModal(), BulkDeleteDraftsModalProps, BulkDeleteModal(), BulkDeleteModalProps, DeleteConfirmModal(), DeleteConfirmModalProps (+44 more)

### Community 11 - "API Validation & Auth"
Cohesion: 0.07
Nodes (50): POST(), CreateCampaignBody, POST(), POST(), BulkUpdateStatusSchema, POST(), BulkUpdateTagsSchema, POST() (+42 more)

### Community 12 - "Workflow DB Layer"
Cohesion: 0.08
Nodes (55): POST(), POST(), POST(), GET(), POST(), GET(), RouteParams, GET() (+47 more)

### Community 13 - "Suppressions & DB Helpers"
Cohesion: 0.04
Nodes (28): Params, patchSchema, postSchema, Params, Params, postSchema, buildEndpointUrl(), GET() (+20 more)

### Community 14 - "Campaign Details View"
Cohesion: 0.08
Nodes (52): CampaignDetailsView(), TemplatePreviewModal, CampaignTracePanel(), fmtIso(), fmtMs(), TraceEventRow, TraceListItem, CampaignABReport() (+44 more)

### Community 15 - "Template Projects & Submissions"
Cohesion: 0.04
Nodes (47): RouteParams, Params, BatchSubmissionListProps, StatCardProps, SubmissionDetailViewProps, WhatsAppPhonePreview(), useTemplateProjectDetailsQuery(), useTemplateProjectsQuery() (+39 more)

### Community 16 - "Campaign & Contact Lists"
Cohesion: 0.06
Nodes (51): CampaignCard, CampaignCardList, CampaignCardListProps, getCampaignBadgeStatus(), STATUS_LABELS, StatusBadge(), calcSendDuration(), CampaignListView() (+43 more)

### Community 17 - "Conversation UI"
Cohesion: 0.06
Nodes (41): AtendimentoPage(), ConversationItem(), FilterTab, formatWaitTime(), TAB_COLORS, AttendantsPage(), createAttendant(), CreateAttendantForm() (+33 more)

### Community 18 - "Campaign Wizard Logic"
Cohesion: 0.08
Nodes (49): AudienceAction, audienceReducer(), AudienceState, initialAudienceState, initialSchedulingState, initialWizardState, SchedulingAction, schedulingReducer() (+41 more)

### Community 19 - "Campaign Service & Dashboard"
Cohesion: 0.06
Nodes (38): getDashboardData, getCampaignsInitialData, CampaignsWithData(), DashboardClientLoader(), DashboardClientWrapper(), DEFAULT_STATS, DashboardWithData(), CampaignCardProps (+30 more)

### Community 20 - "Calendar & Health Business Logic"
Cohesion: 0.09
Nodes (52): CalendarConfig, CalendarValidationResult, countSlotsInDay(), DEFAULT_WORKING_HOURS, getAvailableSlots(), getAvailableSlotsForDate(), getWorkingHoursForDate(), isWithinWorkingHours() (+44 more)

### Community 21 - "Wizard: Review & Launch"
Cohesion: 0.10
Nodes (45): TestContactCardProps, CampaignDetails(), CampaignDetailsProps, ContactQuickEditWrapper(), ContactQuickEditWrapperProps, FinalCheckWarning(), FixedValueDialog(), FixedValueDialogProps (+37 more)

### Community 22 - "AI Agent Form & Inputs"
Cohesion: 0.07
Nodes (39): CustomFieldItem, CustomFieldsManager(), CustomFieldsSheet(), MappingView, GROUP_LABELS, TUTORIALS, buttonVariants, Calendar() (+31 more)

### Community 23 - "Contacts & WhatsApp Pricing"
Cohesion: 0.09
Nodes (40): AudienceCardAll(), AudienceCardSegments(), ContactSelectionList(), LegacyAudienceMode(), LegacyAudienceModeProps, RefineSheet(), SegmentsSheet(), TestContactCard() (+32 more)

### Community 24 - "AI Agents & Knowledge Base"
Cohesion: 0.09
Nodes (36): PublicLeadForm, ContactMemoriesSheet(), ContactMemoriesSheetProps, Memory, Profile, FormListProps, AIAgentCardProps, AIAgentCompactCardProps (+28 more)

### Community 25 - "Google Calendar Integration"
Cohesion: 0.09
Nodes (42): GET(), GET(), POST(), GET(), normalizeReturnTo(), POST(), buildDefaultCalendarConfig(), buildGoogleCalendarAuthUrl() (+34 more)

### Community 26 - "WhatsApp Credentials & HTTP"
Cohesion: 0.09
Nodes (30): GET(), POST(), findTestTemplate(), POST(), TemplateInfo, maskId(), normalizeErrorPayload(), POST() (+22 more)

### Community 27 - "OpenAPI Spec & DB Schema"
Cohesion: 0.05
Nodes (48): Backend Pattern: Serverless + pg_cron (campaign_contacts fila, CAS claim), Database Schema (key tables: settings, campaigns, campaign_contacts, contacts, templates, flows), Dispara (SaaS single-tenant WhatsApp API Oficial), dispara_cron_tick() -> POST /api/cron/tick, Frontend Pattern: Page -> Hook -> Service -> API, Meta WhatsApp Cloud API v24.0 integration, pg_cron background clock, Phone Number Handling (E.164, libphonenumber-js) (+40 more)

### Community 28 - "Supabase Realtime Hooks"
Cohesion: 0.11
Nodes (40): CentralizedRealtimeContext, CentralizedRealtimeContextValue, CentralizedRealtimeProvider(), CentralizedRealtimeProviderProps, RealtimeEvent, RealtimeEventType, SubscriptionCallback, useCentralizedRealtime() (+32 more)

### Community 29 - "Settings API & DB"
Cohesion: 0.06
Nodes (25): GET(), RouteParams, POST(), RouteParams, POST(), RouteParams, GET(), RouteParams (+17 more)

### Community 30 - "Calendar Booking"
Cohesion: 0.10
Nodes (34): BookingConfigSection(), BookingFlowConfig, BookingFlowSection(), FlowOption, CalendarStatusSection(), CalendarWizardModal(), BookingConfigSectionProps, CalendarStatusSectionProps (+26 more)

### Community 31 - "Campaign Wizard View"
Cohesion: 0.10
Nodes (34): CampaignWizardView(), CampaignWizardViewProps, StepAudienceSelection, StepReviewLaunch, StepTemplateConfig, WizardHeader(), WizardNavigation(), WizardNavigationProps (+26 more)

### Community 32 - "Contact Management"
Cohesion: 0.10
Nodes (35): ContactImportModal, ContactListViewProps, ContactAddModal(), ContactAddModalProps, CustomFieldInputProps, initialFormState, ContactBulkStatusModal(), ContactBulkStatusModalProps (+27 more)

### Community 33 - "Quick Replies & Attendants"
Cohesion: 0.10
Nodes (32): AttendantRow(), AttendantsPopover(), createAttendant(), CreateForm(), deleteAttendant(), fetchAttendants(), ConversationHeader(), ConversationItem (+24 more)

### Community 34 - "Campaign Query Hooks"
Cohesion: 0.07
Nodes (36): queryClient, CampaignsClientWrapper(), OrganizationModals(), CampaignsQueryData, removeCampaignFromCache(), mockCampaigns, mockDelete, mockDuplicate (+28 more)

### Community 35 - "Onboarding & Webhook Setup"
Cohesion: 0.08
Nodes (31): OnboardingCredentials, TUTORIAL_STEPS, TutorialWizard(), AddWhatsAppStep(), AddWhatsAppStepProps, ConfigureWebhookStep(), ConfigureWebhookStepProps, SubStep (+23 more)

### Community 36 - "WhatsApp Flow Endpoints"
Cohesion: 0.10
Nodes (40): GoogleCalendarConfig, createSuccessResponse(), AvailableDateOption, BookingRuntimeKeys, CalendarBookingConfig, CalendarPickerData, collectComponents(), createBookingEvent() (+32 more)

### Community 37 - "WhatsApp Status Webhooks"
Cohesion: 0.12
Nodes (38): buildFieldLabelMapFromFlowJson(), buildOptionTitleMapFromFlowJson(), extractCampaignIdFromFlowToken(), extractConfirmationConfigFromFlowJson(), extractConfirmationConfigFromSpec(), extractInboundSource(), extractInboundText(), extractMetaFlowIdFromDisparaToken() (+30 more)

### Community 38 - "Flow Form Builder"
Cohesion: 0.11
Nodes (29): AdvancedFlowPanel(), AdvancedFlowPanelProps, FlowScreen, FlowFormBuilder(), AIGenerateDialog(), FieldEditor(), FieldList(), FormHeader() (+21 more)

### Community 39 - "Builder Plugins & Credentials"
Cohesion: 0.08
Nodes (31): fetchCredentials(), fetchIntegrationCredentials(), mapIntegrationConfig(), SYSTEM_CREDENTIAL_MAPPERS, WorkflowCredentials, getIntegrationById(), IntegrationRecord, ActionConfigField (+23 more)

### Community 40 - "Storage Validation"
Cohesion: 0.09
Nodes (38): AppSettings, AppSettingsSchema, Campaign, CampaignsArraySchema, CampaignSchema, CampaignStatusSchema, Contact, ContactsArraySchema (+30 more)

### Community 41 - "Dashboard Page Chrome"
Cohesion: 0.13
Nodes (20): Attendant, MOCK_ATTENDANTS, AdvancedFlowPanel, FlowBuilderEditorPage(), UnifiedFlowEditor, FlowBuilderHomePage(), generateDefaultName(), NewTemplatePage() (+12 more)

### Community 42 - "Meta Account Limits"
Cohesion: 0.12
Nodes (30): CampaignBlockModal(), CampaignBlockModalProps, UpgradeRoadmapModal(), UpgradeRoadmapModalProps, StatusCard, StatusCardProps, fetchLimitsFromAPI(), LIMITS_QUERY_KEY (+22 more)

### Community 43 - "Template Service (Meta Payload)"
Cohesion: 0.09
Nodes (25): GeneratedTemplate, TemplateService, AudioMessagePayload, CreateTemplateInput, DocumentMessagePayload, ImageMessagePayload, LocationMessagePayload, MetaBodyComponent (+17 more)

### Community 44 - "Template Contract & Prechecks"
Cohesion: 0.09
Nodes (32): POST(), PrecheckContact, templateDb, appendCampaignToFlowToken(), buildMetaTemplatePayload(), buildTemplateSpecV1(), buttonUrlHasAnyPlaceholder(), collectTemplateButtons() (+24 more)

### Community 45 - "Phone Normalization (BR)"
Cohesion: 0.12
Nodes (27): CountryCount, GET(), resolveCountry(), GET(), parseList(), resolveCountry(), GET(), resolveState() (+19 more)

### Community 46 - "Template Selection Hooks"
Cohesion: 0.12
Nodes (24): ManualDraftsViewProps, useTemplatesController(), canSendDraft(), computeDraftSendStates(), DraftSendState, getDraftBlockReason(), validateManualDraft(), filterByDraftIds() (+16 more)

### Community 47 - "Self-Install Wizard (Supabase/Vercel)"
Cohesion: 0.11
Nodes (26): ActiveProject, PreflightResult, UiStep, getServiceGlowColor(), ServiceConfig, ServiceIcon(), ServiceIconProps, ServiceType (+18 more)

### Community 48 - "Flow Builder Steps"
Cohesion: 0.14
Nodes (30): StepInput, withStepLogging(), AskQuestionInput, AskQuestionResult, askQuestionStep(), SendButtonsInput, SendButtonsResult, sendButtonsStep() (+22 more)

### Community 49 - "Dynamic Flow Engine"
Cohesion: 0.11
Nodes (36): applyFooterAction(), BookingDateComponent, BookingServiceOption, BookingServicesArraySchema, BookingServiceSchema, buildFooterComponent(), buildRoutingModelFromPaths(), dedupeSuccessTextBlocks() (+28 more)

### Community 50 - "Community 50"
Cohesion: 0.08
Nodes (22): GeneratedTemplate, languageMap, Strategy, STRATEGY_CONFIG, TestStrategySchema, AIStrategy, CustomStrategyPrompts, DEFAULT_STRATEGY_PROMPTS (+14 more)

### Community 51 - "Community 51"
Cohesion: 0.08
Nodes (27): Contact, ConversaPage(), Conversation, ConversationStatus, fetchConversation(), fetchMessages(), formatTime(), formatWaitTime() (+19 more)

### Community 52 - "Community 52"
Cohesion: 0.09
Nodes (29): AIRespondRequest, getAgentForConversation(), getContactData(), handleAutoHandoff(), POST(), splitMessageByParagraphs(), AITestRequest, AITestResponse (+21 more)

### Community 53 - "Community 53"
Cohesion: 0.10
Nodes (31): findActionById(), getAllActions(), getActionLabel(), getStepImporter(), STEP_IMPORTERS, StepImporter, StepContext, completeConversation() (+23 more)

### Community 54 - "Community 54"
Cohesion: 0.14
Nodes (27): canAddMoreCards(), canRemoveCards(), Carousel, CAROUSEL_RULES, CarouselButton, CarouselCard, CarouselCardComponent, CarouselHeaderFormat (+19 more)

### Community 55 - "Community 55"
Cohesion: 0.10
Nodes (27): CampaignContactRow, chunk(), ContactRow, fetchSingleTemplateFromMeta(), getTemplateHeaderMediaExampleLink(), isHttpUrl(), Params, POST() (+19 more)

### Community 56 - "Community 56"
Cohesion: 0.10
Nodes (30): CampaignsNewRealPage(), buildScheduledAt(), Contact, ContactStats, CountryCount, CustomField, extractFlowFromTemplate(), fetchJson() (+22 more)

### Community 57 - "Community 57"
Cohesion: 0.14
Nodes (24): canReceiveMessages(), ContactStatus, getStatusColor(), getStatusLabel(), isBlockedStatus(), STATUS_COLORS, STATUS_LABELS, STATUS_RULES (+16 more)

### Community 58 - "Community 58"
Cohesion: 0.16
Nodes (27): GET(), LLM_API_KEY_MAP, CallOptions, callOptionsSchema, DEFAULT_CALL_OPTIONS, SupportResponse, supportResponseSchema, AI_PROVIDERS (+19 more)

### Community 59 - "Community 59"
Cohesion: 0.15
Nodes (28): POST(), POST(), POST(), GET(), checkRateLimiting(), clearFailedAttempts(), Company, completeSetup() (+20 more)

### Community 60 - "Community 60"
Cohesion: 0.11
Nodes (29): bulkClaimPendingForSend(), CampaignWorkflowInput, Contact, fetchSingleTemplateFromMeta(), getTemplateHeaderMediaExampleLink(), getUrlHost(), guessExtFromContentType(), hashConfig() (+21 more)

### Community 61 - "Community 61"
Cohesion: 0.09
Nodes (26): AIAgentsSettingsPage(), CampaignFolderFilter(), CampaignFolderFilterProps, CampaignFolderSidebar(), CampaignFolderSidebarProps, FolderItem(), FolderItemProps, CampaignTagBadge() (+18 more)

### Community 62 - "Community 62"
Cohesion: 0.10
Nodes (27): INTERNAL_FIELDS, LogInfo, logStepComplete(), logStepStart(), logWorkflowComplete(), StepContextWithWorkflow, StepInputWithWorkflow, stripInternalFields() (+19 more)

### Community 63 - "Community 63"
Cohesion: 0.06
Nodes (33): scripts, ai:devtools, build, builder:smoke, db:migrate:0018, db:migrate:0020, dev, dev:ai (+25 more)

### Community 64 - "Community 64"
Cohesion: 0.16
Nodes (29): countFormWrappers(), countNavigatePayloads(), flattenFormWrappers(), getFlowEndpointUrl(), isDynamicFlow(), isPlainObject(), POST(), PublishSchema (+21 more)

### Community 65 - "Community 65"
Cohesion: 0.11
Nodes (27): autoMapVariables(), canResolveAllVariables(), generateAutoFillValues(), getSystemFieldKey(), getUnresolvedVariables(), isSystemField(), resolveAllVariables(), ResolvedVariable (+19 more)

### Community 66 - "Community 66"
Cohesion: 0.06
Nodes (32): devDependencies, autoprefixer, dotenv, eruda, eslint, eslint-plugin-react-hooks, jsdom, msw (+24 more)

### Community 67 - "Community 67"
Cohesion: 0.08
Nodes (19): POST(), POST(), ManualDraftEditorPage(), MetaAPIError, MetaErrorPayload, BodySchema, ButtonSchema, CarouselCardSchema (+11 more)

### Community 68 - "Community 68"
Cohesion: 0.15
Nodes (28): getInitialState(), InstallPage(), stepVariants, calculateDirection(), clearPersistedState(), createInitialState(), debugLog(), hydrateState() (+20 more)

### Community 69 - "Community 69"
Cohesion: 0.13
Nodes (25): AICenterPage(), GATEWAY_FALLBACK_MODELS, AISettings(), AISettingsProps, ProviderStatus, AIConfigResponse, DEFAULT_OCR_CONFIG, EMPTY_PROVIDER_STATUS (+17 more)

### Community 70 - "Community 70"
Cohesion: 0.10
Nodes (24): ApiDocsPanel(), AutoSuppressionConfig, AutoSuppressionPanel(), AutoSuppressionPanelProps, BrandPanel(), BrandSettings, fetchBrandSettings(), isValidHex() (+16 more)

### Community 71 - "Community 71"
Cohesion: 0.17
Nodes (24): ActionPicker(), normalize(), FlowBuilderStore, PickerState, SaveMode, addBranch(), addStep(), createStep() (+16 more)

### Community 72 - "Community 72"
Cohesion: 0.10
Nodes (19): BranchesFormProps, FormProps, highlightVars(), normalizeConfigForSave(), PanelBody(), WhatsappForm(), lighten(), STEP_ICONS (+11 more)

### Community 73 - "Community 73"
Cohesion: 0.17
Nodes (23): CAMPAIGN_RULES, CampaignValidationError, canContactReceiveCampaign(), ContactEligibilityResult, normalizePhoneForComparison(), validateCampaignName(), validateRecipientCount(), formatScheduleDate() (+15 more)

### Community 74 - "Community 74"
Cohesion: 0.15
Nodes (22): GET(), GET(), PUT(), generateMetadata(), inter, jetbrainsMono, RootLayout(), viewport (+14 more)

### Community 75 - "Community 75"
Cohesion: 0.14
Nodes (23): BuilderWorkflowInput, ExecutionResultShape, ExecutionResultShape, ResumeWorkflowInput, GET(), handle(), POST(), backoffEnrollment() (+15 more)

### Community 76 - "Community 76"
Cohesion: 0.15
Nodes (22): GET(), getVercelDashboardUrl(), HealthCheckResult, computeWebhookUrl(), DELETE(), GET(), getMetaSubscriptionStatus(), getWebhookHierarchy() (+14 more)

### Community 77 - "Community 77"
Cohesion: 0.15
Nodes (28): assertGraphObjectReadable(), asStringArray(), buildMissingPermissionsSteps(), buildMissingScopesSteps(), buildReportText(), buildSupportPacketText(), CheckStatus, collectFbtraceIds() (+20 more)

### Community 78 - "Community 78"
Cohesion: 0.12
Nodes (23): CampaignDetailsPage(), useCampaignDetailsController(), calculateRealStats(), filterMessages(), filterStatusToMessageStatus(), getMessageStatusCounts(), matchesSearchTerm(), matchesStatus() (+15 more)

### Community 79 - "Community 79"
Cohesion: 0.13
Nodes (21): DashboardShell(), ChecklistMiniBadge(), ChecklistMiniBadgeProps, DEFAULT_PROGRESS, OnboardingProgress, OnboardingStep, useOnboardingProgress(), OnboardingChecklist() (+13 more)

### Community 80 - "Community 80"
Cohesion: 0.14
Nodes (23): DashboardView(), getCampaignBadgeStatus(), getCampaignLabel(), clamp(), fmtInt(), fmtMs(), fmtNumber(), fmtPct() (+15 more)

### Community 81 - "Community 81"
Cohesion: 0.09
Nodes (14): Params, Params, computeDispatchMetrics(), GET(), isMissingTableError(), noStoreJson(), queryVariantMetrics(), safeNumber() (+6 more)

### Community 82 - "Community 82"
Cohesion: 0.12
Nodes (21): TurboActionsCard(), TurboActionsCardProps, TURBO_PRESETS, TurboConfigForm(), TurboConfigFormProps, TurboDraft, TurboPresetKey, TurboPhoneCard() (+13 more)

### Community 83 - "Community 83"
Cohesion: 0.11
Nodes (23): CampaignMessagesResponse, isCampaignReset(), mergeCampaignCountersMonotonic(), mergeMessageStatsMonotonic(), Campaign, CampaignListParams, CampaignListResult, CampaignPendingContact (+15 more)

### Community 84 - "Community 84"
Cohesion: 0.17
Nodes (23): createApiRequest(), createRouteContext(), parseJsonResponse(), createAllDbMocks(), createCampaignContactDbMock(), createCampaignDbMock(), createCampaignFolderDbMock(), createCampaignTagDbMock() (+15 more)

### Community 85 - "Community 85"
Cohesion: 0.14
Nodes (20): GET(), mask(), POST(), POST(), GET(), DELETE(), GET(), POST() (+12 more)

### Community 86 - "Community 86"
Cohesion: 0.19
Nodes (25): DELETE(), GET(), parseJsonSetting(), POST(), validateApiKey(), validateMistralApiKey(), ValidationResult, fetchAISettings() (+17 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (24): mockAdd, mockContacts, mockContactStats, mockCustomFields, mockDeleteContact, mockDeleteMany, mockGetAllCustomFields, mockGetById (+16 more)

### Community 88 - "Community 88"
Cohesion: 0.19
Nodes (24): CRITICAL_ERROR_CODES, detectCodecError(), ERROR_CATEGORY_COLORS, ERROR_CATEGORY_ICONS, ERROR_CATEGORY_LABELS, ErrorCategory, getErrorCategory(), getRecommendedAction() (+16 more)

### Community 89 - "Community 89"
Cohesion: 0.13
Nodes (19): pauseSchema, POST(), RouteContext, POST(), RouteContext, POST(), RouteContext, buildSuggestPrompt() (+11 more)

### Community 90 - "Community 90"
Cohesion: 0.13
Nodes (21): HealthCheckResultSchema, POST(), RunSchema, withRetry(), ALL_STEPS, createCinemaPhases(), createProgressCalculator(), HealthCheckResultSchema (+13 more)

### Community 91 - "Community 91"
Cohesion: 0.15
Nodes (21): DELETE(), GET(), RouteParams, DELETE(), RouteParams, deleteMemoryById(), deleteUserMemories(), fetchRelevantMemories() (+13 more)

### Community 92 - "Community 92"
Cohesion: 0.10
Nodes (17): BuilderLayoutProps, PageContentShell(), DEFAULT_LAYOUT, getPageWidthClass(), LayoutStackItem, PageHeight, PageLayoutConfig, PageLayoutContext (+9 more)

### Community 93 - "Community 93"
Cohesion: 0.17
Nodes (13): getAvailableOCRProviders(), getOCRProvider(), OCRProviderName, processDocumentOCR(), ProcessDocumentResult, GeminiOCRProvider, MistralOCRProvider, MistralOCRResponse (+5 more)

### Community 94 - "Community 94"
Cohesion: 0.13
Nodes (17): AIAgentFormProps, AIAgentsSettingsViewProps, AI_AGENTS_KEY, AI_AGENTS_TOGGLE_KEY, AIAgentsToggleResponse, useAIAgentMutations(), useAIAgents(), useAIAgentsController() (+9 more)

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (18): formatFieldLabel(), formatFieldValue(), SubmissionCard(), SubmissionsViewProps, SubmissionsController, SubmissionsInitialData, UseSubmissionsParams, FlowSubmission (+10 more)

### Community 96 - "Community 96"
Cohesion: 0.08
Nodes (23): mockAllSettings, mockAutoSuppressionConfig, mockCheckAccountHealth, mockFetchPhoneDetails, mockGetAll, mockGetAutoSuppression, mockGetHealthSummary, mockGetWhatsAppThrottle (+15 more)

### Community 97 - "Community 97"
Cohesion: 0.12
Nodes (20): allCssVars, borders, colors, designSystem, motion, shadows, spacing, typography (+12 more)

### Community 98 - "Community 98"
Cohesion: 0.18
Nodes (19): createMetaErrorResponse(), messageUndeliverableHandler, pairRateLimitHandler, paymentErrorHandler, policyViolationHandler, rateLimitHandler, systemErrorHandler, templateNotFoundHandler (+11 more)

### Community 99 - "Community 99"
Cohesion: 0.17
Nodes (17): DomainOption, WabaOverrideStatus, WebhookHierarchy, WebhookStats, WebhookSubscription, WebhookLevelsExplanation(), findActiveLevel(), urlsMatch() (+9 more)

### Community 100 - "Community 100"
Cohesion: 0.12
Nodes (18): buildUtilityJudgePrompt(), getProviderFromModel(), GeneratedTemplate, GeneratedTemplateSchema, Issue, IssueSchema, JudgedTemplate, JudgedTemplateSchema (+10 more)

### Community 101 - "Community 101"
Cohesion: 0.21
Nodes (23): addEdge(), addNode(), assertValidExpression(), branchColumnPos(), compileChain(), compileCondition(), CompileCtx, CompiledEdge (+15 more)

### Community 102 - "Community 102"
Cohesion: 0.21
Nodes (18): GET(), getErrorMessage(), isMissingColumn(), isMissingTable(), AutoSuppressionConfig, defaultConfig(), GET(), getConfigFromDbOrDefault() (+10 more)

### Community 103 - "Community 103"
Cohesion: 0.10
Nodes (18): Checkbox, CheckboxProps, ControlledFieldProps, FormContext, FormContextValue, FormField(), FormFieldProps, FormProvider() (+10 more)

### Community 104 - "Community 104"
Cohesion: 0.12
Nodes (17): DeliveryStatusIcon(), isHandoffMessage(), isTemplateMessage(), ParsedTemplateMessage, parseHandoffMessage(), parseTemplateMessage(), SentimentIndicator(), formatRelativeTime() (+9 more)

### Community 105 - "Community 105"
Cohesion: 0.13
Nodes (20): BUTTON_ICONS, CompactPreviewProps, getHeaderExampleUrl(), isHttpUrl(), MessageBubble(), MessageBubbleProps, MessageButtonProps, MessageHeader() (+12 more)

### Community 106 - "Community 106"
Cohesion: 0.16
Nodes (20): SendMediaInput, SendMediaResult, sendMediaStep(), buildAudioMessage(), BuildAudioMessageOptions, buildCarouselMessage(), BuildCarouselOptions, buildDocumentMessage() (+12 more)

### Community 107 - "Community 107"
Cohesion: 0.13
Nodes (22): addLabelToConversation(), deleteLabel(), MessageFilters, removeLabelFromConversation(), updateConversation(), assignLabel(), closeConversation(), executeHandoff() (+14 more)

### Community 108 - "Community 108"
Cohesion: 0.18
Nodes (15): FormsInitialData, getFormsInitialData(), FormsClientWrapper(), FormsClientWrapperProps, FormsWithData(), FormsSkeleton(), LeadFormsViewProps, fetchTags() (+7 more)

### Community 109 - "Community 109"
Cohesion: 0.11
Nodes (18): ContactFieldMappingSheet(), ContactFieldMappingSheetProps, ColumnMappingSelectProps, ContactImportModal(), getInvalidReason(), ImportPreviewStats, ImportStep, ImportStepMappingProps (+10 more)

### Community 110 - "Community 110"
Cohesion: 0.18
Nodes (12): BatchConfig, flushBeforeShutdown(), handleWebhookStatus(), parseMetaWebhook(), processMetaWebhook(), localStorageMock, webhookBatcher, WebhookBatchManager (+4 more)

### Community 111 - "Community 111"
Cohesion: 0.19
Nodes (18): extractFields(), extractTemplateVariables(), findNodeOutputByLabel(), formatTemplateForDisplay(), formatValue(), getAvailableFields(), hasTemplateVariables(), isStandardizedOutput() (+10 more)

### Community 112 - "Community 112"
Cohesion: 0.26
Nodes (19): buildAIAgent(), buildAppSettings(), buildCampaign(), buildCampaignFolder(), buildCampaignTag(), buildContact(), buildInboxConversation(), buildInboxMessage() (+11 more)

### Community 113 - "Community 113"
Cohesion: 0.12
Nodes (20): AISettingsData, AllSettingsResponse, CalendarBookingData, CredentialsData, DEFAULT_CALENDAR_BOOKING_CONFIG, DEFAULT_WORKFLOW_EXECUTION_CONFIG, DomainsData, fetchCalendarBooking() (+12 more)

### Community 114 - "Community 114"
Cohesion: 0.14
Nodes (19): buildConnectionTroubleshooting(), GraphApiError, graphGetJson(), GraphGetResult, isMaskedToken(), normalizeGraphApiError(), POST(), wabaHasPhoneNumber() (+11 more)

### Community 115 - "Community 115"
Cohesion: 0.17
Nodes (18): DELETE(), GET(), BackfillBody, isHttpUrl(), POST(), allowedMimeTypesForFormat(), EnsureHeaderMediaPreviewParams, ensureHeaderMediaPreviewUrl() (+10 more)

### Community 116 - "Community 116"
Cohesion: 0.12
Nodes (7): getInboxInitialData, InboxErrorFallback(), INBOX_LAYOUT, InboxWithData(), ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState

### Community 117 - "Community 117"
Cohesion: 0.17
Nodes (11): CredentialsFormProps, MetaAppInfo, clearAllData(), initStorage(), KEYS, STATUS_MIGRATION, storage, OCRConfig (+3 more)

### Community 118 - "Community 118"
Cohesion: 0.14
Nodes (11): baseFlow, FlowSubmissionRow, FlowSubmissionsQuery, flowSubmissionsService, mockSubmission, FlowTemplateDTO, flowTemplatesService, mockTemplate (+3 more)

### Community 119 - "Community 119"
Cohesion: 0.14
Nodes (15): CompiledWorkflow, branch(), buildMainFlow(), endStep(), interactive(), makeFlow(), SYSTEM_ACTION_TYPES, whatsapp() (+7 more)

### Community 120 - "Community 120"
Cohesion: 0.18
Nodes (17): DEFAULT_OPTIONS, detectDelimiter(), exportToCSV(), generateImportReport(), parseContactsFile(), parseContactsFromFile(), ParsedContact, ParseOptions (+9 more)

### Community 121 - "Community 121"
Cohesion: 0.10
Nodes (19): BorderColor, borderColors, borderCssVars, BorderPreset, borderPresets, BorderRadius, BorderStyle, borderStyles (+11 more)

### Community 122 - "Community 122"
Cohesion: 0.21
Nodes (19): CampaignEvent, CampaignStats, clearAllEvents(), clearCampaignEvents(), computeCampaignFunnel(), computeCampaignStats(), EventType, FunnelStage (+11 more)

### Community 123 - "Community 123"
Cohesion: 0.19
Nodes (20): createLabel(), createQuickReply(), deleteQuickReply(), findConversationByPhone(), getClient(), getConversations(), getLabels(), getMessagesByConversation() (+12 more)

### Community 124 - "Community 124"
Cohesion: 0.15
Nodes (18): buildUrl(), createEnv(), disableDeploymentProtection(), findProjectByDomain(), formatVercelError(), getProject(), getVercelDeployment(), listProjectEnvs() (+10 more)

### Community 125 - "Community 125"
Cohesion: 0.25
Nodes (19): AdaptiveThrottleConfig, AdaptiveThrottleConfigSource, AdaptiveThrottleConfigWithSource, AdaptiveThrottleState, AdaptiveThrottleUpdateResult, clampInt(), configFromEnv(), defaultState() (+11 more)

### Community 126 - "Community 126"
Cohesion: 0.14
Nodes (19): buildCtaUrl(), BuildCtaUrlOptions, buildHeader(), buildListMessage(), BuildListMessageOptions, buildLocationRequest(), BuildLocationRequestOptions, buildMenu() (+11 more)

### Community 127 - "Community 127"
Cohesion: 0.18
Nodes (18): fetchLimitsFromMeta(), GET(), POST(), TIER_LIMITS, safeJson(), safeText(), WhatsAppCredentials, buildTemplatePayload() (+10 more)

### Community 128 - "Community 128"
Cohesion: 0.21
Nodes (16): DELETE(), GET(), isLocalhostUrl(), POST(), resolveEndpointUrlFromRequest(), POST(), createCloseResponse(), createErrorResponse() (+8 more)

### Community 129 - "Community 129"
Cohesion: 0.24
Nodes (16): PhoneNumberCard(), PhoneNumberCardProps, PhoneNumbersList(), PhoneNumbersListProps, CardColor, WebhookConfigSectionProps, WebhookFunnelLevel, WebhookStatus (+8 more)

### Community 130 - "Community 130"
Cohesion: 0.10
Nodes (19): defaultConversationsReturn, defaultConversationWithMessagesReturn, defaultInboxSettingsReturn, defaultLabelsReturn, defaultMutationsReturn, defaultQuickRepliesReturn, mockConversationList, mockConversationMutations (+11 more)

### Community 131 - "Community 131"
Cohesion: 0.17
Nodes (7): logApiError(), logApiRequest(), logApiResponse(), logCampaignEvent(), LogEntry, logMessageSend(), StructuredLogger

### Community 132 - "Community 132"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 133 - "Community 133"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 134 - "Community 134"
Cohesion: 0.26
Nodes (15): ADMIN_ENDPOINTS, AuthResult, forbiddenResponse(), generateApiKey(), isAdminEndpoint(), isPublicEndpoint(), PUBLIC_ENDPOINTS, unauthorizedResponse() (+7 more)

### Community 135 - "Community 135"
Cohesion: 0.22
Nodes (13): useFlowBuilderController(), useFlowEditorController(), bookingConfigToDynamicSpec(), BookingFlowConfigV1, dynamicFlowSpecFromJson(), formSpecToDynamicSpec(), generateBookingDynamicFlowJson(), getDefaultBookingFlowConfig() (+5 more)

### Community 136 - "Community 136"
Cohesion: 0.18
Nodes (12): BuilderPage(), BuilderPageProps, FlowCanvas, BuilderHeader(), BuilderHeaderProps, SaveState, ConfigPanel(), useFlowBuilderStore (+4 more)

### Community 137 - "Community 137"
Cohesion: 0.12
Nodes (11): API_KEY_URLS, OCR_GEMINI_MODELS, PromptItem, PROMPTS, StrategyItem, TEMPLATE_STRATEGIES, GatewayStatus, HeliconeConfig (+3 more)

### Community 138 - "Community 138"
Cohesion: 0.21
Nodes (17): BLOCK_TYPE_LABEL, BlockType, createNewBlock(), createSlug(), defaultOptions(), getBlocksForScreen(), getDataBindingKey(), getFirstForm() (+9 more)

### Community 139 - "Community 139"
Cohesion: 0.16
Nodes (13): ConditionInput, ConditionResult, conditionStep(), evaluateCondition(), createDatabaseClient(), databaseQuery(), DatabaseQueryInput, DatabaseQueryResult (+5 more)

### Community 140 - "Community 140"
Cohesion: 0.16
Nodes (3): createRateLimiter(), RateLimiter, TokenBucketRateLimiter

### Community 141 - "Community 141"
Cohesion: 0.15
Nodes (16): AISettingsInfo, AutoSuppressionInfo, CalendarBookingInfo, DomainOption, SaveAIConfigFn, SaveAutoSuppressionFn, SaveWhatsAppThrottleFn, SettingsViewProps (+8 more)

### Community 142 - "Community 142"
Cohesion: 0.24
Nodes (16): Box, branchEdgeLabel(), Ctx, flowEdge(), isContainer(), isTerminal(), LayoutEdge, layoutFlow() (+8 more)

### Community 143 - "Community 143"
Cohesion: 0.12
Nodes (16): Animation, animations, Duration, DurationAlias, durationAliases, durations, Easing, EasingAlias (+8 more)

### Community 144 - "Community 144"
Cohesion: 0.24
Nodes (14): AppError, classifyHttpError(), classifyWhatsAppError(), ERROR_MESSAGES, ErrorType, getPairRateLimitWait(), getRetryDelay(), getUserErrorMessage() (+6 more)

### Community 145 - "Community 145"
Cohesion: 0.15
Nodes (10): clearInstallState(), createInstallState(), generateSessionId(), InstallState, InstallStep, loadInstallState(), markInstallationComplete(), saveInstallState() (+2 more)

### Community 146 - "Community 146"
Cohesion: 0.12
Nodes (14): campaignNameSchema, contactIdsSchema, CredentialsForm, credentialsFormSchema, emailSchema, ERROR_CODES, ERROR_MESSAGES, futureDateSchema (+6 more)

### Community 147 - "Community 147"
Cohesion: 0.18
Nodes (14): buildSystemPrompt(), getAgent(), persistAILog(), POST(), requestSchema, respondToolSchema, GET(), POST() (+6 more)

### Community 148 - "Community 148"
Cohesion: 0.20
Nodes (15): alignToNextSlot(), CalendarBookingConfig, DEFAULT_CONFIG, GET(), getCalendarBookingConfig(), isSlotInsideWorkingHours(), minutesToTime(), normalizeConfig() (+7 more)

### Community 149 - "Community 149"
Cohesion: 0.21
Nodes (13): allowedMimeTypesFor(), GraphErrorBody, guessMimeType(), jsonNoStore(), maxBytesFor(), POST(), UploadFormat, DELETE() (+5 more)

### Community 150 - "Community 150"
Cohesion: 0.19
Nodes (13): ContactQuickEditModal(), ContactQuickEditModalProps, ContactsCache, ContactsQueryData, ContactUpdatePayload, getContactDisplayName(), isContactsCache(), normalizeEmailForUpdate() (+5 more)

### Community 151 - "Community 151"
Cohesion: 0.21
Nodes (11): SetupStep, SetupWizardView(), SetupWizardViewProps, useSettingsController(), WebhookSubscriptionStatus, AccountHealth, checkAccountHealth(), getHealthSummary() (+3 more)

### Community 152 - "Community 152"
Cohesion: 0.15
Nodes (9): FIT_VIEW_OPTIONS, FlowCanvas(), PRO_OPTIONS, EndNode, nodeTypes, PlaceholderNode, PlusLeafNode, TriggerNode (+1 more)

### Community 153 - "Community 153"
Cohesion: 0.21
Nodes (12): buildSuggestedPrompt(), ExtractContentSchema, ExtractedContent, POST(), AIFieldSchema, AIFlowFormOutputSchema, buildPrompt(), GenerateFlowFormSchema (+4 more)

### Community 154 - "Community 154"
Cohesion: 0.22
Nodes (13): GeneratedTemplate, GenerateUtilityTemplatesSchema, generateWithUnifiedPrompt(), languageMap, normalizeTemplate(), normalizeVariablesToSequential(), POST(), sanitizeContentForMeta() (+5 more)

### Community 155 - "Community 155"
Cohesion: 0.25
Nodes (12): buildDirectDbUrl(), buildPoolerDbUrl(), calculateProgress(), findOrCreateSupabaseProject(), hashPassword(), POST(), ProvisionSchema, STEPS (+4 more)

### Community 156 - "Community 156"
Cohesion: 0.18
Nodes (10): Providers(), DevModeProvider(), InstallBannerProps, PushToggleButton(), PWAContext, PWAContextType, PWAProvider(), PWAProviderProps (+2 more)

### Community 157 - "Community 157"
Cohesion: 0.16
Nodes (13): ProvisioningView(), ProvisioningViewProps, RFC-5322, actions, assertNever(), CollectingState, ErrorState, ProvisioningState (+5 more)

### Community 158 - "Community 158"
Cohesion: 0.19
Nodes (12): colorMap, GlowColor, StepCard, StepCardProps, generateStrongPassword(), hashPassword(), IdentityStep(), IdentityStepProps (+4 more)

### Community 159 - "Community 159"
Cohesion: 0.15
Nodes (11): BrandLogo, CompactSidebar, DashboardSidebar, DashboardSidebarProps, ExpandedSidebar, InboxUnreadBadge, NavItem, ThemeToggle() (+3 more)

### Community 160 - "Community 160"
Cohesion: 0.32
Nodes (11): ContactsQueryParams, createContactsQueryKey(), useContactsController(), ContactSelectionFilters, useContactSelection(), clearContactSelection(), normalizeEmailForUpdate(), sanitizeCustomFieldsForUpdate() (+3 more)

### Community 161 - "Community 161"
Cohesion: 0.25
Nodes (13): ALLOWED_METHODS, checkBracketExpressions(), checkDangerousPatterns(), checkMethodCalls(), checkParentheses(), checkUnauthorizedIdentifiers(), DANGEROUS_PATTERNS, isValidToken() (+5 more)

### Community 162 - "Community 162"
Cohesion: 0.27
Nodes (14): findConversationByPhoneLightweight(), isHumanModeExpired(), switchToBotMode(), findContactId(), getAgentForTrigger(), handleInboundMessage(), handleInboundMessageLegacy(), InboundMessagePayload (+6 more)

### Community 163 - "Community 163"
Cohesion: 0.24
Nodes (14): buildManagementUrl(), extractErrorMessage(), getSupabaseOrganization(), getSupabaseProject(), listOrganizationProjects(), listSupabaseOrganizations(), listSupabaseProjects(), pauseSupabaseProject() (+6 more)

### Community 164 - "Community 164"
Cohesion: 0.25
Nodes (13): extractFlowJson(), asText(), FlowComponent, FlowFormFieldV1, FlowFormOption, FlowFormStepV1, flowJsonToFormSpec(), generateFlowJsonFromFormSpec() (+5 more)

### Community 165 - "Community 165"
Cohesion: 0.26
Nodes (13): getHeaderExampleUrl(), iconForButton(), injectOtpSentinel(), isHttpUrl(), kindForButton(), PreviewButtonKind, renderInline(), renderInlineWithPlaceholders() (+5 more)

### Community 166 - "Community 166"
Cohesion: 0.14
Nodes (13): mockCloneDraft, mockCreateBulkInMeta, mockCreateDraft, mockDeleteBulk, mockDeleteTemplate, mockGenerateUtility, mockGetAll, mockGetByName (+5 more)

### Community 167 - "Community 167"
Cohesion: 0.21
Nodes (12): AiGatewayConfig, toGatewayModelId(), createGatewayModel(), createLanguageModel(), CreateLanguageModelResult, getAllProviderApiKeys(), getHeliconeConfig(), getProviderApiKey() (+4 more)

### Community 168 - "Community 168"
Cohesion: 0.29
Nodes (13): checkSchemaApplied(), configureCronVault(), connectClientWithRetry(), isRetryableConnectError(), listMigrationFiles(), MIGRATIONS_DIR, needsSsl(), NOTE: Supabase DB uses TLS; on some networks a MITM/corporate proxy can inject a (+5 more)

### Community 169 - "Community 169"
Cohesion: 0.30
Nodes (12): ALLOWED_COMPONENT_TYPES, DATA_SOURCE_COMPONENT_TYPES, FlowJsonIssue, FlowJsonValidationResult, INPUT_LIKE_COMPONENT_TYPES, isPlainObject(), isStringArray(), pushIssue() (+4 more)

### Community 170 - "Community 170"
Cohesion: 0.19
Nodes (10): findProjectByDomain(), getEnvVars(), getProject(), setEnvVars(), triggerDeployment(), upsertEnvVar(), VercelApiResult, VercelDeployment (+2 more)

### Community 171 - "Community 171"
Cohesion: 0.29
Nodes (10): POST(), broadcastPushNotification(), getVapidConfig(), PushPayload, PushSubscriptionData, removeInvalidSubscription(), sendNewMessageNotification(), sendPushNotification() (+2 more)

### Community 172 - "Community 172"
Cohesion: 0.26
Nodes (12): CalendarBookingConfig, DEFAULT_CONFIG, GET(), getConfigFromDbOrDefault(), normalizeConfig(), normalizeSlots(), normalizeTime(), normalizeWebhookUrl() (+4 more)

### Community 173 - "Community 173"
Cohesion: 0.23
Nodes (7): ContactsInitialData, getContactsInitialData, ContactsClientWrapper(), ContactsClientWrapperProps, ContactsWithData(), ContactListView(), ContactsSkeleton()

### Community 174 - "Community 174"
Cohesion: 0.23
Nodes (9): SettingsPerformancePage(), useSettingsPerformanceController(), performanceService, SettingsPerformanceByConfigRow, SettingsPerformanceResponse, SettingsPerformanceRunRow, SettingsPerformanceSource, SettingsPerformanceTotals (+1 more)

### Community 175 - "Community 175"
Cohesion: 0.19
Nodes (9): CredentialsModal(), EmptyStateBanner(), EmptyStateBannerProps, GuidedTour(), GuidedTourProps, TOUR_STEPS, TourStep, SuccessBanner() (+1 more)

### Community 176 - "Community 176"
Cohesion: 0.27
Nodes (10): generateStrongPassword(), IdentityForm(), validatePassword(), humanizeError(), SupabaseForm(), FormProps, VercelForm(), InstallData (+2 more)

### Community 177 - "Community 177"
Cohesion: 0.15
Nodes (8): CampaignForm, campaignFormSchema, CampaignStep1Form, campaignStep1Schema, CampaignStep2Form, campaignStep2Schema, CampaignStep3Form, campaignStep3Schema

### Community 178 - "Community 178"
Cohesion: 0.29
Nodes (11): addDaysIso(), AutoSuppressionConfig, AutoSuppressionInput, boolFromUnknown(), clampInt(), computeAutoSuppressionTtlDaysFromConfig(), defaultConfig(), getAutoSuppressionConfig() (+3 more)

### Community 179 - "Community 179"
Cohesion: 0.28
Nodes (10): httpRequest(), HttpRequestInput, HttpRequestResult, httpRequestStep(), parseBody(), parseHeaders(), parseResponse(), cn() (+2 more)

### Community 180 - "Community 180"
Cohesion: 0.24
Nodes (10): isValidMediaUrl(), TemplateParameterValues, validateBody(), validateButtons(), validateHeader(), validateTemplateForDispatch(), validateTemplateParameters(), ValidationError (+2 more)

### Community 181 - "Community 181"
Cohesion: 0.26
Nodes (10): AccountAlert, AccountAlertBanner(), AccountAlertBannerProps, alertColors, alertIcons, AlertsResponse, dismissAlert(), dismissAllAlerts() (+2 more)

### Community 182 - "Community 182"
Cohesion: 0.29
Nodes (11): chunk(), dedupeBy(), DispatchContact, DispatchContactResolved, fetchSingleTemplateFromMeta(), getRequestOrigin(), getTemplateHeaderMediaExampleLink(), isHttpUrl() (+3 more)

### Community 183 - "Community 183"
Cohesion: 0.24
Nodes (10): GET(), POST(), BookingConfig, BookingPrerequisites, checkBookingPrerequisites(), DEFAULT_BOOKING_TEXT, getBookingConfig(), sendBookingFlow() (+2 more)

### Community 184 - "Community 184"
Cohesion: 0.30
Nodes (10): fallbackConfig(), GET(), POST(), WorkflowExecutionConfig, clampInt(), clearWorkflowExecutionConfigCache(), configFromEnv(), DEFAULT_CONFIG (+2 more)

### Community 185 - "Community 185"
Cohesion: 0.23
Nodes (9): installerStyles, LogoUploader(), LogoUploaderProps, settingsStyles, Variant, ALLOWED_TYPES, formatKb(), LogoReadResult (+1 more)

### Community 186 - "Community 186"
Cohesion: 0.26
Nodes (11): KnowledgeBasePanelProps, deleteFile(), knowledgeBaseKeys, listFiles(), ListFilesResponse, uploadFile(), UploadFileParams, useKnowledgeBase() (+3 more)

### Community 187 - "Community 187"
Cohesion: 0.24
Nodes (8): EDGE_STYLE, FlowEdge, FlowEdgeData, nf, GotoEdge, edgeTypes, Pt, roundedOrthogonalPath()

### Community 188 - "Community 188"
Cohesion: 0.30
Nodes (10): formatDateFull(), formatDateISO(), formatDatePtBR(), formatDateShort(), formatDateTimeFull(), formatDateTimeISO(), formatDateTimePtBR(), formatDateTimePtBRCustom() (+2 more)

### Community 189 - "Community 189"
Cohesion: 0.26
Nodes (11): createConversation(), createMessage(), findMessageByWhatsAppId(), getOrCreateConversation(), findOrCreateConversation(), persistInboundMessage(), persistOutboundToInbox(), syncCampaignTemplateToInbox() (+3 more)

### Community 190 - "Community 190"
Cohesion: 0.21
Nodes (7): buildFlowMessage(), BuildFlowMessageOptions, FlowActionPayload, FlowInteractiveMessagePayload, BuildTextMessageOptions, InteractiveHeader, TextMessagePayload

### Community 191 - "Community 191"
Cohesion: 0.24
Nodes (5): CorporateBackground(), InstallLayout(), InstallLayoutProps, StepDots(), StepDotsProps

### Community 192 - "Community 192"
Cohesion: 0.31
Nodes (8): getSubmissionsInitialData, SubmissionsInitialData, PageProps, SubmissionsPage(), SubmissionsClientWrapper(), SubmissionsClientWrapperProps, SubmissionsView(), useSubmissionsController()

### Community 193 - "Community 193"
Cohesion: 0.25
Nodes (8): ConfirmDeleteModalProps, maxWidthClasses, Modal(), ModalCancelButton(), ModalFooter(), ModalHeader(), ModalProps, variantClasses

### Community 194 - "Community 194"
Cohesion: 0.29
Nodes (9): CredentialSource, enrichAICredentials(), enrichDatabaseCredentials(), enrichFirecrawlCredentials(), enrichLinearCredentials(), enrichResendCredentials(), enrichSlackCredentials(), enrichStepInput() (+1 more)

### Community 195 - "Community 195"
Cohesion: 0.18
Nodes (10): primitiveColors, CompositeShadow, compositeShadows, Elevation, elevations, GlowColor, glows, InnerShadow (+2 more)

### Community 196 - "Community 196"
Cohesion: 0.27
Nodes (9): Step, StreamEvent, ERROR_HINTS, ErrorView(), ErrorViewProps, STEP_NAMES, STEP_SERVICES, InstallErrorType (+1 more)

### Community 197 - "Community 197"
Cohesion: 0.20
Nodes (5): EndNodeType, flowNodeTypes, MessageNodeType, NodeShellProps, StartNodeType

### Community 198 - "Community 198"
Cohesion: 0.24
Nodes (8): DevModePanel(), SettingsView(), WebhookConfigSection(), DevModeContext, DevModeContextValue, useDevMode(), DevModeToggle(), DevModeToggleProps

### Community 199 - "Community 199"
Cohesion: 0.29
Nodes (8): buildMarkAsRead(), buildTypingIndicator(), MarkAsReadOptions, MarkAsReadPayload, sendMarkAsRead(), simulateTypingDelay(), TypingIndicatorOptions, TypingIndicatorPayload

### Community 200 - "Community 200"
Cohesion: 0.31
Nodes (8): argv, classifyLikelyIssues(), graph(), graphVersion, main(), redactToken(), safeGetWithFields(), wantJson

### Community 201 - "Community 201"
Cohesion: 0.42
Nodes (8): CSV_HEADER, csvEscape(), GET(), isMissingColumn(), isMissingTable(), resolveCampaignName(), resolveFlowName(), safeFilename()

### Community 202 - "Community 202"
Cohesion: 0.31
Nodes (8): DELETE(), GET(), PATCH(), patchSchema, RouteParams, deleteConversation(), getConversation(), patchConversation()

### Community 203 - "Community 203"
Cohesion: 0.39
Nodes (8): checkDatabaseHealth(), getSupabaseProjectStatus(), HealthCheckResult, HealthCheckSchema, needsSsl(), POST(), stripSslModeParam(), resolveSupabaseDbUrl()

### Community 204 - "Community 204"
Cohesion: 0.44
Nodes (8): buildByConfig(), computeDispatchMetrics(), GET(), noStoreJson(), percentile(), RunRow, safeNumber(), summarize()

### Community 205 - "Community 205"
Cohesion: 0.28
Nodes (9): Dispara Apple Touch Icon, Dispara Favicon, Dispara Wordmark (dark background), Dispara Wordmark (light background), Dispara Brand Mark (rounded emerald tile), Dispara Brand Mark (maskable, full-bleed), Dispara App Icon (PWA, regular), Dispara App Icon (PWA, maskable) (+1 more)

### Community 206 - "Community 206"
Cohesion: 0.39
Nodes (8): clampText(), FlowComponent, FlowPhonePreview(), getFooter(), isPlainObject(), ParsedFlow, parseFlowJson(), renderComponent()

### Community 207 - "Community 207"
Cohesion: 0.31
Nodes (7): RealtimeIndicator(), RealtimeIndicatorProps, defaultContext, RealtimeContext, RealtimeContextValue, useRealtime(), RealtimeState

### Community 208 - "Community 208"
Cohesion: 0.25
Nodes (5): formatNumber(), PROGRESS_BAR_COLORS, UsageData, UsagePanel(), UsagePanelProps

### Community 209 - "Community 209"
Cohesion: 0.31
Nodes (8): BeforeInstallPromptEvent, PushState, removeSubscriptionFromBackend(), saveSubscriptionToBackend(), ServiceWorkerState, urlBase64ToUint8Array(), useServiceWorker(), UseServiceWorkerReturn

### Community 210 - "Community 210"
Cohesion: 0.22
Nodes (8): GapPreset, gapPresets, InlineSize, paddingPresets, semanticSpacing, spacingCssVars, SpacingScale, StackSize

### Community 212 - "Community 212"
Cohesion: 0.36
Nodes (7): DEFAULT_PERSIST_PHASES, isMissingTableError(), maskPhone(), persistWorkflowTraceEventBestEffort(), sanitizeExtraForStorage(), shouldPersistEvent(), WorkflowTraceEvent

### Community 213 - "Community 213"
Cohesion: 0.28
Nodes (5): IGNORE_PATTERNS, isStaticAsset(), PRECACHE_ASSETS, shouldIgnore(), STATIC_PATTERNS

### Community 214 - "Community 214"
Cohesion: 0.46
Nodes (7): CreateFlowSchema, GET(), getErrorMessage(), isMissingDbColumn(), isMissingTable(), POST(), getFlowTemplateByKey()

### Community 215 - "Community 215"
Cohesion: 0.32
Nodes (7): buildVercelDashboardUrl(), GET(), getStatus(), HealthStatus, SystemResponse, UsageData, VercelInfo

### Community 216 - "Community 216"
Cohesion: 0.39
Nodes (7): fetchTemplatesFromMeta(), GET(), MetaTemplate, MetaTemplateComponent, normalizeParameterFormat(), POST(), syncTemplatesToLocalDb()

### Community 217 - "Community 217"
Cohesion: 0.36
Nodes (5): AIGeneratorModalProps, GeneratedTemplate, GenerateParams, useAITemplateGenerator(), UseAITemplateGeneratorOptions

### Community 218 - "Community 218"
Cohesion: 0.32
Nodes (5): normalizeTemplateName(), useManualDraftsController(), DraftRowSchema, parseListResponse(), mockDraft

### Community 219 - "Community 219"
Cohesion: 0.46
Nodes (6): CACHE_DISABLE_HEADERS, CACHE_MEDIUM_HEADERS, CACHE_PRIVATE_HEADERS, CACHE_SHORT_HEADERS, CORS_PUBLIC_HEADERS, createCacheHeaders()

### Community 220 - "Community 220"
Cohesion: 0.46
Nodes (6): analyzeContent(), PROMOTIONAL_PATTERNS, reconstructMessage(), SanitizedTemplate, sanitizePromotionalContent(), wrapAsUpdateNotification()

### Community 221 - "Community 221"
Cohesion: 0.50
Nodes (6): escapeRegExp(), extractAllPlaceholders(), replaceNamedPlaceholders(), replacePositionalPlaceholders(), replaceTemplatePlaceholders(), TemplateParameterFormat

### Community 222 - "Community 222"
Cohesion: 0.43
Nodes (6): AttendantConversation, AttendantConversationStatus, formatPhoneForDisplay(), GET(), mapStatus(), transformConversation()

### Community 223 - "Community 223"
Cohesion: 0.38
Nodes (6): DELETE(), PUT(), RouteParams, updateSchema, removeQuickReply(), updateExistingQuickReply()

### Community 224 - "Community 224"
Cohesion: 0.33
Nodes (6): getOrganizationDetails(), POST(), RequestSchema, SupabaseOrganization, SupabaseOrganizationDetails, SupabaseProject

### Community 225 - "Community 225"
Cohesion: 0.33
Nodes (6): AIStrategy, ExtractedContent, NewTemplateProjectPage(), Step, STRATEGY_CONFIG, useTemplateProjectMutations()

### Community 226 - "Community 226"
Cohesion: 0.38
Nodes (6): ContactFormViewProps, useTypedForm(), useContactFormController(), UseContactFormOptions, ContactForm, contactFormSchema

### Community 227 - "Community 227"
Cohesion: 0.29
Nodes (5): HealthService, HealthStatus, SystemResponse, UsageData, VercelInfo

### Community 228 - "Community 228"
Cohesion: 0.33
Nodes (3): getDb(), getSupabaseDb(), getTestContactLabel()

### Community 229 - "Community 229"
Cohesion: 0.43
Nodes (3): applyFlowMappingToContact(), deepGetResponseValue(), isPlainObject()

### Community 230 - "Community 230"
Cohesion: 0.29
Nodes (6): name, overrides, jsondiffpatch, private, type, version

### Community 231 - "Community 231"
Cohesion: 0.47
Nodes (3): GET(), getOverallHealthStatus(), graphGet()

### Community 232 - "Community 232"
Cohesion: 0.53
Nodes (5): DELETE(), GET(), getClient(), PATCH(), updateAgentSchema

### Community 233 - "Community 233"
Cohesion: 0.47
Nodes (5): GET(), POST(), postSchema, createNewLabel(), listLabels()

### Community 234 - "Community 234"
Cohesion: 0.47
Nodes (5): GET(), POST(), postSchema, createNewQuickReply(), listQuickReplies()

### Community 235 - "Community 235"
Cohesion: 0.40
Nodes (5): getOrganizationDetails(), POST(), RequestSchema, SupabaseOrganization, SupabaseProject

### Community 236 - "Community 236"
Cohesion: 0.47
Nodes (5): GET(), getSettingDirect(), KEYS, POST(), setSettingDirect()

### Community 237 - "Community 237"
Cohesion: 0.60
Nodes (5): escapeCSV(), formatFieldLabel(), formatFieldValue(), formatPhone(), GET()

### Community 238 - "Community 238"
Cohesion: 0.60
Nodes (5): CreateDraftSchema, deriveContentFromSpec(), generateUniqueName(), GET(), POST()

### Community 239 - "Community 239"
Cohesion: 0.67
Nodes (5): GET(), getBearerToken(), isAuthorized(), POST(), reconcilePendingStatusEvents()

### Community 240 - "Community 240"
Cohesion: 0.47
Nodes (4): formatDate(), getTriggerLabel(), WorkflowItem, WorkflowsPage()

### Community 241 - "Community 241"
Cohesion: 0.53
Nodes (5): findComponentByBuilderId(), findComponentByName(), InspectorPanel(), ParsedEditorKey, parseEditorKey()

### Community 242 - "Community 242"
Cohesion: 0.33
Nodes (4): SendFirstMessageStepProps, SendResult, SendStatus, TestContact

### Community 243 - "Community 243"
Cohesion: 0.47
Nodes (5): replaceVariables(), TemplatePreviewRenderer(), TemplatePreviewRendererProps, TemplateButton, TemplateComponent

### Community 244 - "Community 244"
Cohesion: 0.47
Nodes (5): findActiveUrl(), urlsMatch(), WebhookAlertBanner(), WebhookHierarchy, WebhookSubscription

### Community 245 - "Community 245"
Cohesion: 0.53
Nodes (5): useCreateMutation(), useDeleteMutation(), useMutationWithToast(), UseMutationWithToastOptions, useUpdateMutation()

### Community 246 - "Community 246"
Cohesion: 0.60
Nodes (3): ContactFilterCriteria, filterContacts(), matchesContactFilter()

### Community 247 - "Community 247"
Cohesion: 0.60
Nodes (4): createAgentSchema, GET(), getClient(), POST()

### Community 248 - "Community 248"
Cohesion: 0.40
Nodes (3): DELETE(), GET(), RouteParams

### Community 249 - "Community 249"
Cohesion: 0.60
Nodes (4): aggregateTagCountsInMemory(), GET(), isValidTag(), TagCount

### Community 250 - "Community 250"
Cohesion: 0.70
Nodes (4): GET(), normalizeError(), probeTable(), safeUrlHost()

### Community 251 - "Community 251"
Cohesion: 0.50
Nodes (4): corsHeaders(), GET(), Params, leadFormDb

### Community 253 - "Community 253"
Cohesion: 0.40
Nodes (4): SettingsPage(), SystemResponse, UsageData, useUsage()

### Community 254 - "Community 254"
Cohesion: 0.50
Nodes (4): Brand, BRAND_FALLBACK, fetchBrand(), useBrand()

### Community 255 - "Community 255"
Cohesion: 0.40
Nodes (3): InboxChatMessage, RespondToolOutput, UseInboxChatOptions

### Community 256 - "Community 256"
Cohesion: 0.40
Nodes (4): WhatsAppSendMessageResponse, WhatsAppSendTextRequest, WhatsAppWebhookPayload, WhatsAppWebhookVerifyQuery

### Community 257 - "Community 257"
Cohesion: 0.67
Nodes (3): POST(), RouteParams, markAsRead()

### Community 258 - "Community 258"
Cohesion: 0.67
Nodes (3): GET(), querySchema, listConversations()

### Community 261 - "Community 261"
Cohesion: 1.00
Nodes (3): buildDashboardUrl(), buildStoresUrl(), GET()

### Community 262 - "Community 262"
Cohesion: 0.67
Nodes (3): OnboardingPath, WelcomeStep(), WelcomeStepProps

### Community 266 - "Community 266"
Cohesion: 0.50
Nodes (3): framework, headers, $schema

### Community 267 - "Community 267"
Cohesion: 0.67
Nodes (3): CI Job: Tests & Type Check, CI Step: Type Check (tsc --noEmit), CI Step: Unit Tests (Vitest)

### Community 282 - "Community 282"
Cohesion: 0.67
Nodes (3): GET /api/inbox/conversations/{id}/messages, POST /api/inbox/conversations/{id}/messages, Schema: Message

## Knowledge Gaps
- **1439 isolated node(s):** `stepVariants`, `DEFAULT_STATS`, `Attendant`, `MOCK_ATTENDANTS`, `FlowCanvas` (+1434 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `shadcn/ui Primitives` to `Form Dialogs & Buttons`, `Page Layout Patterns`, `Inbox & Conversations`, `Send Flow & Layout Primitives`, `Manual Template Builder`, `Campaign Details View`, `Campaign & Contact Lists`, `Conversation UI`, `AI Agent Form & Inputs`, `AI Agents & Knowledge Base`, `Community 156`, `Community 157`, `Community 158`, `Community 159`, `Campaign Wizard View`, `Quick Replies & Attendants`, `Supabase Realtime Hooks`, `Community 165`, `Flow Form Builder`, `Dashboard Page Chrome`, `Community 175`, `Community 176`, `Self-Install Wizard (Supabase/Vercel)`, `Community 185`, `Community 61`, `Community 191`, `Community 196`, `Community 70`, `Community 79`, `Community 207`, `Community 104`, `Community 240`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `react` connect `shadcn/ui Primitives` to `Meta Diagnostics & Flow Preview`, `Form Dialogs & Buttons`, `Page Layout Patterns`, `Community 135`, `Manual Template Builder`, `AI SDK Dependencies`, `Community 138`, `Template Management`, `Campaign & Contact Lists`, `AI Agent Form & Inputs`, `Community 151`, `Flow Form Builder`, `Dashboard Page Chrome`, `Community 174`, `Community 192`, `Community 67`, `Community 79`, `Community 80`, `Community 87`, `Community 103`, `Community 241`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `dependencies` connect `AI SDK Dependencies` to `shadcn/ui Primitives`, `Community 230`, `Community 143`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `stepVariants`, `DEFAULT_STATS`, `Attendant` to the rest of the system?**
  _1447 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `shadcn/ui Primitives` be split into smaller, more focused modules?**
  _Cohesion score 0.032789670404349304 - nodes in this community are weakly interconnected._
- **Should `Meta Diagnostics & Flow Preview` be split into smaller, more focused modules?**
  _Cohesion score 0.05824111822947001 - nodes in this community are weakly interconnected._
- **Should `Form Dialogs & Buttons` be split into smaller, more focused modules?**
  _Cohesion score 0.06942889137737962 - nodes in this community are weakly interconnected._