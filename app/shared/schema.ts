import { pgTable, text, uuid, timestamp, decimal, integer, varchar, boolean } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// Users table - Bank staff and customers
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  uniqueId: varchar('name',{length:100}),
  riskLevel: varchar('name',{length:100}),
  email: varchar('email', { length: 150 }).unique().notNull(),
  phone: varchar('phone', { length: 20 }),
  role: varchar('role', { length: 50 }).notNull().default('Account Holder'),
  // Account Holder, Bank Teller, Bank Manager, Administrator
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  fullName: varchar('full_name', { length: 200 }),
  ssn: varchar('ssn', { length: 11 }),
  dateOfBirth: timestamp('date_of_birth'),
  homeAddress: text('home_address'),
  alternatePhone: varchar('alternate_phone', { length: 20 }),
  employerName: varchar('employer_name', { length: 200 }),
  annualIncome: decimal('annual_income', { precision: 15, scale: 2 }),
  creditScore: integer('credit_score'),
  identityVerified: varchar('identity_verified', { length: 20 }).default('pending'),
  kycCompleted: varchar('kyc_completed', { length: 20 }).default('pending'),
  pendingProfileChanges: text('pending_profile_changes'),
  lastProfileUpdate: timestamp('last_profile_update'),
  profileUpdatedBy: uuid('profile_updated_by'),
  clearanceLevel: integer('clearance_level'),
  department: varchar('department', { length: 100 }),
  branchId: varchar('branch_id', { length: 50 }),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  accountNumber: varchar('account_number', { length: 20 }).unique().notNull(),
  accountType: varchar('account_type', { length: 50 }).notNull(),
  balance: decimal('balance', { precision: 15, scale: 2 }).notNull().default('0.00'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  interestRate: decimal('interest_rate', { precision: 5, scale: 4 }).default('0.0000'),
  compoundingFrequency: varchar('compounding_frequency', { length: 20 }).default('monthly'),
  monthlyFee: decimal('monthly_fee', { precision: 10, scale: 2 }).default('0.00'),
  transactionFee: decimal('transaction_fee', { precision: 10, scale: 2 }).default('0.00'),
  overdraftFee: decimal('overdraft_fee', { precision: 10, scale: 2 }).default('35.00'),
  minimumBalanceFee: decimal('minimum_balance_fee', { precision: 10, scale: 2 }).default('0.00'),
  minimumBalance: decimal('minimum_balance', { precision: 15, scale: 2 }).default('0.00'),
  maximumBalance: decimal('maximum_balance', { precision: 15, scale: 2 }).default('250000.00'),
  dailyWithdrawalLimit: decimal('daily_withdrawal_limit', { precision: 15, scale: 2 }).default('1000.00'),
  monthlyTransactionLimit: integer('monthly_transaction_limit').default(50),
  overdraftLimit: decimal('overdraft_limit', { precision: 15, scale: 2 }).default('0.00'),
  overdraftProtection: boolean('overdraft_protection').default(false),
  creditLimit: decimal('credit_limit', { precision: 15, scale: 2 }).default('0.00'),
  availableCredit: decimal('available_credit', { precision: 15, scale: 2 }).default('0.00'),
  onlineBanking: boolean('online_banking').default(true),
  mobileBanking: boolean('mobile_banking').default(true),
  debitCard: boolean('debit_card').default(true),
  checksEnabled: boolean('checks_enabled').default(true),
  wireTransfers: boolean('wire_transfers').default(true),
  internationalTransfers: boolean('international_transfers').default(false),
  branchCode: varchar('branch_code', { length: 10 }).default('001'),
  routingNumber: varchar('routing_number', { length: 9 }).default('123456789'),
  swiftCode: varchar('swift_code', { length: 11 }).default('SECUBANKXXX'),
  openedDate: timestamp('opened_date').defaultNow().notNull(),
  lastActivityDate: timestamp('last_activity_date'),
  dormancyDate: timestamp('dormancy_date'),
  closedDate: timestamp('closed_date'),
  riskRating: varchar('risk_rating', { length: 20 }).default('low'),
  complianceStatus: varchar('compliance_status', { length: 20 }).default('compliant'),
  kycStatus: varchar('kyc_status', { length: 20 }).default('verified'),
  amlStatus: varchar('aml_status', { length: 20 }).default('clear'),
  taxId: varchar('tax_id', { length: 20 }),
  taxReportingCategory: varchar('tax_reporting_category', { length: 50 }).default('personal'),
  primaryAccountHolder: uuid('primary_account_holder').references(() => users.id),
  jointAccountHolders: text('joint_account_holders'),
  beneficiaries: text('beneficiaries'),
  authorizedUsers: text('authorized_users'),
  accountPackage: varchar('account_package', { length: 50 }).default('standard'),
  productCode: varchar('product_code', { length: 20 }),
  subProduct: varchar('sub_product', { length: 50 }),
  digitalStatements: boolean('digital_statements').default(true),
  smsNotifications: boolean('sms_notifications').default(true),
  emailNotifications: boolean('email_notifications').default(true),
  pushNotifications: boolean('push_notifications').default(true),
  twoFactorAuth: boolean('two_factor_auth').default(false),
  biometricAuth: boolean('biometric_auth').default(false),
  securityQuestions: text('security_questions'),
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  specialInstructions: text('special_instructions'),
  pendingAccountChanges: text('pending_account_changes'),
  lastAccountUpdate: timestamp('last_account_update'),
  accountUpdatedBy: uuid('account_updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromAccountId: uuid('from_account_id').references(() => accounts.id),
  toAccountId: uuid('to_account_id').references(() => accounts.id),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  processedBy: uuid('processed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const loans = pgTable('loans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  interestRate: decimal('interest_rate', { precision: 5, scale: 2 }).notNull(),
  termMonths: integer('term_months').notNull(),
  monthlyPayment: decimal('monthly_payment', { precision: 15, scale: 2 }).notNull(),
  remainingBalance: decimal('remaining_balance', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  approvedBy: uuid('approved_by').references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  principalId: uuid('principal_id').references(() => users.id).notNull(),
  principalType: varchar('principal_type', { length: 50 }).notNull().default('User'),
  principalRole: varchar('principal_role', { length: 50 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: varchar('resource_id', { length: 100 }),
  decision: varchar('decision', { length: 20 }).notNull(),
  reasons: text('reasons'),
  requestContext: text('request_context'),
  sessionId: varchar('session_id', { length: 100 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  policyEngineVersion: varchar('policy_engine_version', { length: 50 }).default('1.0'),
  processingTimeMs: integer('processing_time_ms'),
  riskLevel: varchar('risk_level', { length: 20 }).default('low'),
  complianceFlags: text('compliance_flags'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  businessContext: text('business_context'),
  dataAccessed: text('data_accessed'),
  actionOutcome: varchar('action_outcome', { length: 50 }),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertLoanSchema = createInsertSchema(loans).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Loan = typeof loans.$inferSelect;
export type InsertLoan = z.infer<typeof insertLoanSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// ── Role type ────────────────────────────────────────────────
export type UserRole = 'Account Holder' | 'Bank Teller' | 'Bank Manager' | 'Administrator';

export const loginSchema = z.object({
  email: z.string().email(),
  role: z.enum(['Account Holder', 'Bank Teller', 'Bank Manager', 'Administrator']),
});

export const updateAccountHolderProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/).optional(),
  dateOfBirth: z.string().optional(),
  homeAddress: z.string().min(5).optional(),
  phone: z.string().regex(/^\+?[\d\s\-\(\)]+$/).optional(),
  alternatePhone: z.string().regex(/^\+?[\d\s\-\(\)]+$/).optional(),
  email: z.string().email().optional(),
  employerName: z.string().min(2).optional(),
  annualIncome: z.string().refine((val) => !val || (!isNaN(Number(val)) && Number(val) >= 0)).optional(),
  creditScore: z.number().int().min(300).max(850).optional(),
  requiresManagerApproval: z.boolean().default(false),
});

export const profileApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
});

export const transferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0),
  description: z.string().min(1),
});

export const loanApplicationSchema = z.object({
  type: z.enum(['personal', 'auto', 'home', 'business']),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0),
  termMonths: z.number().int().min(6).max(360),
  purpose: z.string().min(10),
});

export const loanDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  interestRate: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Number(val) > 0)),
  notes: z.string().optional(),
});

export const auditLogQuerySchema = z.object({
  principalId: z.string().uuid().optional(),
  principalRole: z.enum(['Account Holder', 'Bank Teller', 'Bank Manager', 'Administrator']).optional(),
  action: z.string().optional(),
  resourceType: z.enum(['Account', 'Transaction', 'Loan', 'User']).optional(),
  decision: z.enum(['Allow', 'Deny']).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

export const accountApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
});

export type LoginRequest = z.infer<typeof loginSchema>;
export type TransferRequest = z.infer<typeof transferSchema>;
export type LoanApplication = z.infer<typeof loanApplicationSchema>;
export type LoanDecision = z.infer<typeof loanDecisionSchema>;
export type UpdateAccountHolderProfile = z.infer<typeof updateAccountHolderProfileSchema>;
export type ProfileApproval = z.infer<typeof profileApprovalSchema>;
export type AccountApproval = z.infer<typeof accountApprovalSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
