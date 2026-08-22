import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const memberRole = pgEnum("member_role", ["owner", "admin", "staff", "professional"]);
export const resourceType = pgEnum("resource_type", ["room", "cabin", "equipment"]);
export const customerSource = pgEnum("customer_source", ["manual", "whatsapp", "public_booking", "ai", "import"]);
export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);
export const appointmentSource = pgEnum("appointment_source", ["admin", "public", "whatsapp", "ai"]);
export const actorType = pgEnum("actor_type", ["user", "ai", "automation", "public", "system"]);
export const paymentMethod = pgEnum("payment_method", [
  "pix",
  "cartao_credito",
  "cartao_debito",
  "dinheiro",
  "transferencia",
  "outro",
]);
export const transactionKind = pgEnum("transaction_kind", ["income", "expense"]);
export const transactionStatus = pgEnum("transaction_status", ["pending", "paid", "overdue", "cancelled"]);
export const conversationControl = pgEnum("conversation_control", ["ai", "human", "waiting"]);
export const conversationStatus = pgEnum("conversation_status", ["open", "closed"]);
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageSender = pgEnum("message_sender", ["customer", "user", "ai", "system"]);
export const waConnectionStatus = pgEnum("wa_connection_status", [
  "disconnected",
  "connecting",
  "connected",
  "error",
]);
export const waMessageType = pgEnum("wa_message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contact",
  "system",
  "unsupported",
]);
export const waMessageStatus = pgEnum("wa_message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
]);
/**
 * Modo de operação do agente, herdado do entur-os-crm:
 *  off      — não roda em lugar nenhum
 *  testing  — roda só no simulador, nunca em conversa real
 *  active   — atende de verdade
 * `enabled` é ortogonal: desligamento de emergência que vence o modo.
 */
export const aiAgentStatus = pgEnum("ai_agent_status", ["off", "testing", "active"]);
export const aiActionResult = pgEnum("ai_action_result", ["ok", "error", "blocked"]);

// ---------------------------------------------------------------------------
// Tenant / identidade
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable(
  "branches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("branches_org_idx").on(t.organizationId)],
);

export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    role: memberRole("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("org_members_unique").on(t.organizationId, t.userId)],
);

// ---------------------------------------------------------------------------
// Profissionais e grade
// ---------------------------------------------------------------------------

export const professionals = pgTable(
  "professionals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    name: text("name").notNull(),
    specialty: text("specialty"),
    color: text("color").notNull().default("#7C2D3E"),
    commissionBps: integer("commission_bps").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("professionals_org_idx").on(t.organizationId)],
);

export const professionalWorkingHours = pgTable(
  "professional_working_hours",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    professionalId: bigint("professional_id", { mode: "number" })
      .notNull()
      .references(() => professionals.id),
    branchId: bigint("branch_id", { mode: "number" })
      .notNull()
      .references(() => branches.id),
    // 0 = domingo … 6 = sábado, no fuso do tenant
    weekday: integer("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [index("pwh_professional_idx").on(t.professionalId, t.weekday)],
);

export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    professionalId: bigint("professional_id", { mode: "number" })
      .notNull()
      .references(() => professionals.id),
    branchId: bigint("branch_id", { mode: "number" }).references(() => branches.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("blocks_professional_idx").on(t.professionalId, t.startsAt)],
);

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("service_categories_org_idx").on(t.organizationId)],
);

export const services = pgTable(
  "services",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    categoryId: bigint("category_id", { mode: "number" }).references(() => serviceCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    commissionBps: integer("commission_bps"),
    requiredResourceType: resourceType("required_resource_type"),
    onlineBooking: boolean("online_booking").notNull().default(true),
    minLeadMinutes: integer("min_lead_minutes").notNull().default(120),
    maxLeadDays: integer("max_lead_days").notNull().default(60),
    // período ideal de retorno (sinal de retenção); null = não recorrente
    returnIntervalDays: integer("return_interval_days"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("services_org_idx").on(t.organizationId)],
);

export const professionalServices = pgTable(
  "professional_services",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    professionalId: bigint("professional_id", { mode: "number" })
      .notNull()
      .references(() => professionals.id),
    serviceId: bigint("service_id", { mode: "number" })
      .notNull()
      .references(() => services.id),
    commissionBps: integer("commission_bps"),
  },
  (t) => [uniqueIndex("professional_services_unique").on(t.professionalId, t.serviceId)],
);

