import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
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
/**
 * Quem começou a conversa: a clínica pela tela, ou uma automação.
 *
 * Existe separado de `startedByUserId` porque a automação não tem usuário. As
 * duas alternativas foram descartadas de propósito: um "usuário de sistema" na
 * tabela `users` apareceria na lista da equipe, no seletor de responsável e nas
 * permissões — dado falso que todo o resto do produto teria de aprender a
 * esconder; e continuar contando por `startedByUserId` deixa o envio automático
 * INVISÍVEL para o teto de vazão, que é exatamente o furo que permitiu a
 * rajada. Aqui a coluna nomeia a ORIGEM, e `startedByUserId` continua nomeando
 * a pessoa quando existe uma.
 */
export const conversationOrigin = pgEnum("conversation_origin", ["user", "automation"]);
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
export const scheduledMessageStatus = pgEnum("scheduled_message_status", [
  "pending",
  "sent",
  "failed",
  "cancelled",
]);
export const automationTrigger = pgEnum("automation_trigger", [
  "appointment_created",
  "before_appointment",
  "appointment_day",
  "after_appointment",
  "after_purchase",
  "birthday_before",
  "birthday_day",
]);
export const automationDispatchStatus = pgEnum("automation_dispatch_status", [
  "processing",
  "sent",
  "failed",
  "skipped",
]);
/**
 * Como o grupo é tratado pela clínica. Com centenas de grupos, é o que separa
 * o que merece atenção do que é só ruído.
 */
export const waGroupClassification = pgEnum("wa_group_classification", [
  "none",
  "radar",
  "opportunity",
  "private",
]);

// ---------------------------------------------------------------------------
// Tenant / identidade
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * Código da conta, no formato XXXX-XXXX.
   *
   * É o identificador que o cliente dita para o suporte e que o operador da
   * plataforma usa para achar a conta. Não é o id (sequencial, revela o tamanho
   * do SaaS e se confunde ao ser lido) nem o slug (muda junto com o nome da
   * clínica). Este nunca muda.
   *
   * Sem `.default()` aqui de propósito: assim o TypeScript exige o valor em
   * todo insert e nenhum caminho novo nasce sem código. O banco também tem um
   * DEFAULT (migration 0025), que cobre só o insert feito por SQL cru, fora da
   * aplicação — ele não aparece neste schema porque o drizzle-kit compara
   * snapshots, não o banco, e declará-lo aqui derrubaria a exigência do
   * compilador.
   */
  publicId: text("public_id").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  /**
   * Suspensão é decisão da plataforma (inadimplência, abuso) e bloqueia o
   * login da clínica inteira. Separada do status da assinatura de propósito:
   * uma conta pode estar cancelada comercialmente e ainda ter acesso até o fim
   * do período pago.
   */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
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
  /**
   * WhatsApp de quem assina, só dígitos. É o único canal pelo qual a plataforma
   * alcança a clínica durante o teste — e-mail de dono de clínica costuma ficar
   * sem resposta. Nulo de propósito: usuário criado pelo painel ou antes do
   * autocadastro não tem telefone, e exigir um quebraria o cadastro interno.
   */
  phone: text("phone"),
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

