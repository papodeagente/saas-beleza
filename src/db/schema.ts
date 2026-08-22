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

export const conversations = pgTable(
  "conversations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id),
    channel: text("channel").notNull().default("whatsapp"),
    externalId: text("external_id"),
    controlledBy: conversationControl("controlled_by").notNull().default("ai"),
    assignedUserId: bigint("assigned_user_id", { mode: "number" }).references(() => users.id),
    status: conversationStatus("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_org_idx").on(t.organizationId, t.lastMessageAt)],
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
    body: text("body").notNull(),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    instructions: text("instructions"),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_agents_org_idx").on(t.organizationId)],
);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_logs_org_idx").on(t.organizationId, t.createdAt)],
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