export const resources = pgTable(
  "resources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    branchId: bigint("branch_id", { mode: "number" })
      .notNull()
      .references(() => branches.id),
    name: text("name").notNull(),
    type: resourceType("type").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("resources_branch_idx").on(t.branchId)],
);

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    birthdate: date("birthdate"),
    source: customerSource("source").notNull().default("manual"),
    notes: text("notes"),
    preferredProfessionalId: bigint("preferred_professional_id", { mode: "number" }).references(
      () => professionals.id,
    ),
    preferredBranchId: bigint("preferred_branch_id", { mode: "number" }).references(() => branches.id),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    // agregados mantidos pelos serviços de domínio (nunca editados na UI)
    totalSpentCents: bigint("total_spent_cents", { mode: "number" }).notNull().default(0),
    visitsCount: integer("visits_count").notNull().default(0),
    cancellationsCount: integer("cancellations_count").notNull().default(0),
    noShowCount: integer("no_show_count").notNull().default(0),
    firstVisitAt: timestamp("first_visit_at", { withTimezone: true }),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_org_idx").on(t.organizationId),
    index("customers_org_name_idx").on(t.organizationId, t.name),
    uniqueIndex("customers_org_phone_unique").on(t.organizationId, t.phone).where(sql`phone is not null`),
  ],
);

export const customerTags = pgTable(
  "customer_tags",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("customer_tags_unique").on(t.organizationId, t.name)],
);

export const customerTagLinks = pgTable(
  "customer_tag_links",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => customers.id),
    tagId: bigint("tag_id", { mode: "number" })
      .notNull()
      .references(() => customerTags.id),
  },
  (t) => [uniqueIndex("customer_tag_links_unique").on(t.customerId, t.tagId)],
);

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export const appointments = pgTable(
  "appointments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    branchId: bigint("branch_id", { mode: "number" })
      .notNull()
      .references(() => branches.id),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => customers.id),
    professionalId: bigint("professional_id", { mode: "number" })
      .notNull()
      .references(() => professionals.id),
    serviceId: bigint("service_id", { mode: "number" })
      .notNull()
      .references(() => services.id),
    resourceId: bigint("resource_id", { mode: "number" }).references(() => resources.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("scheduled"),
    priceCents: integer("price_cents").notNull(),
    source: appointmentSource("source").notNull().default("admin"),
    conversationId: bigint("conversation_id", { mode: "number" }),
    notes: text("notes"),
    cancelReason: text("cancel_reason"),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("appointments_org_start_idx").on(t.organizationId, t.startsAt),
    index("appointments_professional_start_idx").on(t.professionalId, t.startsAt),
    index("appointments_customer_idx").on(t.customerId),
  ],
);

export const appointmentHistory = pgTable(
  "appointment_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    appointmentId: bigint("appointment_id", { mode: "number" })
      .notNull()
      .references(() => appointments.id),
    actorType: actorType("actor_type").notNull(),
    actorId: bigint("actor_id", { mode: "number" }),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("appointment_history_appointment_idx").on(t.appointmentId)],
);

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    appointmentId: bigint("appointment_id", { mode: "number" }).references(() => appointments.id),
    customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id),
    method: paymentMethod("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_org_paid_idx").on(t.organizationId, t.paidAt),
    index("payments_appointment_idx").on(t.appointmentId),
  ],
);