/** Unidades que um usuário pode operar. Ausência de linhas mantém acesso global legado. */
export const organizationMemberBranches = pgTable(
  "organization_member_branches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    branchId: bigint("branch_id", { mode: "number" })
      .notNull()
      .references(() => branches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_member_branches_unique").on(t.organizationId, t.userId, t.branchId),
    index("org_member_branches_user_idx").on(t.organizationId, t.userId),
  ],
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

/** Produtos de revenda/consumo exibidos no catálogo, separados dos serviços agendáveis. */
export const products = pgTable(
  "products",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    categoryId: bigint("category_id", { mode: "number" }).references(() => serviceCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku"),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    stockQty: integer("stock_qty").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_org_idx").on(t.organizationId), index("products_sku_idx").on(t.organizationId, t.sku)],
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

/** Acesso anônimo ao link público, deduplicado por navegador e dia. */
export const bookingPageVisits = pgTable(
  "booking_page_visits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    visitorToken: text("visitor_token").notNull(),
    visitDate: date("visit_date").notNull(),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("booking_visits_daily_unique").on(t.organizationId, t.visitorToken, t.visitDate),
    index("booking_visits_org_date_idx").on(t.organizationId, t.visitDate),
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
    // QR de pareamento. Fica no banco porque a uazapi emite um novo por webhook
    // quando o anterior expira: guardar o último é o que permite a tela mostrar
    // sempre um código válido, sem pedir outro a cada expiração.
    pairingQrCode: text("pairing_qr_code"),
    pairingCode: text("pairing_code"),
    pairingUpdatedAt: timestamp("pairing_updated_at", { withTimezone: true }),
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
    // Tentativas já gastas com este evento.
    //
    // A rota passou a devolver 503 quando a confirmação de entrega chega antes
    // da mensagem existir, para que a uazapi reentregue e a segunda tentativa
    // encontre a linha. Sem um teto, um evento que NUNCA vai casar (confirmação
    // de mensagem de um chat que não ingerimos) seria reentregue para sempre.
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wa_webhook_events_conn_idx").on(t.connectionId, t.createdAt),
    // Sem cláusula parcial de propósito: o Postgres já trata NULL como valor
    // distinto, então eventos sem chave de deduplicação convivem, e um índice
    // completo é o que o ON CONFLICT consegue usar.
    uniqueIndex("wa_webhook_events_dedupe_unique").on(t.connectionId, t.dedupeKey),
  ],
);

/**
 * O que é nosso sobre um grupo do WhatsApp.
 *
 * O grupo em si vive no WhatsApp e é lido de lá a cada abertura — aqui ficam
 * só as decisões da clínica sobre ele (classificação, fixado) e o último
 * retrato conhecido, que serve para ordenar a lista antes da resposta chegar.
 */
export const whatsappGroups = pgTable(
  "whatsapp_groups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    connectionId: bigint("connection_id", { mode: "number" }).references(() => whatsappConnections.id),
    jid: text("jid").notNull(),
    name: text("name"),
    description: text("description"),
    participantCount: integer("participant_count").notNull().default(0),
    classification: waGroupClassification("classification").notNull().default("none"),
    pinned: boolean("pinned").notNull().default(false),
    /** Resumo mais recente gerado pela IA, com a hora em que foi feito. */
    lastSummary: text("last_summary"),
    lastSummaryAt: timestamp("last_summary_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Retrato do provedor — ver ProviderChatSnapshot. Cache, não verdade. */
    providerPreview: text("provider_preview"),
    providerPreviewType: text("provider_preview_type"),
    providerLastSender: text("provider_last_sender"),
    providerLastAt: timestamp("provider_last_at", { withTimezone: true }),
    providerUnread: integer("provider_unread"),
    providerArchived: boolean("provider_archived").notNull().default(false),
    providerSyncedAt: timestamp("provider_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wa_groups_org_jid_unique").on(t.organizationId, t.jid),
    index("wa_groups_org_classification_idx").on(t.organizationId, t.classification),
  ],
);

/**
 * Mensagem programada para um grupo.
 *
 * O arquivo é guardado aqui em base64 porque não há storage: uma foto de
 * celular são poucos megabytes e o banco aguenta, enquanto montar storage só
 * para isso seria uma peça de infraestrutura a mais para manter. O teto é
 * menor que o do envio imediato justamente por isso.
 *
 * O envio é decidido por varredura periódica, não por um temporizador em
 * memória: assim uma reinicialização do servidor não engole o agendamento.
 */
export const scheduledGroupMessages = pgTable(
  "scheduled_group_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    groupJid: text("group_jid").notNull(),
    groupName: text("group_name"),
    body: text("body").notNull().default(""),
    mediaKind: waMessageType("media_kind"),
    /** Arquivo em data URI. Nulo quando é só texto. */
    mediaData: text("media_data"),
    mediaFileName: text("media_file_name"),
    /** Marca todo mundo do grupo no envio. */
    mentionAll: boolean("mention_all").notNull().default(false),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: scheduledMessageStatus("status").notNull().default("pending"),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scheduled_group_org_idx").on(t.organizationId, t.groupJid, t.scheduledFor),
    // Índice da varredura: só o que está pendente e já venceu importa.
    index("scheduled_group_due_idx").on(t.status, t.scheduledFor),
  ],
);

/** Regras simples de relacionamento, calculadas no fuso da clínica. */
export const automationRules = pgTable(
  "automation_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    trigger: automationTrigger("trigger").notNull(),
    /** Sempre positivo; o gatilho define se é antes ou depois. */
    daysOffset: integer("days_offset").notNull().default(0),
    sendTime: time("send_time").notNull().default("09:00"),
    messageTemplate: text("message_template").notNull(),
    active: boolean("active").notNull().default(true),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("automation_rules_org_idx").on(t.organizationId, t.active),
    /**
     * Uma automação ATIVA por gatilho, por conta.
     *
     * A checagem em `createAutomationRule` é a que dá a mensagem legível; este
     * índice é o que torna a regra verdadeira sob concorrência — dois cliques
     * simultâneos passariam pelos dois SELECTs e gravariam as duas linhas. Foi
     * assim que a conta 550 acumulou as regras 1, 2 e 3 no mesmo gatilho e a
     * mesma cliente recebeu o mesmo lembrete três vezes (disparos 1, 4 e 7,
     * agendamento 1326). Parcial em `active` de propósito: regra pausada é
     * histórico, e histórico pode repetir gatilho à vontade.
     */
    uniqueIndex("automation_rules_active_trigger_unique")
      .on(t.organizationId, t.trigger)
      .where(sql`${t.active}`),
  ],
);

/** Livro-razão de disparos: a chave única impede mensagem duplicada. */
export const automationDispatches = pgTable(
  "automation_dispatches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    ruleId: bigint("rule_id", { mode: "number" })
      .notNull()
      .references(() => automationRules.id),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => customers.id),
    sourceType: text("source_type").notNull(),
    sourceId: bigint("source_id", { mode: "number" }).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: automationDispatchStatus("status").notNull().default("processing"),
    attempts: integer("attempts").notNull().default(1),
    /** Instante da última tentativa. É o relógio do recuo progressivo. */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    message: text("message").notNull(),
    /** Motivo em português, o que a dona do salão lê na tela. */
    error: text("error"),
    /**
     * Código da falha. É por ele que a varredura decide RETENTAR ou desistir —
     * "número não tem WhatsApp" não melhora com insistência, e `ENVIO_INCERTO`
     * (o provedor aceitou e algo quebrou depois) não pode ser retentado nunca,
     * sob pena de a cliente receber a mesma mensagem duas vezes.
     */
    errorCode: text("error_code"),
    /** Erro cru do provedor (status + corpo). O `error` é para gente; este é para depurar. */
    errorDetail: text("error_detail"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("automation_dispatch_source_unique").on(t.ruleId, t.sourceType, t.sourceId),
    index("automation_dispatch_org_idx").on(t.organizationId, t.createdAt),
    // Varredura de retentativa: procura por situação e pela hora da última tentativa.
    index("automation_dispatch_retry_idx").on(t.status, t.lastAttemptAt),
  ],
);

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Retrato que o WhatsApp tem do chat, guardado para a lista abrir sem esperar
 * a rede.
 *
 * `/chat/find` devolve, numa chamada só, o que o aparelho mostra na lista:
 * última mensagem, tipo, quem falou, quando e quantas faltam ler. Sem guardar
 * isso, a tela só sabia falar das conversas cujas mensagens passaram pelo
 * nosso webhook — 271 dos 298 grupos apareciam como "sem mensagens por aqui"
 * enquanto o telefone sabia o que tinha sido dito em cada um.
 *
 * É CACHE, não fonte da verdade: quando existe mensagem nossa mais recente,
 * ela vence. Estes campos preenchem o buraco do histórico que nunca passou
 * por aqui.
 */