export const financialCategories = pgTable(
  "financial_categories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    kind: transactionKind("kind").notNull(),
  },
  (t) => [uniqueIndex("financial_categories_unique").on(t.organizationId, t.name, t.kind)],
);

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    branchId: bigint("branch_id", { mode: "number" }).references(() => branches.id),
    kind: transactionKind("kind").notNull(),
    status: transactionStatus("status").notNull().default("pending"),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDate: date("due_date").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    categoryId: bigint("category_id", { mode: "number" }).references(() => financialCategories.id),
    paymentId: bigint("payment_id", { mode: "number" }).references(() => payments.id),
    appointmentId: bigint("appointment_id", { mode: "number" }).references(() => appointments.id),
    customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("financial_transactions_org_due_idx").on(t.organizationId, t.dueDate)],
);

export const commissions = pgTable(
  "commissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    appointmentId: bigint("appointment_id", { mode: "number" })
      .notNull()
      .references(() => appointments.id)
      .unique(),
    professionalId: bigint("professional_id", { mode: "number" })
      .notNull()
      .references(() => professionals.id),
    baseCents: integer("base_cents").notNull(),
    bps: integer("bps").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("commissions_professional_idx").on(t.professionalId)],
);

// ---------------------------------------------------------------------------
// Mensageria e IA (modeladas desde já; UI nas fases 4–5)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WhatsApp (uazapi) — conexão manual
// ---------------------------------------------------------------------------

/**
 * Conexão com uma instância uazapi que JÁ existe.
 *
 * Diferente do entur-os-crm, aqui não há provisionamento: ninguém chama a API
 * admin do uazapi para criar, cobrar ou cancelar instância. O usuário cola a
 * URL do servidor e o token da instância; o webhook é apontado à mão no painel
 * do uazapi para a URL que a tela mostra.
 */
export const whatsappConnections = pgTable(
  "whatsapp_connections",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull().default("WhatsApp"),
    // Dados colados pelo usuário.
    baseUrl: text("base_url").notNull(),
    instanceToken: text("instance_token").notNull(),
    // Descobertos ao validar o token em /instance/status — nunca digitados.
    instanceId: text("instance_id"),
    instanceName: text("instance_name"),
    phoneNumber: text("phone_number"),
    profileName: text("profile_name"),
    status: waConnectionStatus("status").notNull().default("disconnected"),
    statusDetail: text("status_detail"),
    // Segredo embutido na URL do webhook: o uazapi não assina o payload, então
    // a própria URL é a credencial. Rotacionável sem trocar a conexão.
    webhookToken: text("webhook_token").notNull(),
    webhookSeenAt: timestamp("webhook_seen_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wa_connections_org_idx").on(t.organizationId),
    uniqueIndex("wa_connections_webhook_token_unique").on(t.webhookToken),
  ],
);

/**
 * Log bruto do webhook. Serve para (a) idempotência — o uazapi reentrega o
 * mesmo evento — e (b) depuração de payload real, que foi o que mais custou
 * tempo no entur-os-crm.
 */