export type ProviderChatSnapshot = {
  preview: string | null;
  previewType: string | null;
  lastSender: string | null;
  lastAt: Date | null;
  unread: number;
  archived: boolean;
};

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
    /**
     * Quem abriu a conversa pelo painel. Nulo quando ela nasceu de uma mensagem
     * recebida, que é a origem da esmagadora maioria delas.
     *
     * Não é enfeite de auditoria: é o contador do limite de vazão do envio
     * ativo. Sem uma marca de origem, "quantas conversas nós começamos na última
     * hora" viraria "quantas conversas foram criadas na última hora", e uma
     * clínica movimentada estouraria o limite só por RECEBER mensagem.
     */
    startedByUserId: bigint("started_by_user_id", { mode: "number" }).references(() => users.id),
    /**
     * Origem da conversa que NÓS abrimos. Nulo quando ela nasceu de mensagem
     * recebida — que continua não contando para o teto de vazão.
     *
     * Esta coluna, e não `startedByUserId`, é o contador: a automação envia sem
     * usuário, então enquanto a contagem olhava para o autor humano o disparo
     * automático abria conversas ilimitadas sem nunca aparecer no limite.
     */
    startedBy: conversationOrigin("started_by"),
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
    /** Retrato do provedor — ver ProviderChatSnapshot. Cache, não verdade. */
    providerPreview: text("provider_preview"),
    providerPreviewType: text("provider_preview_type"),
    providerLastSender: text("provider_last_sender"),
    providerLastAt: timestamp("provider_last_at", { withTimezone: true }),
    providerUnread: integer("provider_unread"),
    providerArchived: boolean("provider_archived").notNull().default(false),
    providerSyncedAt: timestamp("provider_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_org_idx").on(t.organizationId, t.lastMessageAt),
    index("conversations_org_assigned_idx").on(t.organizationId, t.assignedUserId, t.lastMessageAt),
    uniqueIndex("conversations_org_jid_unique").on(t.organizationId, t.remoteJid),
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
    // Em grupo, a mensagem é de uma pessoa dentro dele: sem isso a conversa
    // vira um monólogo de vozes anônimas.
    senderName: text("sender_name"),
    senderPhone: text("sender_phone"),
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
    // Reações no formato [{emoji, from, at}]. Uma pessoa tem no máximo uma
    // reação por mensagem, então a lista é reescrita a cada evento.
    reactions: jsonb("reactions"),
    // Apagada para todos no WhatsApp. A linha continua aqui para o histórico
    // não ganhar buracos, e a tela mostra que foi apagada.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    // Horário do provedor, que pode divergir do nosso relógio.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    // Índice completo (ver comentário em whatsapp_webhook_events): mensagem
    // interna sem id de provedor continua permitida, e a deduplicação do
    // webhook passa a funcionar.
    uniqueIndex("messages_org_external_unique").on(t.organizationId, t.externalId),
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

// ---------------------------------------------------------------------------
// Plataforma — o SaaS cobrando das clínicas.
//
// ATENÇÃO À NOMENCLATURA: `payments` e `financial_transactions` são da CLÍNICA
// cobrando o cliente final. Tudo aqui é a Lumina cobrando a clínica. Misturar
// os dois contamina o financeiro do tenant e o MRR da plataforma de uma vez.
// ---------------------------------------------------------------------------

export const billingCycle = pgEnum("billing_cycle", ["monthly", "yearly"]);

export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
]);

/**
 * O log de eventos é a fonte de verdade do MOVIMENTO de MRR (novo, expansão,
 * contração, churn). O valor atual sai da soma das assinaturas ativas; a
 * variação do mês só é reconstituível se cada mudança guardar o MRR antes e
 * depois dela.
 */
export const subscriptionEventKind = pgEnum("subscription_event_kind", [
  "trial_started",
  "trial_converted",
  "created",
  "renewed",
  "upgraded",
  "downgraded",
  "cycle_changed",
  "past_due",
  "recovered",
  "canceled",
  "reactivated",
]);

export const paymentProviderKind = pgEnum("payment_provider_kind", [
  "hotmart",
  "asaas",
  "pagarme",
  "cakto",
  "stripe",
  "manual",
]);

export const platformChargeStatus = pgEnum("platform_charge_status", [
  "pending",
  "paid",
  "refunded",
  "chargeback",
  "failed",
]);

/** Acesso ao painel da plataforma. Nunca inferido de ser dono de uma clínica. */
export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id)
      .unique(),
    grantedByUserId: bigint("granted_by_user_id", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const plans = pgTable(
  "plans",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    /** Preço do ano inteiro, não do mês equivalente. */
    yearlyPriceCents: integer("yearly_price_cents").notNull(),
    trialDays: integer("trial_days").notNull().default(14),
    maxBranches: integer("max_branches"),
    maxProfessionals: integer("max_professionals"),
    maxUsers: integer("max_users"),
    /** Benefícios exibidos no cartão de preço do site, na ordem em que aparecem. */
    features: jsonb("features").$type<string[]>(),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),

    // -- Vitrine pública ----------------------------------------------------
    /**
     * `active` diz se o plano ACEITA nova assinatura; isto diz se ele APARECE
     * no site. São decisões diferentes: um preço negociado continua vendável
     * pelo painel e fora do ar, e um plano descontinuado some do site sem
     * quebrar quem já assina.
     *
     * O padrão é `false` de propósito: publicar preço é decisão de quem manda,
     * não efeito colateral de rodar a migração.
     */
    publicVisible: boolean("public_visible").notNull().default(false),
    /** Chamada curta do cartão. `description` continua sendo a frase do painel. */
    tagline: text("tagline"),
    highlight: boolean("highlight").notNull().default(false),
    highlightLabel: text("highlight_label"),
    ctaLabel: text("cta_label"),
    /**
     * Um link por ciclo, não um só: a Hotmart emite uma oferta por periodicidade,
     * então um campo único deixaria o botão do anual levando ao preço do mensal.
     * Vazio faz o botão cair no teste grátis, que é o que converte enquanto o
     * meio de pagamento não está ligado.
     */
    checkoutUrlMonthly: text("checkout_url_monthly"),
    checkoutUrlYearly: text("checkout_url_yearly"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Estes dois campos viram o `href` de um botão numa página PÚBLICA. Um
     * `javascript:` colado aqui não é um link torto: é execução de script no
     * navegador de quem visita o site.
     *
     * O formulário já recusa, e o serviço da vitrine ainda filtra na leitura —
     * mas as duas defesas moram na aplicação. Esta é a única que sobrevive a um
     * UPDATE feito direto no banco, num script de importação ou numa rota nova
     * que alguém escreva daqui a um ano sem ler o resto.
     */
    check(
      "plans_checkout_urls_https",
      sql`(${t.checkoutUrlMonthly} is null or ${t.checkoutUrlMonthly} like 'https://%')
        and (${t.checkoutUrlYearly} is null or ${t.checkoutUrlYearly} like 'https://%')`,
    ),
  ],
);

/**
 * Tentativas de autocadastro, para segurar abuso.
 *
 * Vive no banco e não só em memória porque o processo reinicia a cada deploy e
 * um limitador que zera sozinho não limita nada. Guarda o IP e o e-mail
 * tentado — nunca a senha.
 */
/**
 * Foto de perfil do WhatsApp, guardada como BYTES e não como link.
 *
 * A uazapi devolve uma URL em `pps.whatsapp.net`, e essa URL expira: guardar o
 * link daria uma lista de avatares que funciona hoje e quebra na semana que vem,
 * em silêncio. Guardando a miniatura (2,6 KB em JPEG, medido) a foto vira nossa
 * e para de depender do CDN de terceiro.
 *
 * Há um segundo motivo, menos óbvio e mais importante: servir a imagem do nosso
 * domínio significa que o navegador da clínica nunca conta ao WhatsApp qual
 * cliente está sendo aberto na tela.
 *
 * A imagem em alta resolução (`image`) não entra aqui de propósito — ela
 * responde 403 para quem não é o aparelho pareado. Só a miniatura é buscável.
 *
 * `missing` distingue "ainda não perguntamos" de "perguntamos e esta pessoa não
 * tem foto (ou escondeu por privacidade)". Sem isso, todo carregamento do inbox
 * bateria na uazapi de novo para os mesmos contatos sem foto.
 */
export const whatsappProfilePictures = pgTable(
  "whatsapp_profile_pictures",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    /** Chave real da conversa: `...@s.whatsapp.net` ou `...@g.us`. */
    jid: text("jid").notNull(),
    mime: text("mime"),
    /** Base64 da miniatura. Nulo quando `missing`. */
    dataBase64: text("data_base64"),
    missing: boolean("missing").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wa_profile_pictures_unique").on(t.organizationId, t.jid)],
);