export const whatsappWebhookEvents = pgTable(
  "whatsapp_webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    connectionId: bigint("connection_id", { mode: "number" })
      .notNull()
      .references(() => whatsappConnections.id),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    eventType: text("event_type").notNull(),
    // Chave de deduplicação derivada do payload (id da mensagem, em geral).
    dedupeKey: text("dedupe_key"),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wa_webhook_events_conn_idx").on(t.connectionId, t.createdAt),
    uniqueIndex("wa_webhook_events_dedupe_unique")
      .on(t.connectionId, t.dedupeKey)
      .where(sql`dedupe_key is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id),
    connectionId: bigint("connection_id", { mode: "number" }).references(() => whatsappConnections.id),
    channel: text("channel").notNull().default("whatsapp"),
    // Identidade no WhatsApp. `remoteJid` é a chave real da conversa; o telefone
    // é derivado dele e pode faltar (grupos, LID).
    remoteJid: text("remote_jid"),
    phone: text("phone"),
    isGroup: boolean("is_group").notNull().default(false),
    contactName: text("contact_name"),
    profilePicUrl: text("profile_pic_url"),
    externalId: text("external_id"),
    controlledBy: conversationControl("controlled_by").notNull().default("ai"),
    /**
     * Fila do inbox. Regra herdada do entur-os-crm: mensagem nova joga a
     * conversa na fila se ela não estiver em "Meus"; `lastAssignedUserId`
     * preserva quem atendeu por último apenas como contexto, sem atribuir.
     */
    assignedUserId: bigint("assigned_user_id", { mode: "number" }).references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    lastAssignedUserId: bigint("last_assigned_user_id", { mode: "number" }).references(() => users.id),
    status: conversationStatus("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: bigint("resolved_by_user_id", { mode: "number" }).references(() => users.id),
    // Pausa do agente NESTA conversa. Enquanto preenchido, nenhum caminho de
    // envio automático dispara — regra inviolável trazida do entur-os-crm.
    aiPausedAt: timestamp("ai_paused_at", { withTimezone: true }),
    aiPausedByUserId: bigint("ai_paused_by_user_id", { mode: "number" }).references(() => users.id),
    // Marca-d'água do último inbound já respondido pelo agente. Avança de forma
    // síncrona no envio para que um retry não gere resposta duplicada.
    aiLastProcessedInboundAt: timestamp("ai_last_processed_inbound_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_org_idx").on(t.organizationId, t.lastMessageAt),
    index("conversations_org_assigned_idx").on(t.organizationId, t.assignedUserId, t.lastMessageAt),
    uniqueIndex("conversations_org_jid_unique")
      .on(t.organizationId, t.remoteJid)
      .where(sql`remote_jid is not null`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    conversationId: bigint("conversation_id", { mode: "number" })
      .notNull()
      .references(() => conversations.id),
    direction: messageDirection("direction").notNull(),
    sender: messageSender("sender").notNull(),
    // Quem apertou enviar, quando foi humano. Nulo em mensagem do agente — é
    // esse contraste que o gate "humano assumiu" usa para pausar a IA.
    senderUserId: bigint("sender_user_id", { mode: "number" }).references(() => users.id),
    body: text("body").notNull().default(""),
    messageType: waMessageType("message_type").notNull().default("text"),
    status: waMessageStatus("status").notNull().default("sent"),
    // id da mensagem no provedor; é a chave de deduplicação do webhook.
    externalId: text("external_id"),
    quotedExternalId: text("quoted_external_id"),
    mediaUrl: text("media_url"),
    mediaMimeType: text("media_mime_type"),
    mediaFileName: text("media_file_name"),
    mediaSizeBytes: bigint("media_size_bytes", { mode: "number" }),
    // Texto do áudio, preenchido em background. O agente só responde depois
    // que a transcrição existe.
    audioTranscription: text("audio_transcription"),
    errorMessage: text("error_message"),
    // Horário do provedor, que pode divergir do nosso relógio.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("messages_org_external_unique")
      .on(t.organizationId, t.externalId)
      .where(sql`external_id is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Agente de IA
// ---------------------------------------------------------------------------

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    connectionId: bigint("connection_id", { mode: "number" }).references(() => whatsappConnections.id),
    name: text("name").notNull(),
    status: aiAgentStatus("status").notNull().default("off"),
    // Kill-switch de emergência, ortogonal ao status.
    enabled: boolean("enabled").notNull().default(false),
    instructions: text("instructions"),
    model: text("model").notNull().default("gpt-5-chat-latest"),
    temperature: integer("temperature").notNull().default(70), // centésimos: 70 = 0.7
    maxOutputTokens: integer("max_output_tokens").notNull().default(600),
    // Janela de agrupamento: espera o cliente terminar de digitar antes de
    // responder, para não responder frase por frase.
    debounceWindowSeconds: integer("debounce_window_seconds").notNull().default(8),
    // Intervalo mínimo entre duas respostas na mesma conversa.
    responseDelaySeconds: integer("response_delay_seconds").notNull().default(0),
    // Silencia o agente assim que um humano responde na conversa.
    pauseOnHumanReply: boolean("pause_on_human_reply").notNull().default(true),
    respondGroups: boolean("respond_groups").notNull().default(false),
    // Fora do horário o agente continua respondendo, mas com o aviso abaixo.
    businessHoursOnly: boolean("business_hours_only").notNull().default(false),
    outOfHoursMessage: text("out_of_hours_message"),
    handoffMessage: text("handoff_message"),
    maxTurnsPerMinutePerOrg: integer("max_turns_per_minute_per_org").notNull().default(30),
    maxTurnsPerMinutePerContact: integer("max_turns_per_minute_per_contact").notNull().default(3),
    maxConcurrentTurns: integer("max_concurrent_turns").notNull().default(3),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_agents_org_idx").on(t.organizationId)],
);

/**
 * Gate real das ferramentas: o prompt pode pedir o que quiser, mas a execução
 * só acontece se a permissão estiver ligada aqui.
 */
export const aiAgentPermissions = pgTable(
  "ai_agent_permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: bigint("agent_id", { mode: "number" })
      .notNull()
      .references(() => aiAgents.id),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    // Leitura
    readCustomer: boolean("read_customer").notNull().default(true),
    readAppointments: boolean("read_appointments").notNull().default(true),
    readServices: boolean("read_services").notNull().default(true),
    readAvailability: boolean("read_availability").notNull().default(true),
    readKnowledge: boolean("read_knowledge").notNull().default(true),
    // Escrita
    createAppointment: boolean("create_appointment").notNull().default(false),
    rescheduleAppointment: boolean("reschedule_appointment").notNull().default(false),
    cancelAppointment: boolean("cancel_appointment").notNull().default(false),
    updateCustomer: boolean("update_customer").notNull().default(false),
    addNote: boolean("add_note").notNull().default(true),
    transferToHuman: boolean("transfer_to_human").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_agent_permissions_agent_unique").on(t.agentId)],
);

/** Base de conhecimento consultada pela ferramenta `search_knowledge`. */
export const aiAgentKnowledge = pgTable(
  "ai_agent_knowledge",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    agentId: bigint("agent_id", { mode: "number" }).references(() => aiAgents.id),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tags: jsonb("tags"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_agent_knowledge_org_idx").on(t.organizationId, t.active)],
);

/** Uma nota viva por cliente, mantida pelo agente (nunca duplicada). */
export const aiAgentCustomerMemos = pgTable(
  "ai_agent_customer_memos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => customers.id),
    content: text("content").notNull(),
    facts: jsonb("facts"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_agent_memos_customer_unique").on(t.organizationId, t.customerId)],
);

/** Tudo que o agente executou — a trilha que explica uma resposta. */
export const aiExecutionLogs = pgTable(
  "ai_execution_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    agentId: bigint("agent_id", { mode: "number" }).references(() => aiAgents.id),
    conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id),
    tool: text("tool").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    ok: boolean("ok").notNull(),
    result: aiActionResult("result").notNull().default("ok"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_logs_org_idx").on(t.organizationId, t.createdAt)],
);

/** Consumo por turno: modelo, tokens e custo estimado. */
export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    agentId: bigint("agent_id", { mode: "number" }).references(() => aiAgents.id),
    conversationId: bigint("conversation_id", { mode: "number" }).references(() => conversations.id),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_org_idx").on(t.organizationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Eventos e auditoria
// ---------------------------------------------------------------------------

export const domainEvents = pgTable(
  "domain_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("domain_events_pending_idx").on(t.processedAt, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    actorType: actorType("actor_type").notNull(),
    actorId: bigint("actor_id", { mode: "number" }),
    entity: text("entity").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_idx").on(t.organizationId, t.createdAt)],
);