/**
 * Quem é `66700892492020@lid`.
 *
 * Em grupo o WhatsApp não diz o telefone de quem falou: diz uma identidade
 * opaca (`@lid`), diferente para cada pessoa e sem nada legível dentro. Sem uma
 * tradução, a lista de grupos só teria dois caminhos, e os dois são ruins:
 * mostrar o número cru (que não diz nada a ninguém) ou omitir o autor (e aí
 * "Amanhã fecha" perde metade do sentido, porque em grupo importa quem disse).
 *
 * A tradução sai de graça de uma observação: quem fala nos grupos do dono
 * costuma ter conversa direta com ele, e a lista de conversas do aparelho
 * entrega o par `@lid` ↔ nome nessa conversa. Uma varredura das conversas
 * diretas vira este catálogo — 1.243 nomes na conta medida, que resolveram 54
 * dos 90 remetentes de grupo (60%).
 *
 * Os 40% restantes não têm conserto barato (é gente que nunca falou direto com
 * o dono), e a lista trata isso como o normal que é: sem nome, mostra só a
 * mensagem. Nunca o número.
 */
export const whatsappIdentities = pgTable(
  "whatsapp_identities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    /** Como o WhatsApp chama esta pessoa: `<id>@lid` ou `<fone>@s.whatsapp.net`. */
    jid: text("jid").notNull(),
    /** Só dígitos, quando o JID carrega telefone. Nulo em LID. */
    phone: text("phone"),
    name: text("name").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wa_identities_org_jid_unique").on(t.organizationId, t.jid),
    index("wa_identities_org_phone_idx").on(t.organizationId, t.phone),
  ],
);

export const signupAttempts = pgTable(
  "signup_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    email: text("email"),
    outcome: text("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signup_attempts_ip_idx").on(t.ip, t.createdAt)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id)
      .unique(),
    planId: bigint("plan_id", { mode: "number" })
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus("status").notNull().default("trialing"),
    cycle: billingCycle("cycle").notNull().default("monthly"),
    /** Preço travado na contratação: o plano pode mudar de preço depois. */
    priceCents: integer("price_cents").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    providerId: bigint("provider_id", { mode: "number" }),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_status_idx").on(t.status),
    index("subscriptions_plan_idx").on(t.planId),
  ],
);

export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    subscriptionId: bigint("subscription_id", { mode: "number" }).references(() => subscriptions.id),
    kind: subscriptionEventKind("kind").notNull(),
    /** MRR normalizado (mensal) antes e depois — é o que permite o movimento. */
    mrrBeforeCents: integer("mrr_before_cents").notNull().default(0),
    mrrAfterCents: integer("mrr_after_cents").notNull().default(0),
    planIdBefore: bigint("plan_id_before", { mode: "number" }),
    planIdAfter: bigint("plan_id_after", { mode: "number" }),
    source: text("source").notNull().default("system"),
    note: text("note"),
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscription_events_occurred_idx").on(t.occurredAt),
    index("subscription_events_org_idx").on(t.organizationId, t.occurredAt),
  ],
);

export const paymentProviders = pgTable(
  "payment_providers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: paymentProviderKind("kind").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /**
     * O token do webhook é guardado como HASH: ele só serve para comparar o que
     * chega, nunca para ser lido de volta. Credenciais que precisam ser usadas
     * para chamar a API do provedor ficam em `credentials` — ver a dívida de
     * cifragem em docs/product-architecture.md.
     */
    webhookTokenHash: text("webhook_token_hash"),
    webhookTokenHint: text("webhook_token_hint"),
    credentials: jsonb("credentials"),
    config: jsonb("config"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_providers_kind_unique").on(t.kind)],
);

/** Cobrança da plataforma contra a clínica. */
export const platformCharges = pgTable(
  "platform_charges",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    subscriptionId: bigint("subscription_id", { mode: "number" }).references(() => subscriptions.id),
    providerId: bigint("provider_id", { mode: "number" }).references(() => paymentProviders.id),
    status: platformChargeStatus("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    externalId: text("external_id"),
    dueDate: date("due_date"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_charges_org_idx").on(t.organizationId, t.createdAt)],
);

/** Entrega bruta de webhook. Guardada antes de processar, para poder reprocessar. */
export const platformWebhookEvents = pgTable(
  "platform_webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    providerId: bigint("provider_id", { mode: "number" }).references(() => paymentProviders.id),
    kind: paymentProviderKind("kind").notNull(),
    externalId: text("external_id"),
    eventName: text("event_name"),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("platform_webhook_received_idx").on(t.receivedAt),
    uniqueIndex("platform_webhook_external_unique").on(t.kind, t.externalId),
  ],
);
