// invokeAgent removed — now using LangGraph service
const LANGGRAPH_URL = process.env.LANGGRAPH_URL || "http://localhost:8410";

// This app's own public base URL, used for self-referential calls (TrAT
// delegation). Previously defaulted to https://securebanking.onrender.com, so a
// misconfigured local or docker instance quietly called the live deployment.
const SELF_URL = process.env.PUBLIC_BASE_URL || process.env.BANK_APP_URL
  || `http://localhost:${process.env.PORT || "8400"}`;

// MCP tool server. No default: this used to fall back to a personal ngrok
// tunnel, which meant an unset variable sent traffic to a third party.
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || process.env.MCP_NGROK_URL || "";
// SharePoint access now handled by Azure Foundry SharePoint Grounding tool (OBO)
// import { getSharePointContext, testSharePointConnection } from "./sharepoint.js";
import { v4 as uuidv4 } from "uuid";
import { canonicalizeEmail, findLocalUser } from './auth/identity.js';
import type { Express } from 'express';
import { z } from 'zod';
import { storage } from './storage.js';
import { CedarAuthorizationEngine } from './cedar-auth.js';
import './types.js';
import { authRouter, authInfo, AUTH_PROVIDER } from './auth/index.js';
import { tratRouter, recordCreditScoreCheck, recordCreditRiskCheck, recordMarketAnalysis, consumeApprovalNonce, getStoredNonce, getIntentSession, setHitlRequired, acknowledgeHitl, isHitlBypassed, isHitlRequired, isHitlAcknowledged, getInsightsData, trackEvent, trackEnrichment, recordMessage, getMessageHistory } from './trat.js';
import { getLoanHistory } from './storage.js';

// ─── Insights Event Store ─────────────────────────────────────────────────────
// trackEvent and trackEnrichment are imported from trat.ts — single shared store
import { requireAuth, requireRole, requireAgentAct, requireTrAT } from './middleware/validateToken.js';
// ═══════════════════════════════════════════════════════════════
// GOVERNANCE DISABLED — No TrAT, No Cedar
// ═══════════════════════════════════════════════════════════════
// ── Cross-trace chat history: deliberately NOT sent ──────────────────────────
// There used to be a Map<sessionId, string[]> here that accumulated every user
// message in a chat and sent all the earlier ones to the agent as
// `query_history` and `history: { prompt }`.
//
// Both of those are the Reva SDK's "conventional history" intake
// (REVA_PROMPT_HISTORY_BODY_KEY = "history", with query_history as the
// fallback). The SDK adopts whichever it finds as the ROOT of the hop chain for
// the new trace — so message 2's chain started with a synthetic node carrying
// message 1's text, with no resource, action or threadId.
//
// That does not buy anything. Each user message is its own trace; the SDK has no
// session-management capability, so cross-trace text is carried but not acted on.
// Meanwhile it grew without bound (every prior turn, joined, nested into every
// hop of every trace) and the Map was never evicted.
//
// Removing it does NOT affect intent-drift detection WITHIN a message. That hop
// chain — user→finbot→sharepoint→credit — is built entirely by the SDK from the
// hops themselves. Verified by A/B against the live PDP: a first message (no app
// history) and a second message (app history present) produce byte-identical
// within-trace chains; the only difference is the extra cross-trace seed node.
//
// If the SDK ever gains real session management, feed it whatever interface it
// then defines rather than reviving this.

const requireTrATPassthrough = (req: any, _res: any, next: any) => {
  req.trat = {
    sub: req.session?.claims?.sub || "unknown",
    role: req.session?.claims?.role || "",
    clearance_level: req.session?.claims?.clearance_level || 10,
    branch_id: req.session?.claims?.branch_id || "BR001",
    trace_id: "no-governance",
    id: req.session?.claims?.id || "",
  };
  next();
};


// ═══════════════════════════════════════════════════════════════
import { 
  insertUserSchema, insertAccountSchema, insertTransactionSchema, insertLoanSchema,
  loginSchema, transferSchema, loanApplicationSchema, loanDecisionSchema,
  updateAccountHolderProfileSchema, profileApprovalSchema, auditLogQuerySchema,
  type LoginRequest, type TransferRequest, type LoanApplication, type LoanDecision,

  type UpdateAccountHolderProfile, type ProfileApproval, type AuditLogQuery,
  type InsertAuditLog
} from '../shared/schema.js';
import * as approvals from "./approvals.js";
import * as slack from "./slack.js";

// Helper function to create audit logs for business operations
async function createBusinessAuditLog(
  principalId: string,
  principalRole: string,
  action: string,
  resourceType: string,
  resourceId: string,
  decision: 'Allow' | 'Deny' = 'Allow',
  businessContext?: string,
  riskLevel: string = 'medium'
) {
  try {
    const auditLog: InsertAuditLog = {
      principalId,
      principalRole,
      action,
      resourceType,
      resourceId,
      decision,
      businessContext,
      riskLevel,
      actionOutcome: 'success',
    };
    await storage.createAuditLog(auditLog);
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

// Generic Cedar authorization evaluation method
async function evaluateCedarAuthorization(
  subjectId: string,
  action: string,
  resourceType: string,
  resourceId: string
) {
  return [{ decision: true, reason: "governance-disabled" }];
}

export function setupRoutes(app: Express) {
  // ── Okta SSO routes (auth router mounted in index.ts) ────────────────────
  // requireAuth/requireRole/requireAgentAct imported at top of file
  app.use("/auth", authRouter);
  // Override requireTrAT — governance disabled, just pass through
  app.use((req: any, res: any, next: any) => {
    if (!req.trat) {
      req.trat = {
        sub: req.session?.claims?.sub || "unknown",
        role: req.session?.claims?.role || "",
        clearance_level: req.session?.claims?.clearance_level || 10,
        branch_id: req.session?.claims?.branch_id || "BR001",
        trace_id: "no-governance",
        id: req.session?.claims?.id || "",
      };
    }
    next();
  });
  // NOTE: the old unguarded `POST /auth/direct-login` lived here. It accepted
  // any email with no password and no environment guard, in every auth mode.
  // It now lives in auth/none.ts and is only reachable when AUTH_PROVIDER=none.

  //app.use("/auth", tratRouter);// governance removed

  // Populate req.user from session claims on every request
  app.use((req: any, _res: any, next: any) => {
    if (req.session?.claims) { req.user = req.session.claims; }
    next();
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "OK", 
      message: "SecureBank API is running", 
      timestamp: new Date().toISOString() 
    });
  });

  // Login handled by /auth/login (Okta OIDC)

  // Logout endpoint
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // Get current user
  // /api/auth/me — reads from session claims (populated by /auth/callback)
  app.get("/api/auth/me", (req: any, res) => {
    const claims = req.session?.claims || req.user;
    // Carry the provider descriptor even on 401 — the login screen needs to know
    // which button (or user picker) to render BEFORE anyone has signed in.
    if (!claims) return res.status(401).json({ error: "Not authenticated", auth: authInfo() });
    res.json({
      sub:           claims.sub,
      email:         claims.sub,
      name:          claims.name || claims.sub,
      role:          claims.role || null,
      clearanceLevel: claims.clearance_level || null,
      branchId:      claims.branch_id || null,
      department:    claims.department || null,
      agentId:       claims.act?.sub || null,
      accessGranted: !!claims.role,
      enriched:      !!claims.role,
      auth:          authInfo(),
      // The FinBot deny card names the store policy that fired, from a table
      // transcribed out of the store. DEMO_EXPLAIN_DENIES=0 turns that panel off
      // and leaves only what the agent actually reported (refused hop, trace).
      demoExplainDenies: process.env.DEMO_EXPLAIN_DENIES !== "0",
      // The suffix every entity id carries in this deployment (-local, -sbv2…),
      // so the deny card can match a refused resource to its policy whatever the
      // store calls it. Same variable and default as agent/entity_names.py.
      entitySuffix: process.env.ENTITY_SUFFIX ?? "-local",
    });
  });

  // Dashboard stats endpoint
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (user.role === 'Account Holder') {
        // Account holders see their own stats only
        const accounts = await storage.getAccountsByUserId(user.id);
        const loans = await storage.getLoansByUserId(user.id);
        
        const totalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance), 0);
        const totalLoans = loans.reduce((sum, loan) => sum + parseFloat(loan.remainingBalance), 0);
        
        let recentTransactions = [];
        for (const account of accounts) {
          const transactions = await storage.getTransactionsByAccountId(account.id);
          recentTransactions.push(...transactions);
        }
        recentTransactions = recentTransactions
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5);

        res.json({
          totalBalance,
          totalLoans,
          accountsCount: accounts.length,
          loansCount: loans.length,
          recentTransactions
        });
      } else {
        // Bank staff see overall stats
        const allUsers = await storage.getUsers();
        const allAccounts = await storage.getAccounts();
        const allTransactions = await storage.getTransactions();
        const allLoans = await storage.getLoans();

        const totalCustomers = allUsers.filter(u => u.role === 'Account Holder').length;
        const totalBalance = allAccounts.reduce((sum, acc) => sum + parseFloat(acc.balance), 0);
        const totalLoans = allLoans.reduce((sum, loan) => sum + parseFloat(loan.remainingBalance), 0);
        
        const recentTransactions = allTransactions
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);

        res.json({
          totalCustomers,
          totalBalance,
          totalLoans,
          accountsCount: allAccounts.length,
          loansCount: allLoans.length,
          recentTransactions
        });
      }
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // User picker feed for AUTH_PROVIDER=none. Unauthenticated by necessity — it
  // is what the login screen reads before a session exists — so it is only
  // registered in that mode. With a real IdP it would be an anonymous roster of
  // every user and their role.
  app.get("/api/login-users", async (req, res) => {
    if (AUTH_PROVIDER !== "none") {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      const users = await storage.getUsers();
      // Return only essential info needed for login (no sensitive data)
      const loginUsers = users.map(user => ({
        email: user.email,
        name: user.name,
        role: user.role
      }));
      res.json(loginUsers);
    } catch (error) {
      console.error("Get login users error:", error);
      res.status(500).json({ error: "Failed to fetch login users" });
    }
  });

  // Users endpoints
  app.get("/api/users", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role === 'Account Holder') {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const targetUser = await storage.getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Account holders can only view their own basic profile (no sensitive info)
      if (user.role === 'Account Holder' && user.id !== id) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Filter response based on user role and target user
      const responseUser = { ...targetUser };
      
      if (targetUser.role === 'Account Holder') {
        if (user.role === 'Account Holder' && user.id === id) {
          // Account Holders can see their own complete information including sensitive data
          // No filtering needed - they can see everything about themselves
        } else if (user.role === 'Bank Teller') {
          // Bank Tellers can see most info but SSN is masked
          responseUser.ssn = responseUser.ssn ? 'XXX-XX-XXXX' : null;
        } else if (user.role === 'Bank Manager') {
          // Bank Managers can see everything including actual SSN
          // No filtering needed
        }
      }

      res.json(responseUser);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can create users" });
      }

      const userData = insertUserSchema.parse(req.body);
      const newUser = await storage.createUser(userData);
      res.status(201).json(newUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(400).json({ error: "Invalid user data" });
    }
  });

  app.patch("/api/users/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      
      // Only Bank Staff can edit Account Holder profiles
      if (user.role === 'Account Holder') {
        return res.status(403).json({ error: "Account Holders cannot edit profiles" });
      }

      const targetUser = await storage.getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Only Bank Staff can edit Account Holder information
      if (targetUser.role === 'Account Holder' && (user.role !== 'Bank Teller' && user.role !== 'Bank Manager')) {
        return res.status(403).json({ error: "Only Bank Staff can edit Account Holder information" });
      }

      // Only Bank Managers can edit Bank Staff users (Bank Tellers and Bank Managers)
      if ((targetUser.role === 'Bank Teller' || targetUser.role === 'Bank Manager') && user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can edit Bank Staff users" });
      }

      // Use specialized profile update schema for Account Holders
      if (targetUser.role === 'Account Holder') {
        const profileData = updateAccountHolderProfileSchema.parse(req.body);
        
        // Bank Tellers can now edit users directly - no restrictions needed
        const requiresApproval = false; // Allow Bank Tellers to edit directly

        if (requiresApproval) {
          // Store changes as pending approval
          const pendingChanges = {
            ...profileData,
            requestedBy: user.id,
            requestDate: new Date().toISOString(),
            status: 'pending'
          };
          
          const updates = {
            pendingProfileChanges: JSON.stringify(pendingChanges),
            lastProfileUpdate: new Date(),
            profileUpdatedBy: user.id
          };
          
          const updatedUser = await storage.updateUser(id, updates);
          
          // Create audit log for pending user profile changes
          await createBusinessAuditLog(
            user.id,
            user.role,
            'SubmitUserProfileChanges',
            'User',
            id,
            'Allow',
            `${user.role} submitted profile changes for ${targetUser.name}: ${JSON.stringify(profileData)}`,
            'high'
          );
          
          return res.json({ 
            user: updatedUser, 
            message: "Changes submitted for Manager approval",
            pendingApproval: true 
          });
        } else {
          // Manager can apply changes directly, or Teller making basic updates
          const updates: any = {
            ...profileData,
            lastProfileUpdate: new Date(),
            profileUpdatedBy: user.id
          };
          
          // Convert date string to Date object if provided
          if (updates.dateOfBirth) {
            updates.dateOfBirth = new Date(updates.dateOfBirth);
          }
          
          const updatedUser = await storage.updateUser(id, updates);
          
          // Create audit log for approved user profile changes
          await createBusinessAuditLog(
            user.id,
            user.role,
            'UpdateUserProfile',
            'User',
            id,
            'Allow',
            `${user.role} updated profile for ${targetUser.name}: ${JSON.stringify(profileData)}`,
            'high'
          );
          
          return res.json({ 
            user: updatedUser, 
            message: "Profile updated successfully" 
          });
        }
      } else {
        // Regular user update for Bank Staff
        const updates = insertUserSchema.partial().parse(req.body);
        const updatedUser = await storage.updateUser(id, updates);
        
        // Create audit log for regular user updates
        await createBusinessAuditLog(
          user.id,
          user.role,
          'UpdateUser',
          'User',
          id,
          'Allow',
          `${user.role} updated user ${targetUser.name}: ${JSON.stringify(updates)}`,
          'medium'
        );
        
        res.json(updatedUser);
      }
    } catch (error) {
      console.error("Update user error:", error);
      res.status(400).json({ error: "Invalid user data" });
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can delete users" });
      }

      const { id } = req.params;
      
      // Get user info before deletion for audit log
      const targetUser = await storage.getUserById(id);
      const deleted = await storage.deleteUser(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }

      // Create audit log for user deletion
      await createBusinessAuditLog(
        user.id,
        user.role,
        'DeleteUser',
        'User',
        id,
        'Allow',
        `Bank Manager deleted user: ${targetUser?.name || 'Unknown'} (${targetUser?.email || 'No email'})`,
        'critical'
      );

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Profile approval endpoints for Bank Managers
  app.get("/api/users/:id/pending-changes", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can view pending changes" });
      }

      const { id } = req.params;
      const targetUser = await storage.getUserById(id);
      
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser.pendingProfileChanges) {
        return res.json({ pendingChanges: null, message: "No pending changes" });
      }

      const pendingChanges = JSON.parse(targetUser.pendingProfileChanges);
      res.json({ pendingChanges, user: targetUser });
    } catch (error) {
      console.error("Get pending changes error:", error);
      res.status(500).json({ error: "Failed to fetch pending changes" });
    }
  });

  app.post("/api/users/:id/approve-changes", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can approve changes" });
      }

      const { id } = req.params;
      const { decision, notes } = profileApprovalSchema.parse(req.body) as ProfileApproval;
      
      const targetUser = await storage.getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser.pendingProfileChanges) {
        return res.status(400).json({ error: "No pending changes to approve" });
      }

      const pendingChanges = JSON.parse(targetUser.pendingProfileChanges);

      if (decision === 'approved') {
        // Apply the pending changes
        const updates: any = {
          ...pendingChanges,
          pendingProfileChanges: null,
          lastProfileUpdate: new Date(),
          profileUpdatedBy: user.id
        };
        
        // Remove approval metadata
        delete updates.requestedBy;
        delete updates.requestDate;
        delete updates.status;
        delete updates.requiresManagerApproval;
        
        // Convert date string to Date object if provided
        if (updates.dateOfBirth) {
          updates.dateOfBirth = new Date(updates.dateOfBirth);
        }

        const updatedUser = await storage.updateUser(id, updates);
        res.json({ 
          user: updatedUser, 
          message: "Changes approved and applied successfully",
          approved: true
        });
      } else {
        // Reject the changes
        const updates = {
          pendingProfileChanges: null,
          lastProfileUpdate: new Date(),
          profileUpdatedBy: user.id
        };
        
        const updatedUser = await storage.updateUser(id, updates);
        res.json({ 
          user: updatedUser, 
          message: `Changes rejected${notes ? ': ' + notes : ''}`,
          approved: false 
        });
      }
    } catch (error) {
      console.error("Approve changes error:", error);
      res.status(400).json({ error: "Invalid approval data" });
    }
  });

  // Accounts endpoints
  app.get("/api/accounts", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      let accounts;
      if (user.role === 'Account Holder') {
        // Account holders see only their own accounts
        accounts = await storage.getAccountsByUserId(user.id);
      } else {
        // Bank staff see all accounts
        accounts = await storage.getAccounts();
      }

      // Add user information to each account
      const accountsWithUsers = await Promise.all(
        accounts.map(async (account) => {
          const accountUser = await storage.getUserById(account.userId);
          
          // Filter sensitive information based on current user role
          let filteredUser = accountUser;
          if (accountUser && accountUser.role === 'Account Holder') {
            if (user.role === 'Account Holder') {
              // Account Holders can see their own complete information
              if (accountUser.id === user.id) {
                // Own account - no filtering, can see everything including sensitive data
                filteredUser = accountUser;
              } else {
                // Other Account Holder's account - hide sensitive information
                filteredUser = {
                  ...accountUser,
                  ssn: null,
                  dateOfBirth: null,
                  homeAddress: null,
                  alternatePhone: null,
                  employerName: null,
                  annualIncome: null,
                  creditScore: null,
                  identityVerified: null,
                  kycCompleted: null,
                  pendingProfileChanges: null,
                  lastProfileUpdate: null,
                  profileUpdatedBy: null,
                };
              }
            } else if (user.role === 'Bank Teller') {
              // Bank Tellers see most info but SSN is masked
              filteredUser = {
                ...accountUser,
                ssn: accountUser.ssn ? 'XXX-XX-XXXX' : null
              };
            }
            // Bank Managers see everything as-is
          }
          
          return { ...account, user: filteredUser };
        })
      );

      res.json(accountsWithUsers);
    } catch (error) {
      console.error("Get accounts error:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.post("/api/account/view-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      let accounts;
      if (user.role === 'Account Holder') {
        // Account holders see only their own accounts
        accounts = await storage.getAccountsByUserId(user.id);
      } else {
        // Bank staff see all accounts
        accounts = await storage.getAccounts();
      }

      // Add user information to each account
      const accountsWithUsers = await Promise.all(
        accounts.map(async (account) => {
          const accountUser = await storage.getUserById(account.userId);
          
          console.log("accountUser.id", accountUser?.id);
          let flag = false;
          
          // invoke evaluateCedarAuthorization for each account and user passing user as the principal and ViewSensitiveUserData as action and accountUser as resource
          if (accountUser) {
            try {
              const cedarResult = await evaluateCedarAuthorization(
                user.uniqueId || user.id,
                "ViewSensitiveUserData",
                "User",
                accountUser.uniqueId || accountUser.id
              );
              
              console.log("cedarResult for account", account.id, cedarResult);
              
              // Check if Cedar authorization allows viewing sensitive data
              if (cedarResult && cedarResult[0] && cedarResult[0].decision === true) {
                flag = true;
              }
            } catch (error) {
              console.error(`Cedar authorization error for account ${account.id}:`, error);
              // Continue to next account if authorization check fails
            }
          }
          
          return { 
            id: account.id, 
            decision: flag 
          };
        })
      );

      res.json(accountsWithUsers);
    } catch (error) {
      console.error("Get accounts error:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.get("/api/accounts/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const account = await storage.getAccountById(id);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      // Account holders can only view their own accounts
      if (user.role === 'Account Holder' && account.userId !== user.id) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const accountUser = await storage.getUserById(account.userId);
      
      // Filter sensitive information based on current user role
      let filteredUser = accountUser;
      if (accountUser && accountUser.role === 'Account Holder') {
        if (user.role === 'Account Holder') {
          // Account Holders can see their own complete information
          if (accountUser.id === user.id) {
            // Own account - no filtering, can see everything including sensitive data
            filteredUser = accountUser;
          } else {
            // Other Account Holder's account - hide sensitive information
            filteredUser = {
              ...accountUser,
              ssn: null,
              dateOfBirth: null,
              homeAddress: null,
              alternatePhone: null,
              employerName: null,
              annualIncome: null,
              creditScore: null,
              identityVerified: null,
              kycCompleted: null,
              pendingProfileChanges: null,
              lastProfileUpdate: null,
              profileUpdatedBy: null,
            };
          }
        } else if (user.role === 'Bank Teller') {
          // Bank Tellers see most info but SSN is masked
          filteredUser = {
            ...accountUser,
            ssn: accountUser.ssn ? 'XXX-XX-XXXX' : null
          };
        }
        // Bank Managers see everything as-is
      }
      
      res.json({ ...account, user: filteredUser });
    } catch (error) {
      console.error("Get account error:", error);
      res.status(500).json({ error: "Failed to fetch account" });
    }
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role === 'Account Holder') {
        return res.status(403).json({ error: "Account holders cannot create accounts" });
      }

      const accountData = insertAccountSchema.parse(req.body);
      const newAccount = await storage.createAccount(accountData);
      res.status(201).json(newAccount);
    } catch (error) {
      console.error("Create account error:", error);
      res.status(400).json({ error: "Invalid account data" });
    }
  });

  app.patch("/api/accounts/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      
      // Cedar Authorization Check
      const authResult = CedarAuthorizationEngine.authorize({
        principal: user,
        action: "UpdateAccount",
        resource: {
          type: "Account",
          id: id,
          attributes: { accountId: id }
        },
        context: {
          currentHour: new Date().getHours(),
          ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] as string || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          sessionId: req.sessionID || 'unknown',
          resourceId: id
        }
      });

      if (authResult.decision === "Deny") {
        return res.status(403).json({ 
          error: "Access denied", 
          reasons: authResult.reasons 
        });
      }

      const updates = insertAccountSchema.partial().parse(req.body);
      const updatedAccount = await storage.updateAccount(id, updates);
      
      if (!updatedAccount) {
        return res.status(404).json({ error: "Account not found" });
      }

      // Create audit log for account update
      await createBusinessAuditLog(
        user.id,
        user.role,
        'UpdateAccountDetails',
        'Account',
        id,
        'Allow',
        `Account details updated by ${user.role}: ${JSON.stringify(updates)}`,
        user.role === 'Account Holder' ? 'low' : 'medium'
      );

      res.json(updatedAccount);
    } catch (error) {
      console.error("Update account error:", error);
      res.status(400).json({ error: "Invalid account data" });
    }
  });

  // Full account editing with approval workflow
  app.patch("/api/accounts/:id/full-edit", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      
      // Cedar Authorization Check for Full Account Edit
      const authResult = CedarAuthorizationEngine.authorize({
        principal: user,
        action: "UpdateAccount",
        resource: {
          type: "Account",
          id: id,
          attributes: { accountId: id, operationType: "full-edit" }
        },
        context: {
          currentHour: new Date().getHours(),
          ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] as string || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          sessionId: req.sessionID || 'unknown',
          resourceId: id,
          operationType: "full-edit"
        }
      });

      if (authResult.decision === "Deny") {
        return res.status(403).json({ 
          error: "Access denied", 
          reasons: authResult.reasons 
        });
      }
      const { accountData, holderData } = req.body;
      
      // Get current account and user to check for sensitive changes
      const currentAccount = await storage.getAccountById(id);
      if (!currentAccount) {
        return res.status(404).json({ error: "Account not found" });
      }

      const currentUser = await storage.getUserById(currentAccount.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "Account holder not found" });
      }

      // Fields that require Manager approval for Bank Tellers
      const sensitiveAccountFields = [
        'accountNumber',      // Account Number (Requires Approval)
        'balance',           // Account Balance (Requires Approval)
        'status',            // Account Status (Requires Approval)
        'interestRate',      // Interest Rate (Requires Approval)
        'overdraftLimit',    // Overdraft Limit (Requires Approval)
        'creditLimit'        // Credit Limit (Requires Approval)
      ];
      
      const sensitiveHolderFields = [
        'name',              // Full Legal Name (Requires Approval)
        'ssn',               // Social Security Number (Requires Approval)
        'dateOfBirth',       // Date of Birth (Requires Approval)
        'email',             // Email Address (Requires Approval)
        'homeAddress',       // Home Address (Requires Approval)
        'primaryPhone',      // Primary Phone (Requires Approval)
        'employerName',      // Employer Name (Requires Approval)
        'annualIncome',      // Annual Income (Requires Approval)
        'creditScore'        // Credit Score (Requires Approval)
      ];
      
      // Fields that do NOT require approval for Bank Tellers
      const nonSensitiveAccountFields = ['monthlyFee', 'minimumBalance'];
      const nonSensitiveHolderFields = ['alternatePhone'];
      
      let requiresApproval = false;
      if (user.role === 'Bank Teller') {
        // Check account sensitive fields
        const accountChanges = sensitiveAccountFields.some(field => 
          accountData[field] && accountData[field] !== ((currentAccount as any)[field] || "0.00")
        );
        
        // Check holder sensitive fields
        const holderChanges = sensitiveHolderFields.some(field => {
          const currentValue = field === 'creditScore' ? 
            currentUser.creditScore?.toString() || "" : 
            (currentUser as any)[field]?.toString() || "";
          return holderData[field] && holderData[field] !== currentValue;
        });
        
        requiresApproval = accountChanges || holderChanges;
      }

      if (requiresApproval) {
        // Bank Teller is making sensitive changes - store as pending
        // Only include fields that actually changed
        const accountChanges: any = {};
        for (const [key, value] of Object.entries(accountData)) {
          const currentValue = (currentAccount as any)[key];
          if (value && value !== (currentValue?.toString() || "0.00")) {
            accountChanges[key] = value;
          }
        }

        const holderChanges: any = {};
        for (const [key, value] of Object.entries(holderData)) {
          let currentValue;
          if (key === 'creditScore') {
            currentValue = currentUser.creditScore?.toString() || "";
          } else {
            currentValue = (currentUser as any)[key]?.toString() || "";
          }
          if (value && value !== currentValue) {
            holderChanges[key] = value;
          }
        }

        const pendingChanges = {
          accountChanges,
          holderChanges,
          changedBy: user.id,
          changedAt: new Date().toISOString(),
          reason: 'Bank Teller modifications requiring Manager approval'
        };

        const updates = {
          pendingAccountChanges: JSON.stringify(pendingChanges),
          lastAccountUpdate: new Date(),
          accountUpdatedBy: user.id
        };
        
        const updatedAccount = await storage.updateAccount(id, updates);
        
        // Create audit log for pending account changes
        await createBusinessAuditLog(
          user.id,
          user.role,
          'SubmitAccountChanges',
          'Account',
          id,
          'Allow',
          `Account changes submitted for approval by ${user.role}: Account(${JSON.stringify(accountChanges)}) Holder(${JSON.stringify(holderChanges)})`,
          'high'
        );
        
        return res.json({ 
          account: updatedAccount, 
          message: "Changes submitted for Manager approval",
          approved: false 
        });
      } else {
        // Bank Manager or non-sensitive changes by Bank Teller
        // Update account information
        const accountUpdates = {
          ...accountData,
          lastAccountUpdate: new Date(),
          accountUpdatedBy: user.id,
          pendingAccountChanges: null // Clear any pending changes
        };
        
        const updatedAccount = await storage.updateAccount(id, accountUpdates);
        
        // Update account holder information
        const holderUpdates = {
          ...holderData,
          lastProfileUpdate: new Date(),
          profileUpdatedBy: user.id,
          pendingProfileChanges: null // Clear any pending profile changes
        };
        
        // Convert credit score back to number if provided
        if (holderUpdates.creditScore) {
          holderUpdates.creditScore = parseInt(holderUpdates.creditScore);
        }
        
        // Convert date string back to Date if provided
        if (holderUpdates.dateOfBirth) {
          holderUpdates.dateOfBirth = new Date(holderUpdates.dateOfBirth);
        }
        
        const updatedUser = await storage.updateUser(currentAccount.userId, holderUpdates);
        
        // Create audit log for approved account changes
        await createBusinessAuditLog(
          user.id,
          user.role,
          'ApproveAccountChanges',
          'Account',
          id,
          'Allow',
          `Account changes approved and applied by ${user.role}: Account(${JSON.stringify(accountData)}) Holder(${JSON.stringify(holderData)})`,
          'high'
        );
        
        res.json({ 
          account: updatedAccount, 
          user: updatedUser,
          message: "Account and holder information updated successfully",
          approved: true 
        });
      }
    } catch (error) {
      console.error("Update full account error:", error);
      res.status(400).json({ error: "Invalid account data" });
    }
  });

  // Transfer destinations endpoint - returns minimal info for transfer dropdowns
  app.get("/api/transfer-destinations", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Only Account Holders need this endpoint for transfers to other users
      if (user.role !== 'Account Holder') {
        return res.status(403).json({ error: "This endpoint is for Account Holders only" });
      }

      // Get all accounts except the current user's accounts
      const allAccounts = await storage.getAccounts();
      const transferDestinations = [];

      for (const account of allAccounts) {
        // Skip current user's own accounts
        if (account.userId === user.id) {
          continue;
        }

        const accountUser = await storage.getUserById(account.userId);
        
        // Only include basic transfer info - no sensitive data
        if (accountUser && accountUser.role === 'Account Holder') {
          transferDestinations.push({
            id: account.id,
            accountNumber: account.accountNumber,
            accountType: account.accountType,
            holderName: accountUser.name, // Just the name, no sensitive info
            status: account.status
          });
        }
      }

      res.json(transferDestinations);
    } catch (error) {
      console.error("Get transfer destinations error:", error);
      res.status(500).json({ error: "Failed to fetch transfer destinations" });
    }
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      console.log("user..",user)
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can delete accounts" });
      }

      const { id } = req.params;
      const deleted = await storage.deleteAccount(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Account not found" });
      }

      res.json({ message: "Account deleted successfully" });
    } catch (error) {
      console.error("Delete account error:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // Account approval endpoints for Bank Managers
  app.get("/api/accounts/:id/pending-changes", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can view pending account changes" });
      }

      const { id } = req.params;
      const account = await storage.getAccountById(id);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      if (!account.pendingAccountChanges) {
        return res.json({ pendingChanges: null, message: "No pending changes" });
      }

      const pendingChanges = JSON.parse(account.pendingAccountChanges);
      
      // Get the full user data for Bank Managers (unmasked SSN)
      let accountWithUser = { ...account };
      if (account.userId) {
        const accountUser = await storage.getUserById(account.userId);
        if (accountUser) {
          // Bank Managers should see actual SSN values, not masked
          accountWithUser.user = accountUser;
        }
      }
      
      res.json({ pendingChanges, account: accountWithUser });
    } catch (error) {
      console.error("Get pending account changes error:", error);
      res.status(500).json({ error: "Failed to fetch pending changes" });
    }
  });

  app.post("/api/accounts/:id/approve-changes", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can approve account changes" });
      }

      const { id } = req.params;
      const { decision, notes } = req.body;
      
      const account = await storage.getAccountById(id);
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      if (!account.pendingAccountChanges) {
        return res.status(400).json({ error: "No pending changes to approve" });
      }

      const pendingChanges = JSON.parse(account.pendingAccountChanges);

      if (decision === 'approved') {
        // Apply the pending changes
        const { accountChanges, holderChanges } = pendingChanges;
        
        // Update account information
        const accountUpdates = {
          ...accountChanges,
          lastAccountUpdate: new Date(),
          accountUpdatedBy: user.id,
          pendingAccountChanges: null
        };
        
        const updatedAccount = await storage.updateAccount(id, accountUpdates);
        
        // Update account holder information if present
        let updatedUser = null;
        if (holderChanges) {
          const holderUpdates = {
            ...holderChanges,
            lastProfileUpdate: new Date(),
            profileUpdatedBy: user.id,
            pendingProfileChanges: null
          };
          
          // Convert credit score back to number if provided
          if (holderUpdates.creditScore) {
            holderUpdates.creditScore = parseInt(holderUpdates.creditScore);
          }
          
          // Convert date string back to Date if provided
          if (holderUpdates.dateOfBirth) {
            holderUpdates.dateOfBirth = new Date(holderUpdates.dateOfBirth);
          }
          
          updatedUser = await storage.updateUser(account.userId, holderUpdates);
        }
        
        res.json({ 
          account: updatedAccount, 
          user: updatedUser,
          message: "Account and holder changes approved and applied successfully",
          approved: true
        });
      } else {
        // Reject the changes
        const updates = {
          pendingAccountChanges: null,
          lastAccountUpdate: new Date(),
          accountUpdatedBy: user.id
        };
        
        const updatedAccount = await storage.updateAccount(id, updates);
        res.json({ 
          account: updatedAccount, 
          message: `Account changes rejected${notes ? ': ' + notes : ''}`,
          approved: false 
        });
      }
    } catch (error) {
      console.error("Approve account changes error:", error);
      res.status(400).json({ error: "Invalid approval data" });
    }
  });

  // Transactions endpoints
  app.get("/api/transactions", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      let transactions;
      if (user.role === 'Account Holder') {
        // Account holders see only their own transactions
        const accounts = await storage.getAccountsByUserId(user.id);
        const transactionIds = new Set();
        transactions = [];
        for (const account of accounts) {
          const accountTransactions = await storage.getTransactionsByAccountId(account.id);
          for (const transaction of accountTransactions) {
            if (!transactionIds.has(transaction.id)) {
              transactionIds.add(transaction.id);
              transactions.push(transaction);
            }
          }
        }
      } else {
        // Bank staff see all transactions
        transactions = await storage.getTransactions();
      }

      // Sort by creation date, newest first
      transactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Add account information
      const transactionsWithAccounts = await Promise.all(
        transactions.map(async (transaction) => {
          const fromAccount = transaction.fromAccountId 
            ? await storage.getAccountById(transaction.fromAccountId) 
            : null;
          const toAccount = transaction.toAccountId 
            ? await storage.getAccountById(transaction.toAccountId) 
            : null;
          const processedByUser = transaction.processedBy 
            ? await storage.getUserById(transaction.processedBy) 
            : null;

          return { 
            ...transaction, 
            fromAccount, 
            toAccount,
            processedByUser
          };
        })
      );

      res.json(transactionsWithAccounts);
    } catch (error) {
      console.error("Get transactions error:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const transaction = await storage.getTransactionById(id);
      
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      // Check if account holder has permission to view this transaction
      if (user.role === 'Account Holder') {
        const userAccounts = await storage.getAccountsByUserId(user.id);
        const userAccountIds = userAccounts.map(acc => acc.id);
        
        const hasPermission = 
          (transaction.fromAccountId && userAccountIds.includes(transaction.fromAccountId)) ||
          (transaction.toAccountId && userAccountIds.includes(transaction.toAccountId));
          
        if (!hasPermission) {
          return res.status(403).json({ error: "Insufficient permissions" });
        }
      }

      const fromAccount = transaction.fromAccountId 
        ? await storage.getAccountById(transaction.fromAccountId) 
        : null;
      const toAccount = transaction.toAccountId 
        ? await storage.getAccountById(transaction.toAccountId) 
        : null;
      const processedByUser = transaction.processedBy 
        ? await storage.getUserById(transaction.processedBy) 
        : null;

      res.json({ 
        ...transaction, 
        fromAccount, 
        toAccount,
        processedByUser
      });
    } catch (error) {
      console.error("Get transaction error:", error);
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role === 'Account Holder') {
        return res.status(403).json({ error: "Account holders cannot create transactions" });
      }

      const transactionData = insertTransactionSchema.parse(req.body);
      const newTransaction = await storage.createTransaction({
        ...transactionData,
        processedBy: user.id
      });
      
      // Create audit log for transaction creation by Bank Staff
      await createBusinessAuditLog(
        user.id,
        user.role,
        'CreateTransaction',
        'Transaction',
        newTransaction.id,
        'Allow',
        `Transaction created by ${user.role}: ${transactionData.type} of $${transactionData.amount} - ${transactionData.description}`,
        'high'
      );
      
      res.status(201).json(newTransaction);
    } catch (error) {
      console.error("Create transaction error:", error);
      res.status(400).json({ error: "Invalid transaction data" });
    }
  });

  // Transfer endpoint (special transaction)
  app.post("/api/transfer", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { fromAccountId, toAccountId, amount, description } = transferSchema.parse(req.body) as TransferRequest;
      const transferAmount = parseFloat(amount);

      // Get account details to check ownership
      const fromAccount = await storage.getAccountById(fromAccountId);
      const toAccount = await storage.getAccountById(toAccountId);

      if (!fromAccount || !toAccount) {
        return res.status(400).json({ error: "Invalid account(s) specified" });
      }

      const authPayload = [{
        subject: {
          type: "User",
          id: user.uniqueId
        },
        action: {
          name: "CreateTransaction"
        },
        resource: {
          type: "Transaction",
          id: [
            {
              uid: {
                id: "Account Holder",
                type: "Transaction"
              },
              type: "Transaction",
              attrs: {
                amount: transferAmount,
                id: "Account Holder"
              },
              parents: []
            }
          ]
        },
        context:{
          amount: transferAmount,
          query:         "",
          query_history: "",
          prompt:        "",
          history:       { prompt: "" },
          response:      "",
        }
      }];
      
      // Call Cedar PDP service directly with authPayload
      const cedarPort = process.env.PDP_PORT || '8301';
      const cedarUrl = process.env.BANK_PDP_URL || `http://localhost:${cedarPort}/access/v1/evaluation`;
      
      // Get required headers from environment variables
  const policyStoreId = process.env.CEDAR_POLICY_STORE_ID;
  const origin = process.env.CEDAR_ORIGIN;
  const authorization = process.env.CEDAR_AUTHORIZATION;
      
      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (policyStoreId) headers['policyStoreId'] = policyStoreId;
      if (origin) headers['Origin'] = origin;
      if (authorization) headers['Authorization'] = authorization;
      
      const cedarResponse = await fetch(cedarUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(authPayload)
      });
      
      if (!cedarResponse.ok) {
        console.error(`Cedar service responded with status: ${cedarResponse.status}`);
        return res.status(503).json({ 
          error: "Authorization service unavailable",
          message: "Unable to verify authorization. Please try again later."
        });
      }
      
      const cedarResult = await cedarResponse.json();
      console.log("Cedar authorization result for transfer:", cedarResult);
      
      // Check if Cedar authorization allows the transfer
      if (!cedarResult || !cedarResult[0] || cedarResult[0].decision !== true) {
        return res.status(403).json({ 
          message: "Unauthorized", 
        });
      }


      const result = await storage.transfer(fromAccountId, toAccountId, transferAmount, description, user.id);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Create audit log for transfer
      const isSameUserTransfer = fromAccount.userId === toAccount.userId;
      const transferType = isSameUserTransfer ? 'InternalTransfer' : 'ExternalTransfer';
      const riskLevel = user.role === 'Account Holder' && !isSameUserTransfer ? 'high' : 'medium';
      
      await createBusinessAuditLog(
        user.id,
        user.role,
        transferType,
        'Transaction',
        result.transactions?.[0]?.id || 'unknown',
        'Allow',
        `${user.role} transferred $${transferAmount} from account ${fromAccount.accountNumber} to account ${toAccount.accountNumber}: ${description}`,
        riskLevel
      );

      res.json({ 
        message: "Transfer completed successfully", 
        transactions: result.transactions 
      });
    } catch (error) {
      console.error("Transfer error:", error);
      res.status(400).json({ error: "Invalid transfer data" });
    }
  });

  app.delete("/api/transactions/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role === 'Account Holder') {
        return res.status(403).json({ error: "Account holders cannot delete transactions" });
      }

      const { id } = req.params;
      const deleted = await storage.deleteTransaction(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      res.json({ message: "Transaction deleted successfully" });
    } catch (error) {
      console.error("Delete transaction error:", error);
      res.status(500).json({ error: "Failed to delete transaction" });
    }
  });

  // Loans endpoints
  app.get("/api/loans", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Administrator has no banking access
      if (user.role === 'Administrator') {
        return res.status(403).json({ error: "Administrators do not have access to banking data" });
      }

      let loans;
      if (user.role === 'Account Holder') {
        // Account holders see only their own loans
        loans = await storage.getLoansByUserId(user.id);
      } else {
        // Bank Teller and Bank Manager see all loans (read-only for Teller)
        loans = await storage.getLoans();
      }

      // Add user information to each loan
      const loansWithUsers = await Promise.all(
        loans.map(async (loan) => {
          const loanUser = await storage.getUserById(loan.userId);
          const approvedByUser = loan.approvedBy 
            ? await storage.getUserById(loan.approvedBy) 
            : null;
          return { ...loan, user: loanUser, approvedByUser };
        })
      );

      res.json(loansWithUsers);
    } catch (error) {
      console.error("Get loans error:", error);
      res.status(500).json({ error: "Failed to fetch loans" });
    }
  });

  app.get("/api/loans/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const loan = await storage.getLoanById(id);
      
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      // Account holders can only view their own loans
      if (user.role === 'Account Holder' && loan.userId !== user.id) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const loanUser = await storage.getUserById(loan.userId);
      const approvedByUser = loan.approvedBy 
        ? await storage.getUserById(loan.approvedBy) 
        : null;
      res.json({ ...loan, user: loanUser, approvedByUser });
    } catch (error) {
      console.error("Get loan error:", error);
      res.status(500).json({ error: "Failed to fetch loan" });
    }
  });

  // Loan creation endpoint (Bank staff can create on behalf of Account Holders)
  app.post("/api/loans", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const loanData = insertLoanSchema.parse(req.body);
      
      // Bank staff can create loans for any account holder
      // Account holders can only apply for themselves (handled by different endpoint)
      const newLoan = await storage.createLoan({
        ...loanData,
        approvedBy: loanData.status === 'approved' ? user.id : undefined
      });
      
      res.status(201).json(newLoan);
    } catch (error) {
      console.error("Create loan error:", error);
      res.status(400).json({ error: "Invalid loan data" });
    }
  });

  // Loan application endpoint (for Account Holders)
  app.post("/api/loans/apply", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Only Account Holders can apply for loans
      if (user.role !== 'Account Holder') {
        return res.status(403).json({ error: "Only Account Holders can apply for loans" });
      }

      const { type, amount, termMonths, purpose } = req.body;
      const loanAmount = parseFloat(amount);

      // Calculate estimated monthly payment and interest rate (simplified calculation)
      const baseInterestRates = {
        personal: 8.5,
        auto: 6.75,
        home: 4.25,
        business: 9.5
      };

      const interestRate = baseInterestRates[type as keyof typeof baseInterestRates];
      const monthlyRate = interestRate / 100 / 12;
      const monthlyPayment = (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                            (Math.pow(1 + monthlyRate, termMonths) - 1);

      const loanData = {
        userId: user.id,
        type,
        amount: loanAmount.toFixed(2),
        interestRate: interestRate.toFixed(2),
        termMonths,
        monthlyPayment: monthlyPayment.toFixed(2),
        remainingBalance: loanAmount.toFixed(2),
        status: 'pending',
        notes: `Loan application: ${purpose}`,
        approvedBy: null
      };

      const newLoan = await storage.createLoan(loanData);
      res.status(201).json({ 
        message: "Loan application submitted successfully", 
        loan: newLoan 
      });
    } catch (error) {
      console.error("Loan application error:", error);
      res.status(400).json({ error: "Invalid loan application data" });
    }
  });

  // Loan approval/rejection endpoint (for Bank Staff)
  app.patch("/api/loans/:id/decision", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Only Bank staff can work with loans
      if (user.role === 'Account Holder' || user.role === 'Administrator') {
        return res.status(403).json({ error: "Only Bank staff can approve or reject loans" });
      }

      // Bank Teller can VIEW loans but cannot edit/approve/reject them
      if (user.role === 'Bank Teller') {
        return res.status(403).json({ error: "Bank Tellers can view loans but cannot approve, reject, or modify them" });
      }

      const { id } = req.params;
      const { decision, interestRate, notes } = req.body;

      const loan = await storage.getLoanById(id);
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      // Bank Teller workflow: Can approve/reject from pending or accepted loans, offer from pending
      if (user.role === 'Bank Teller') {
        if (loan.status === 'pending') {
          if (!['approved', 'offered', 'rejected'].includes(decision)) {
            return res.status(400).json({ error: "Bank Tellers can approve, offer, or reject pending loans" });
          }
        } else if (loan.status === 'accepted') {
          if (!['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({ error: "Bank Tellers can approve or reject accepted loans" });
          }
        } else {
          return res.status(400).json({ error: "Bank Tellers can only process pending or accepted loans" });
        }
      }

      // Bank Manager workflow: Can approve/reject from pending or accepted loans, offer from pending  
      if (user.role === 'Bank Manager') {
        if (loan.status === 'pending') {
          if (!['approved', 'offered', 'rejected'].includes(decision)) {
            return res.status(400).json({ error: "Bank Managers can approve, offer, or reject pending loans" });
          }
        } else if (loan.status === 'accepted') {
          if (!['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({ error: "Bank Managers can approve or reject accepted loans" });
          }
        } else {
          return res.status(400).json({ error: "Bank Managers can only process pending or accepted loans" });
        }
      }

      if (!['pending', 'accepted', 'offered'].includes(loan.status)) {
        return res.status(400).json({ error: "Loan cannot be processed in its current status" });
      }

      const updates: any = {
        status: decision,
        approvedBy: user.id,
        notes: notes || loan.notes
      };

      if (decision === 'approved' && interestRate) {
        updates.interestRate = parseFloat(interestRate).toFixed(2);
        
        // Recalculate monthly payment with new interest rate
        const loanAmount = parseFloat(loan.amount);
        const monthlyRate = parseFloat(interestRate) / 100 / 12;
        const monthlyPayment = (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, loan.termMonths)) / 
                              (Math.pow(1 + monthlyRate, loan.termMonths) - 1);
        updates.monthlyPayment = monthlyPayment.toFixed(2);
      }

      const updatedLoan = await storage.updateLoan(id, updates);
      
      // Create audit log for loan decision
      let loanAction = '';
      if (user.role === 'Bank Teller') {
        loanAction = decision === 'offered' ? 'OfferLoan' : 'RejectLoan';
      } else if (user.role === 'Bank Manager') {
        loanAction = decision === 'approved' ? 'ApproveLoan' : `${decision.charAt(0).toUpperCase() + decision.slice(1)}Loan`;
      }
      
      await createBusinessAuditLog(
        user.id,
        user.role,
        loanAction,
        'Loan',
        id,
        'Allow',
        `${user.role} processed loan: ${decision} - Amount: $${loan.amount}, Type: ${loan.type}, Notes: ${notes || 'None'}`,
        'high'
      );
      
      // Return appropriate message based on role and action
      let message;
      if (user.role === 'Bank Teller') {
        if (decision === 'offered') {
          message = "Loan offer sent to customer. They can now accept or decline the offer.";
        } else if (decision === 'rejected') {
          message = "Loan application rejected.";
        }
      } else if (user.role === 'Bank Manager') {
        if (decision === 'approved') {
          message = "Loan approved and activated successfully.";
        } else {
          message = `Loan ${decision} successfully`;
        }
      } else {
        message = `Loan ${decision} successfully`;
      }
      
      res.json({ 
        message, 
        loan: updatedLoan 
      });
    } catch (error) {
      console.error("Loan decision error:", error);
      res.status(400).json({ error: "Invalid loan decision data" });
    }
  });

  // Loan acceptance endpoint (for Account Holders)
  app.patch("/api/loans/:id/accept", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const loan = await storage.getLoanById(id);
      
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      // Only the loan owner can accept/decline
      if (loan.userId !== user.id) {
        return res.status(403).json({ error: "You can only accept your own loan offers" });
      }

      if (loan.status !== 'offered') {
        return res.status(400).json({ error: "This loan offer is no longer available" });
      }

      const updatedLoan = await storage.updateLoan(id, {
        status: 'accepted',
        notes: `${loan.notes || ''}\n\nLoan accepted by customer on ${new Date().toISOString()}`
      });

      // Create audit log for loan acceptance
      await createBusinessAuditLog(
        user.id,
        user.role,
        'AcceptLoan',
        'Loan',
        id,
        'Allow',
        `Account Holder accepted loan offer - Amount: $${loan.amount}, Type: ${loan.type}`,
        'medium'
      );

      res.json({ 
        message: "Loan offer accepted successfully. It will now be reviewed for final approval.", 
        loan: updatedLoan 
      });
    } catch (error) {
      console.error("Loan acceptance error:", error);
      res.status(500).json({ error: "Failed to accept loan" });
    }
  });

  // Loan decline endpoint (for Account Holders)
  app.patch("/api/loans/:id/decline", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const loan = await storage.getLoanById(id);
      
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      // Only the loan owner can accept/decline
      if (loan.userId !== user.id) {
        return res.status(403).json({ error: "You can only decline your own loan offers" });
      }

      if (loan.status !== 'offered') {
        return res.status(400).json({ error: "This loan offer is no longer available" });
      }

      const updatedLoan = await storage.updateLoan(id, {
        status: 'rejected',
        notes: `${loan.notes || ''}\n\nLoan offer declined by customer on ${new Date().toISOString()}`
      });

      // Create audit log for loan decline
      await createBusinessAuditLog(
        user.id,
        user.role,
        'DeclineLoan',
        'Loan',
        id,
        'Allow',
        `Account Holder declined loan offer - Amount: $${loan.amount}, Type: ${loan.type}`,
        'medium'
      );

      res.json({ 
        message: "Loan offer declined.", 
        loan: updatedLoan 
      });
    } catch (error) {
      console.error("Loan decline error:", error);
      res.status(500).json({ error: "Failed to decline loan" });
    }
  });

  app.patch("/api/loans/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { id } = req.params;
      const loan = await storage.getLoanById(id);
      
      if (!loan) {
        return res.status(404).json({ error: "Loan not found" });
      }

      // Account holders cannot edit loans
      if (user.role === 'Account Holder') {
        return res.status(403).json({ error: "Account holders cannot edit loans" });
      }

      const updates = insertLoanSchema.partial().parse(req.body);
      
      // If approving/rejecting loan, record who did it
      if (updates.status && ['approved', 'rejected'].includes(updates.status)) {
        updates.approvedBy = user.id;
      }

      const updatedLoan = await storage.updateLoan(id, updates);
      res.json(updatedLoan);
    } catch (error) {
      console.error("Update loan error:", error);
      res.status(400).json({ error: "Invalid loan data" });
    }
  });

  app.delete("/api/loans/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || user.role !== 'Bank Manager') {
        return res.status(403).json({ error: "Only Bank Managers can delete loans" });
      }

      const { id } = req.params;
      const deleted = await storage.deleteLoan(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Loan not found" });
      }

      res.json({ message: "Loan deleted successfully" });
    } catch (error) {
      console.error("Delete loan error:", error);
      res.status(500).json({ error: "Failed to delete loan" });
    }
  });

  // === CEDAR AUTHORIZATION ENDPOINTS ===
  // Delete Account with Cedar Authorization
  app.post("/api/accounts/delete-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "DeleteAccount",
        "Account",
        "12q34"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Offer Loan with Cedar Authorization
  app.post("/api/loans/offer-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "OfferLoan",
        "Loan",
        "loan-123"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Create Loan with Cedar Authorization
  app.post("/api/loans/create-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "CreateLoan",
        "Loan",
        "loan-456"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Reject Loan with Cedar Authorization
  app.post("/api/loans/reject-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "RejectLoan",
        "Loan",
        "loan-789"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Decline Loan with Cedar Authorization
  app.post("/api/loans/decline-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "DeclineLoan",
        "Loan",
        "loan-101"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Approve Loan with Cedar Authorization
  app.post("/api/loans/approve-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "ApproveLoan",
        "Loan",
        "loan-202"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Accept Loan with Cedar Authorization
  app.post("/api/loans/accept-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "AcceptLoan",
        "Loan",
        "loan-303"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Submit Account Changes with Cedar Authorization
  app.post("/api/accounts/submit-changes-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "SubmitAccountChanges",
        "Account",
        "account-404"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Approve Account Changes with Cedar Authorization
  app.post("/api/accounts/approve-changes-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "ApproveAccountChanges",
        "Account",
        "account-505"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Update Account Details with Cedar Authorization
  app.post("/api/accounts/update-details-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "UpdateAccountDetails",
        "Account",
        "account-606"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Switch User with Cedar Authorization
  app.post("/api/users/switch-with-auth", async (req, res) => {
    try {
      console.log("inside switch list")
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      console.log("user..",user)
      const allUsers = await storage.getUsers();
      const switchableUsers = [];

      let flag = false

      // Check Cedar authorization for each user to see if current user can switch to them
      for (const targetUser of allUsers) {
        try {
          const cedarResult = await evaluateCedarAuthorization(
            user.uniqueId || user.id,
            "SwitchUser",
            "User",
            targetUser.uniqueId || targetUser.id
          );

          console.log("cedarResult..",cedarResult)
          // Check if Cedar authorization allows switching to this user
          if (cedarResult && cedarResult[0] && cedarResult[0].decision === true) {
            flag = true
            break
          }
        } catch (error) {
          console.error(`Cedar authorization error for user ${targetUser.id}:`, error);
          // Continue to next user if authorization check fails
        }
      }
        res.json([
          {
            "decision": flag
          }
        ])
    } catch (error) {
      console.error("Get switchable users error:", error);
      res.status(500).json({ error: "Failed to fetch switchable users" });
    }
  });

  // View Audit Logs with Cedar Authorization
  app.post("/api/audit-logs/view-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "ViewAuditLogs",
        "AuditLog",
        "audit-log-808"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  // Export Audit Logs with Cedar Authorization
  app.post("/api/audit-logs/export-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cedarResult = await evaluateCedarAuthorization(
        user.uniqueId || user.id,
        "ExportAuditLogs",
        "AuditLog",
        "audit-log-909"
      );

      res.json(cedarResult);
    } catch (error) {
      console.error("Cedar authorization error:", error);
      res.status(500).json({ error: "Failed to evaluate authorization" });
    }
  });

  app.get("/api/user/list", async (req, res) => {
    try {
      console.log("inside switch list")
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      console.log("user..",user)
      const allUsers = await storage.getUsers();
      const switchableUsers = [];

      // Check Cedar authorization for each user to see if current user can switch to them
      for (const targetUser of allUsers) {
        try {
          const cedarResult = await evaluateCedarAuthorization(
            user.uniqueId || user.id,
            "SwitchUser",
            "User",
            targetUser.uniqueId || targetUser.id
          );

          console.log("cedarResult..",cedarResult)
          // Check if Cedar authorization allows switching to this user
          if (cedarResult && cedarResult[0] && cedarResult[0].decision === true) {
            switchableUsers.push({
              id: targetUser.id,
              uniqueId: targetUser.uniqueId,
              name: targetUser.name,
              email: targetUser.email,
              role: targetUser.role,
              status: targetUser.status
            });
          }
        } catch (error) {
          console.error(`Cedar authorization error for user ${targetUser.id}:`, error);
          // Continue to next user if authorization check fails
        }
      }

      res.json(switchableUsers);
    } catch (error) {
      console.error("Get switchable users error:", error);
      res.status(500).json({ error: "Failed to fetch switchable users" });
    }
  });

  // === AUDIT LOGS ENDPOINTS ===
  // Get audit logs (Bank Managers and Bank Tellers)
  app.get("/api/audit-logs", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Only Bank staff can access audit logs
      if (user.role === 'Account Holder') {
        return res.status(403).json({ error: "Access denied. Only Bank staff can view audit logs." });
      }

      // Parse query parameters
      const queryParams = {
        principalId: req.query.principalId as string,
        principalRole: req.query.principalRole as string,
        action: req.query.action as string,
        resourceType: req.query.resourceType as string,
        decision: req.query.decision as string,
        riskLevel: req.query.riskLevel as string,
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      // Remove undefined values
      const filters = Object.fromEntries(
        Object.entries(queryParams).filter(([_, value]) => value !== undefined && value !== '')
      ) as Partial<AuditLogQuery>;

      // Convert date strings to Date objects if provided
      if (filters.fromDate) {
        (filters as any).fromDate = new Date(filters.fromDate);
      }
      if (filters.toDate) {
        (filters as any).toDate = new Date(filters.toDate);
      }

      const auditLogs = await storage.getAuditLogs(filters);
      
      res.json({ 
        auditLogs,
        total: auditLogs.length,
        filters: filters
      });
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  // Get specific audit log by ID (Bank Managers and Bank Tellers)
  app.get("/api/audit-logs/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Only Bank staff can access audit logs
      if (user.role === 'Account Holder') {
        return res.status(403).json({ error: "Access denied. Only Bank staff can view audit logs." });
      }

      const auditLog = await storage.getAuditLogById(req.params.id);
      
      if (!auditLog) {
        return res.status(404).json({ error: "Audit log not found" });
      }

      res.json({ auditLog });
    } catch (error) {
      console.error("Error fetching audit log:", error);
      res.status(500).json({ error: "Failed to fetch audit log" });
    }
  });

  // Get audit log statistics (Bank Managers and Bank Tellers)
  app.get("/api/audit-logs/stats/summary", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Only Bank staff can access audit statistics
      if (user.role === 'Account Holder') {
        return res.status(403).json({ error: "Access denied. Only Bank staff can view audit statistics." });
      }

      // Get all audit logs for statistics
      const allLogs = await storage.getAuditLogs({ limit: 10000 });

      // Calculate statistics
      const stats = {
        totalRequests: allLogs.length,
        allowedRequests: allLogs.filter(log => log.decision === 'Allow').length,
        deniedRequests: allLogs.filter(log => log.decision === 'Deny').length,
        highRiskActions: allLogs.filter(log => log.riskLevel === 'high' || log.riskLevel === 'critical').length,
        roleBreakdown: {} as Record<string, number>,
        actionBreakdown: {} as Record<string, number>,
        riskLevelBreakdown: {} as Record<string, number>,
        recentActivity: allLogs.slice(0, 10).map(log => ({
          id: log.id,
          principalRole: log.principalRole,
          action: log.action,
          decision: log.decision,
          riskLevel: log.riskLevel,
          createdAt: log.createdAt
        }))
      };

      // Calculate role breakdown
      allLogs.forEach(log => {
        stats.roleBreakdown[log.principalRole] = (stats.roleBreakdown[log.principalRole] || 0) + 1;
      });

      // Calculate action breakdown (top 10)
      allLogs.forEach(log => {
        stats.actionBreakdown[log.action] = (stats.actionBreakdown[log.action] || 0) + 1;
      });

      // Calculate risk level breakdown
      allLogs.forEach(log => {
        stats.riskLevelBreakdown[log.riskLevel] = (stats.riskLevelBreakdown[log.riskLevel] || 0) + 1;
      });

      res.json({ stats });
    } catch (error) {
      console.error("Error fetching audit statistics:", error);
      res.status(500).json({ error: "Failed to fetch audit statistics" });
    }
  });

  // Update user risk level endpoint
  app.patch("/api/user/risk-level", async (req, res) => {
    try {
      const { username } = req.query;
      const { riskLevel } = req.body;

      // Validate username query parameter
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ 
          error: "Username query parameter is required" 
        });
      }

      // Validate risk level
      if (!riskLevel || !['Low', 'Medium', 'High', 'Critical'].includes(riskLevel)) {
        return res.status(400).json({ 
          error: "Invalid risk level. Must be one of: Low, Medium, High, Critical" 
        });
      }

      const targetUser = await storage.getUserByName(username);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Update the user's risk level
      const updatedUser = await storage.updateUser(targetUser.id, {
        riskLevel: riskLevel,
        lastProfileUpdate: new Date()
      });

      if (!updatedUser) {
        return res.status(500).json({ error: "Failed to update user risk level" });
      }

      res.json({ 
        message: "User risk level updated successfully",
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          riskLevel: updatedUser.riskLevel
        }
      });

    } catch (error) {
      console.error("Error updating user risk level:", error);
      res.status(500).json({ error: "Failed to update user risk level" });
    }
  });

  app.post("/api/transaction/transfer-with-auth", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const currentValue = await storage.getUserByName(user.name);
      if (!currentValue) {
        return res.status(404).json({ error: "User not found" });
      }

      const authPayload = [
        {
            "subject": {
                "type": "User",
                "id": [
                    {
                        "uid": {
                            "id": "12334",
                            "type": "User"
                        },
                        "type": "User",
                        "attrs": {
                            "riskLevel": currentValue.riskLevel,
                            "role": currentValue.role
                        },
                        "parents": []
                    }
                ]
            },
            "action": {
                "name": "TransferFunds"
            },
            "resource": {
                "type": "Transaction",
                "id": "txn-001"
            },
            "context":{
              "riskLevel": currentValue.riskLevel,
              "query":         "",
              "query_history": "",
              "prompt":        "",
              "history":       { "prompt": "" },
              "response":      "",
            }
        }
    ];

    console.log("authPayload.....", JSON.stringify(authPayload, null, 2))
    console.log("user.riskLevel.",user.riskLevel)
    console.log("user.role...",user.role)
      
      // Call Cedar PDP service directly with authPayload
      const cedarPort = process.env.PDP_PORT || '8301';
      const cedarUrl = process.env.BANK_PDP_URL || `http://localhost:${cedarPort}/access/v1/evaluation`;
      
      // Get required headers from environment variables
  const policyStoreId = process.env.CEDAR_POLICY_STORE_ID;
  const origin = process.env.CEDAR_ORIGIN;
  const authorization = process.env.CEDAR_AUTHORIZATION;
      
      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (policyStoreId) headers['policyStoreId'] = policyStoreId;
      if (origin) headers['Origin'] = origin;
      if (authorization) headers['Authorization'] = authorization;
      
      const cedarResponse = await fetch(cedarUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(authPayload)
      });
      
      if (!cedarResponse.ok) {
        console.error(`Cedar service responded with status: ${cedarResponse.status}`);
        return res.status(503).json({ 
          error: "Authorization service unavailable",
          message: "Unable to verify authorization. Please try again later."
        });
      }
      
      const cedarResult = await cedarResponse.json();
      console.log("Cedar authorization result for transfer:", cedarResult);
      

        return res.json([{ 
          "decision":cedarResult[0].decision 
        }]);

    } catch (error) {
      console.error("Transfer error:", error);
      res.status(400).json({ error: "Invalid transfer data" });
    }
  });


  // Agent chat endpoint
    app.post("/api/agent/chat", async (req: any, res) => {
    try {
      const user = req.session?.claims || req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      // The browser owns the conversation (see the widget in client/index.html):
      // it mints the chat id, stamps the chat's start once, counts the turn and
      // summarises completed turns. This layer forwards them and adds nothing.
      const { message, sessionId, turn, sessionStartedAt, sessionMessages, hitl } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      // Agent session is bound to TrAT trace_id — each research flow gets an isolated
      // Bedrock context window. This prevents cross-scenario context contamination
      // (e.g. Alex injection note bleeding into Kevin approval flow).
      // TrAT trace_id is the governance boundary — same as intentRegistry, nonces, HITL state.
      const tratPayload = (req as any).trat;
      const agentSessionId = sessionId || uuidv4();

      // Record raw user message for guardrail query/query_history
      const chatTxn = tratPayload?.trace_id;
      const chatSub = tratPayload?.sub || user.sub || user.id;
      if (chatTxn) recordMessage(chatTxn, chatSub, message);
      console.log("Agent call - userId:", user.sub || user.id, "role:", user.role, "clearanceLevel:", user.clearance_level, "branchId:", user.branch_id, "act:", JSON.stringify(user.act));
      // TrAT already validated by requireTrAT middleware — extract from Authorization header
      const authHeader = req.headers["authorization"] as string || "";
      const trat = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
      console.log("Agent chat - trat present:", !!trat, "length:", trat?.length ?? 0);
      console.log("Agent chat - idToken present:", !!req.session?.idToken, "length:", req.session?.idToken?.length ?? 0);
      console.log("Agent chat - idToken first 20 chars:", req.session?.idToken?.substring(0, 20));
      

      // ONE trace id per user message, minted HERE — at the top of the turn —
      // and sent as W3C trace context.
      //
      // This is the only place that can mint it. Everything downstream is a
      // participant: the agent's SDK adopts an inbound `traceparent` as its
      // trace root, our own evaluate seam adopts the same value, and the
      // sub-agent hops forward it again. Without it each of those mints its own
      // and ONE scenario lands in the decision log as three unrelated traces —
      // which is what shipped, because the agent was trying to adopt an id from
      // the SDK that the SDK does not publish there.
      //
      // Per MESSAGE, not per session: a trace is one user request and the hops
      // underneath it. Per-session would merge a whole conversation into one row
      // group and lose the boundary that makes the log readable.
      const traceHex = uuidv4().replace(/-/g, "");
      const spanHex = uuidv4().replace(/-/g, "").slice(0, 16);

      // This turn's prompt only. Earlier turns are deliberately not accumulated —
      // see the note on cross-trace chat history at the top of this file.
      console.log("Agent chat - prompt:", message);
      // Printed so a decision-log row can be matched to a turn without
      // guessing from timestamps. The agent prints the same id on every
      // [authz] evaluate line; if the two ever differ, adoption is broken.
      console.log("Agent chat - trace:", traceHex);

      // document_name and sensitivity_label are NOT sent from here.
      //
      // This layer could only regex a filename out of the message; it has no way
      // to resolve the label, so it sent the name with an EMPTY label — and the
      // agent's middleware, which does resolve it, sent the real pair under the
      // prefixed names the policy store declares. Two producers, one of them
      // wrong, and the empty bare copy is the one a policy would have matched.
      //
      // The agent is the single producer now. See ATTR_PREFIX in agent/server.py.

      const agentReq: RequestInit = {
        method: "POST",
        headers:
        {
              "Content-Type": "application/json",
              // 00-<32 hex trace>-<16 hex span>-01. The trailing 01 is "sampled";
              // 00 there means the collector may drop the trace and the decision
              // rows go missing rather than wrong, which is harder to notice.
              "traceparent": `00-${traceHex}-${spanHex}-01`,
              ...(() => { const t = req.session?.accessToken || req.session?.idToken || ""; return t ? { "Authorization": `Bearer ${t}` } : {}; })(),
        },
        body: JSON.stringify({
          message: message,
          session_id: agentSessionId,
          user_id: user.sub || user.id,
          user_name: user.name || user.email || "",
          role: user.role || "",
          clearance_level: user.clearance_level ?? 0,
          branch_id: user.branch_id || "",
          department: user.department || "",
          trat_token: trat || "",
          prompt: message,
          query: message,
          // Sent EMPTY on purpose. Both are the SDK's conventional-history intake
          // and either one non-empty seeds this trace's hop chain with the previous
          // message's text. Kept as keys (rather than dropped) so the wire shape is
          // stable and the emptiness is visibly deliberate in a captured payload.
          //
          // Prior turns travel in `session_messages` below instead — a separate,
          // structured channel that the PDP reads as session history rather than
          // as the root of this trace's hop chain. The two are not interchangeable.
          query_history: "",
          history: { prompt: "" },
          // turn and the history MUST travel together: the PDP requires
          // turn >= 2 whenever session messages are present, and refuses the
          // mismatch on the entry hop.
          turn: Number(turn) || 1,
          // The CHAT's start, not this turn's. A start time that postdates the
          // history it is sent with is refused.
          session_started_at: sessionStartedAt || "",
          session_messages: Array.isArray(sessionMessages) ? sessionMessages : [],
          // A decision replayed with the original turn. Absent means NOBODY HAS
          // BEEN ASKED — a different statement from "pending", and the one the
          // Cedar `has` guard reads correctly.
          hitl: hitl || null,
        }),
      };
      let langGraphRes = await fetch(`${LANGGRAPH_URL}/chat`, agentReq);
      // ONE retry when the agent's ENTRY hop could not reach the PDP. The SDK
      // decorator raises before the handler runs, so nothing has happened and
      // re-sending is safe — the agent says so with `retryable` on a 503
      // (server.pdp_unavailable_handler). Same traceparent: one user message,
      // one trace, however many attempts it took. Only this seam can retry the
      // entry hop; the SDK does not.
      if (langGraphRes.status === 503) {
        const peek: any = await langGraphRes.clone().json().catch(() => ({}));
        if (peek && peek.retryable) {
          console.warn("[authz] RETRY 1/1 entry hop after 503 (PDP unavailable), trace:", traceHex);
          await new Promise((r) => setTimeout(r, 800));
          langGraphRes = await fetch(`${LANGGRAPH_URL}/chat`, agentReq);
        }
      }

      // ── DEBUG: read body ONCE as text, log status + raw body, then parse ──
      const langGraphRaw = await langGraphRes.text();
      console.log("LangGraph status:", langGraphRes.status);
      console.log("LangGraph body:", langGraphRaw);

      let langGraphData: any = {};
      try { langGraphData = JSON.parse(langGraphRaw); } catch { langGraphData = {}; }

      const response = langGraphData.response || "I couldn't process your request.";
      // Forward the PDP-deny flag so the chat widget can render a policy block
      // distinctly instead of as a normal answer.
      const denied = langGraphData.denied === true;
      const filtered = langGraphData.filtered === true;
      // Forward the agent's own routing label instead of a hardcoded one: it
      // names the sub-agent that actually answered (documents-agent-local,
      // credit-agent-local, …) and matches the ids in the Reva decision log.
      const agent = langGraphData.agent || "finbot-agent";
      // A gated action stopped the turn: the agent did NOT run it, and `pending`
      // describes what is waiting. Named explicitly here rather than spread,
      // because this layer is the app↔agent contract — but note that anything
      // the agent starts sending and this does not name is dropped SILENTLY,
      // since a missing key is only ever `undefined`. That is how these two were
      // lost the first time.
      const status = langGraphData.status || "ok";
      const pending = langGraphData.pending || null;
      // Authorization could not be COMPLETED on some hop — "token",
      // "unavailable" or "error". Not a policy verdict; the widget labels it
      // differently from a block. Named here for the reason given above.
      const fault = typeof langGraphData.fault === "string" ? langGraphData.fault : "";
      // WHICH hop a policy refused — {resource, reason, hitl}. The PDP does not
      // name the policy; the widget maps the refused resource onto the store's
      // forbids (DEMO_EXPLAIN_DENIES). Only meaningful beside `denied`.
      const deny = denied && langGraphData.deny && typeof langGraphData.deny === "object"
        ? {
            resource: String(langGraphData.deny.resource || ""),
            reason: String(langGraphData.deny.reason || ""),
            hitl: String(langGraphData.deny.hitl || ""),
          }
        : null;

      // A gated action stopped the turn. Record who is being asked what, and
      // hand the client an id to watch. The approval is created BEFORE the
      // Slack attempt, so a Slack outage loses the notification and not the
      // request — the in-app queue still has it.
      let approvalId: string | null = null;
      if (status === "pending_approval" && pending) {
        const approval = approvals.create(pending, {
          email: user.email || user.sub || "",
          id:    user.sub || user.id || "",
        });
        approvalId = approval.id;
        if (slack.slackEnabled()) {
          try {
            approval.slack = await slack.postApprovalCard(approval);
          } catch (e: any) {
            // Degrade, do not fail. Recorded on the approval so the queue can
            // say the card never went out — a missing card is indistinguishable
            // from one nobody has looked at yet.
            approval.slackError = e?.message || String(e);
            console.warn(`[hitl] Slack card failed for ${approval.id}, in-app queue only: ${approval.slackError}`);
          }
        }
        console.log(JSON.stringify({ event: "HITL_PENDING", id: approval.id,
          tool: approval.tool, requester: approval.requester,
          session: approval.sessionId, slack: Boolean(approval.slack) }));
      }

      // Whose turn this was, from the session this request carried — so the
      // widget can say so when it is not who the tab thinks is signed in.
      const ranAs = String(user.email || user.sub || "");
      // One line per user message: the chat (thread), the message (trace) and
      // how it ended. The agent prints a [corr] line per hop with the same
      // thread and trace, so the two logs join on them.
      const corrOutcome = status === "pending_approval" ? "pending"
        : denied ? "deny" : (fault || "allow");
      console.log(`[corr] thread=${agentSessionId} trace=${traceHex} user=${ranAs || "-"} ` +
                  `turn=${Number(turn) || 1} outcome=${corrOutcome}` +
                  (hitl && hitl.status ? ` replay=${hitl.status}` : ""));
      res.json({ response, sessionId: agentSessionId, agent, denied, filtered,
                 fault, deny, traceId: traceHex, ranAs, status, pending, approvalId });
    } catch (error: any) {
      console.error("Agent error:", error);
      res.status(500).json({ error: error.message || "Agent error" });
    }
  });

  app.get("/api/agent/sharepoint-status", async (_req: any, res) => {
    res.json({ ok: true, message: "SharePoint access via Azure Foundry OBO" });
  });
  // ── /api/agent/hitl/acknowledge ────────────────────────────────────────────
  // Called by frontend when user clicks APPROVE in HITL notification
  // Marks HITL as properly acknowledged — required for approveLoan to proceed
  // ── /api/agent/hitl/status — UI polls this to detect HITL independently of Bedrock ──
  app.get("/api/agent/hitl/status", requireTrATPassthrough, async (req, res) => {
    const trat = (req as any).trat;
    const txn  = trat?.trace_id;
    if (!txn) return res.json({ hitlRequired: false });
    // Find any loanId with pending HITL in this session
    const session = getIntentSession(txn);
    if (!session) return res.json({ hitlRequired: false });
    const pendingLoanId = Object.keys(session.hitlRequired || {}).find(
      lid => session.hitlRequired[lid] === true && !session.hitlAcknowledged[lid]
    );
    if (!pendingLoanId) return res.json({ hitlRequired: false });
    const loan = await storage.getLoanById(pendingLoanId);
    const applicant = loan ? await storage.getUserById(loan.userId) : null;
    res.json({
      hitlRequired: true,
      loanId:       pendingLoanId,
      applicant:    (applicant as any)?.name || "",
      amount:       loan?.amount || "0",
      creditScore:  (applicant as any)?.creditScore || null,
    });
  });

  app.post("/api/agent/hitl/acknowledge", requireAuth, requireTrATPassthrough, (req: any, res) => {
    const trat  = (req as any).trat;
    const txn   = trat?.trace_id || "";
    const { loanId } = req.body;
    if (!txn || !loanId) return res.status(400).json({ error: "txn and loanId required" });
    acknowledgeHitl(txn, loanId);
    console.log(JSON.stringify({ eventId: `HITL-${txn.split("-")[0].toUpperCase()}`, event: "HITL_ACKNOWLEDGED", txn, loanId, sub: trat?.sub }));
    res.json({ acknowledged: true, txn, loanId });
  });

  // ══ Approvals: the queue, the decision, and the Slack callback ══════════════
  //
  // Deciding here does NOT run the action. It records a verdict; the client then
  // replays the original turn carrying it, and the policy decides. That
  // separation is the whole design — see HITL-CONTRACT.md.

  // Who may answer. A role list rather than a hardcoded role, because the
  // "second person" in a real bank is an org decision, not ours.
  const APPROVER_ROLES = (process.env.HITL_APPROVER_ROLES || "Bank Manager")
    .split(",").map(r => r.trim()).filter(Boolean);

  const canApprove = (role: string) => APPROVER_ROLES.includes(role);

  // The queue. Bank staff see what is waiting on them.
  app.get("/api/approvals", requireAuth, (req: any, res) => {
    const user = req.user;
    if (!canApprove(user.role)) {
      return res.status(403).json({ error: `Only ${APPROVER_ROLES.join(" / ")} can review approvals` });
    }
    res.json({
      pending: approvals.listPending(),
      recent:  approvals.listAll(20).filter(a => a.status !== "pending"),
      makerChecker: approvals.MAKER_CHECKER,
      you: user.sub,
    });
  });

  // The requester polls this. Deliberately readable by the REQUESTER as well as
  // approvers — they are waiting on it, and it carries no more than they sent.
  app.get("/api/approvals/:id", requireAuth, (req: any, res) => {
    const approval = approvals.get(req.params.id);
    if (!approval) return res.status(404).json({ error: "No such approval" });
    const user = req.user;
    if (approval.requesterId !== (user.sub || user.id) && !canApprove(user.role)) {
      return res.status(403).json({ error: "Not yours to view" });
    }
    res.json({ approval, verdict: approvals.verdictFor(approval) });
  });

  // In-app decision.
  app.post("/api/approvals/:id/decide", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (!canApprove(user.role)) {
      return res.status(403).json({ error: `Only ${APPROVER_ROLES.join(" / ")} can decide approvals` });
    }
    const verdict = String(req.body?.verdict || "");
    if (verdict !== "approved" && verdict !== "rejected") {
      return res.status(400).json({ error: "verdict must be 'approved' or 'rejected'" });
    }
    const result = approvals.decide(req.params.id, verdict, user.sub || "");
    if (!result.ok) {
      const code = result.reason === "not_found" ? 404 : 409;
      return res.status(code).json({
        error: result.reason,
        message:
          result.reason === "self_approval"
            ? "You raised this request, so you cannot also approve it. Ask another " +
              `${APPROVER_ROLES.join(" / ")} to decide, or set HITL_MAKER_CHECKER=false ` +
              "to allow self-approval in a single-user demo."
            : result.reason === "already_decided"
            ? `Already ${result.approval?.status} by ${result.approval?.approver}.`
            : "No such approval.",
        approval: result.approval,
      });
    }
    console.log(JSON.stringify({ event: "HITL_DECIDED", id: result.approval!.id,
      verdict, approver: result.approval!.approver, via: "app" }));
    if (result.approval!.slack) await slack.updateApprovalCard(result.approval!);
    res.json({ approval: result.approval, verdict: approvals.verdictFor(result.approval!) });
  });

  // ── Slack click ────────────────────────────────────────────────────────────
  // Mounted with express.raw() in index.ts, BEFORE express.json(). Slack signs
  // the bytes it sent, so this handler must see them unparsed.
  //
  // Everything here fails closed. An unverified signature, an unresolvable
  // approver, an unknown id — none of them become a verdict.
  app.post("/api/slack/interactions", async (req: any, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

    if (!slack.slackEnabled()) return res.status(503).send("Slack approvals are not configured.");

    if (!slack.verifySlackSignature(
          raw,
          req.headers["x-slack-request-timestamp"] as string,
          req.headers["x-slack-signature"] as string)) {
      console.warn("[hitl] rejected a Slack interaction: signature or timestamp invalid");
      // 401 with no detail. A verification failure must not explain itself to
      // whoever sent it.
      return res.status(401).send("");
    }

    let payload: any = {};
    try {
      payload = JSON.parse(new URLSearchParams(raw.toString("utf8")).get("payload") || "{}");
    } catch {
      return res.status(400).send("Malformed payload.");
    }

    const action = payload?.actions?.[0];
    const verdict = action?.action_id === "hitl_approve" ? "approved"
                  : action?.action_id === "hitl_reject"  ? "rejected" : null;
    if (!verdict) return res.status(200).send("");

    const approverEmail = await slack.resolveApproverEmail(payload?.user?.id || "");
    if (!approverEmail) {
      // Fail CLOSED. A verdict we cannot attribute is not an approval — recording
      // it against "unknown" would look like accountability in the audit log and
      // carry none.
      console.warn(`[hitl] refusing Slack verdict: cannot resolve approver for slack user ${payload?.user?.id}`);
      return res.status(200).json({
        response_type: "ephemeral", replace_original: false,
        text: "Could not match your Slack account to a bank user, so this was not " +
              "recorded. Ask an admin to add you to SLACK_APPROVER_MAP, or decide it in the app.",
      });
    }

    // The SAME role gate as the in-app path, which this used to skip entirely.
    //
    // resolveApproverEmail returns `APPROVER_MAP[slackEmail] || slackEmail`, so
    // an UNMAPPED Slack user resolves to their own address and used to be
    // accepted on it. Anyone in the approvals channel could therefore approve a
    // loan — a teller, or somebody with no bank account at all — and the audit
    // log recorded it under a real-looking email. The in-app queue refused the
    // same person, so the two paths disagreed about who may decide.
    //
    // Resolved against the user directory, not against the map: being NAMED in
    // SLACK_APPROVER_MAP is a translation, never a grant.
    //
    // findLocalUser, not getUserByEmail — a Slack profile email routinely
    // differs from the directory by case, by dots in the local part, or by an
    // .onmicrosoft.com domain, and an exact match would refuse the right person
    // for a reason that looks like a permissions bug.
    const approver = await findLocalUser(storage, approverEmail);
    if (!approver || !canApprove(approver.role)) {
      console.warn(`[hitl] refusing Slack verdict from ${approverEmail}: ` +
                   `role=${approver?.role ?? "not a bank user"}`);
      return res.status(200).json({
        response_type: "ephemeral", replace_original: false,
        text: `Only ${APPROVER_ROLES.join(" / ")} can decide approvals, so this ` +
              "was not recorded.",
      });
    }

    const result = approvals.decide(String(action.value || ""), verdict as any, approverEmail);
    if (!result.ok) {
      const text = result.reason === "self_approval"
        ? "You raised this request, so you cannot also approve it."
        : result.reason === "already_decided"
        ? `Already ${result.approval?.status} by ${result.approval?.approver}.`
        : "That approval no longer exists.";
      return res.status(200).json({ response_type: "ephemeral", replace_original: false, text });
    }

    console.log(JSON.stringify({ event: "HITL_DECIDED", id: result.approval!.id,
      verdict, approver: approverEmail, via: "slack" }));
    await slack.updateApprovalCard(result.approval!);
    res.status(200).send("");
  });

  // ── /api/agent/transfer — Agent-initiated fund transfer with HITL ────────────
  // Cedar evaluates DelegateScope at TrAT level (amount > 5k → permit)
  // Route triggers HITL. Post-HITL, Cedar evaluates transferFunds action.
  // amount <= 10k → ALLOW, amount > 10k → DENY
  // ── /api/agent/transfer/confirm — Direct HITL confirmation endpoint ─────────
  // Called by browser after user clicks Approve in HITL notification.
  // Accepts TrAT-1 directly — no Bedrock round trip. Checks hitlAcknowledged,
  // calls Cedar, executes transfer. Returns result directly to UI.
  app.post("/api/agent/transfer/confirm", requireTrATPassthrough, async (req, res) => {
    try {
      const { requestId } = req.body;
      const trat = (req as any).trat;
      const txn  = trat?.trace_id;
      const sub  = trat?.sub;

      if (!requestId) return res.status(400).json({ error: "requestId required" });
      if (!txn || !sub) return res.status(401).json({ error: "Reva Trust Gateway denied access." });

      // Look up request
      const requests = await storage.getPendingTransferRequests() as any[];
      const req2 = requests.find((r: any) => r.requestId === requestId);
      if (!req2) return res.status(404).json({ error: "Transfer request not found." });

      const fromAccountId  = req2.fromAccountId;
      const toAccountId    = req2.toAccountId;
      const transferAmount = req2.amount;
      const transferKey    = requestId;

      // Verify HITL was acknowledged
      if (!isHitlAcknowledged(txn, transferKey)) {
        return res.status(403).json({ error: "Reva Trust Gateway denied access. HITL not acknowledged." });
      }

      // Find accounts
      const allAccounts = await storage.getAccounts();
      const fromAccount = allAccounts.find((a: any) => a.id === fromAccountId || a.accountNumber === fromAccountId);
      const toAccount   = allAccounts.find((a: any) => a.id === toAccountId   || a.accountNumber === toAccountId);
      if (!fromAccount) return res.status(404).json({ error: "Source account not found." });
      if (!toAccount)   return res.status(404).json({ error: "Destination account not found." });

      const resolvedFromId = (fromAccount as any).id;
      const resolvedToId   = (toAccount as any).id;

      // Call Cedar for TransferFunds action
      const pdpUrl        = process.env.BANK_PDP_URL || "";
      const policyStoreId = process.env.CEDAR_POLICY_STORE_ID || "";
      const pdpAuth       = process.env.CEDAR_AUTHORIZATION || "";
      const pdpOrigin     = process.env.CEDAR_ORIGIN || "";

      if (!pdpUrl || !policyStoreId) {
        return res.status(403).json({ error: "Reva Trust Gateway denied access." });
      }

      const pdpHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (policyStoreId) pdpHeaders["policyStoreId"] = policyStoreId;
      if (pdpAuth)       pdpHeaders["Authorization"]  = pdpAuth;
      if (pdpOrigin)     pdpHeaders["Origin"]          = pdpOrigin;
      const transferTraceHex = (trat?.session_trace_id || trat?.trace_id || "").replace(/-/g, "");
      if (transferTraceHex) pdpHeaders["traceparent"] = `00-${transferTraceHex.padEnd(32, "0")}-0000000000000001-01`;

      const agentId = trat?.act?.sub || "securebank-finbot-action";
      const tfTxn = trat?.session_trace_id || trat?.trace_id || "";
      const tfMsgs = getMessageHistory(tfTxn);
      const tfQuery = tfMsgs.length > 0 ? tfMsgs[tfMsgs.length - 1] : "";
      const tfQueryHist = tfMsgs.slice(0, -1).join(";");
      const cedarPayload = [{
        subject:  { type: "Agent", id: agentId },
        action:   { name: "TransferFunds" },
        resource: { type: "Transaction", id: transferKey, properties: {} },
        context:  {
          access_state:     "Active",
          adaptiveRisk:     false,
          amount:           transferAmount,
          fromAccountId:    fromAccountId,
          toAccountId:      toAccountId,
          hitlAcknowledged: true,
          hitlBypassed:     false,
          session_trace_id: tfTxn,
          query:            tfQuery,
          query_history:    tfQueryHist,
          prompt:           tfQuery,
          history:          { prompt: tfQueryHist },
          response:         "",
        }
      }];

      const pdpRes    = await fetch(pdpUrl, { method: "POST", headers: pdpHeaders, body: JSON.stringify(cedarPayload) });
      const pdpResult = await pdpRes.json();
      const raw       = Array.isArray(pdpResult) ? pdpResult[0]?.decision : pdpResult?.decision;
      const allowed   = raw === true || raw === "allow" || raw === "Allow";

      console.log(JSON.stringify({
        event: "CEDAR_TRANSFER_CONFIRM_RESPONSE",
        txn, sub, amount: transferAmount, requestId,
        decision: allowed ? "ALLOW" : "DENY",
      }));

      if (!allowed) {
        return res.status(403).json({
          approved: false,
          reason: transferAmount > 10000 ? "AMOUNT_EXCEEDS_TRANSFER_LIMIT" : "POLICY_DENIED",
          message: transferAmount > 10000
            ? `Transfer denied. Amount of $${transferAmount.toLocaleString()} exceeds the maximum allowed transfer limit.`
            : `Transfer denied by policy.`,
        });
      }

      // Execute transfer
      const result = await (storage as any).transfer(resolvedFromId, resolvedToId, transferAmount, req2.description || "Agent transfer", sub);
      if (!result.success) {
        return res.status(400).json({ error: "Transfer failed. Please try again." });
      }

      // Mark request completed + clear HITL state
      await (storage as any).completeTransferRequest(requestId);
      const session = getIntentSession(txn);
      if (session) {
        session.hitlRequired[transferKey]     = false;
        session.hitlAcknowledged[transferKey] = false;
      }

      return res.json({
        approved:    true,
        transferred: true,
        requestId,
        amount:      transferAmount,
        from:        req2.fromName,
        to:          req2.toName,
        message:     `Transfer of $${transferAmount.toLocaleString()} from ${req2.fromName} to ${req2.toName} completed successfully.`,
      });
    } catch (error: any) {
      console.error("Transfer confirm error:", error);
      res.status(500).json({ error: "Transfer failed. Please try again." });
    }
  });

    app.get("/api/agent/transfer-requests", requireTrATPassthrough, async (req, res) => {
    try {
      const requests = (await storage.getPendingTransferRequests()) as any[];
      return res.json({ requests });
    } catch (error: any) {
      res.status(500).json({ error: "Unable to retrieve transfer requests." });
    }
  });

    app.post("/api/agent/transfer", requireTrATPassthrough, async (req, res) => {
    try {
      const { fromAccountId: rawFrom, toAccountId: rawTo, amount: rawAmount, description, transferId, requestId } = req.body;
      const trat = (req as any).trat;
      const txn  = trat?.trace_id;
      const sub  = trat?.sub;

      // Resolve from requestId if provided
      let fromAccountId = rawFrom;
      let toAccountId   = rawTo;
      let transferAmount = parseInt(String(rawAmount || "0"));
      let resolvedDescription = description || "";

      if (requestId) {
        const requests = await storage.getPendingTransferRequests() as any[];
        const req2 = requests.find((r: any) => r.requestId === requestId);
        if (!req2) return res.status(404).json({ error: "Transfer request not found." });
        fromAccountId  = req2.fromAccountId;
        toAccountId    = req2.toAccountId;
        transferAmount = req2.amount;
        resolvedDescription = req2.description || description || "";
      }

      const transferKey = requestId || transferId || fromAccountId || "transfer";

      if (!fromAccountId || !toAccountId || !transferAmount) {
        return res.status(400).json({ error: "Transfer details incomplete. Please specify a valid transfer request." });
      }

      // Validate accounts — look up by account number since transfer requests use account numbers
      const allAccounts = await storage.getAccounts();
      const fromAccount = allAccounts.find((a: any) => a.id === fromAccountId || a.accountNumber === fromAccountId);
      const toAccount   = allAccounts.find((a: any) => a.id === toAccountId   || a.accountNumber === toAccountId);
      if (!fromAccount) return res.status(404).json({ error: "Source account not found." });
      if (!toAccount)   return res.status(404).json({ error: "Destination account not found." });
      // Normalise to IDs for transfer execution
      const resolvedFromId = (fromAccount as any).id;
      const resolvedToId   = (toAccount as any).id;

      // Check nonce — first call has nonce not yet consumed, triggers HITL
      // Second call (post-HITL) has hitlAcknowledged=true
      let hitlAcknowledged = false;
      if (txn && sub) {
        const storedNonce = getStoredNonce(txn, transferKey);
        const tratNonce   = trat?.intent?.transferNonce || "";

        if (storedNonce && tratNonce && storedNonce === tratNonce) {
          if (isHitlRequired(txn, transferKey) && !isHitlAcknowledged(txn, transferKey)) {
            return res.status(423).json({
              status: "HITL_PENDING",
              transferId: transferKey,
              amount: transferAmount,
              message: `Transfer of $${transferAmount.toLocaleString()} requires your confirmation. Please use the approval panel.`,
            });
          } else if (isHitlAcknowledged(txn, transferKey)) {
            consumeApprovalNonce(txn, transferKey, sub, storedNonce);
            hitlAcknowledged = true;
          }
        }

        // First call — trigger HITL
        if (!hitlAcknowledged) {
          setHitlRequired(txn, sub, transferKey);
          console.log(JSON.stringify({ event: "TRANSFER_HITL_REQUIRED", txn, sub, amount: transferAmount, transferKey }));
          return res.status(200).json({
            status: "CONFIRMATION_REQUIRED",
            transferId: transferKey,
            fromAccount: fromAccount.accountNumber,
            toAccount:   toAccount.accountNumber,
            amount:      transferAmount,
            message: `Transfer of $${transferAmount.toLocaleString()} from account ${fromAccount.accountNumber} to ${toAccount.accountNumber} requires your confirmation. Please review and click Approve or Reject in the notification panel.`,
          });
        }
      }

      // Post-HITL: call Cedar for transferFunds action
      const pdpUrl        = process.env.BANK_PDP_URL || "";
      const policyStoreId = process.env.CEDAR_POLICY_STORE_ID || "";
      const pdpAuth       = process.env.CEDAR_AUTHORIZATION || "";
      const pdpOrigin     = process.env.CEDAR_ORIGIN || "";

      if (!pdpUrl || !policyStoreId) {
        return res.status(403).json({ error: "PDP not configured. Transfer denied." });
      }

      const pdpHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (policyStoreId) pdpHeaders["policyStoreId"] = policyStoreId;
      if (pdpAuth)       pdpHeaders["Authorization"]  = pdpAuth;
      if (pdpOrigin)     pdpHeaders["Origin"]          = pdpOrigin;
      const transfer2TraceHex = ((req as any).trat?.session_trace_id || (req as any).trat?.trace_id || "").replace(/-/g, "");
      if (transfer2TraceHex) pdpHeaders["traceparent"] = `00-${transfer2TraceHex.padEnd(32, "0")}-0000000000000001-01`;

      const agentId = (req as any).trat?.act?.sub || "securebank-finbot-action";
      const tf2Txn = (req as any).trat?.session_trace_id || (req as any).trat?.trace_id || "";
      const tf2Msgs = getMessageHistory(tf2Txn);
      const tf2Query = tf2Msgs.length > 0 ? tf2Msgs[tf2Msgs.length - 1] : "";
      const tf2QueryHist = tf2Msgs.slice(0, -1).join(";");
      const cedarPayload = [{
        subject:  { type: "Agent", id: agentId },
        action:   { name: "TransferFunds" },
        resource: { type: "Transaction", id: transferKey, properties: {} },
        context:  {
          access_state:     "Active",
          adaptiveRisk:     false,
          amount:           transferAmount,
          fromAccountId:    fromAccountId,
          toAccountId:      toAccountId,
          hitlAcknowledged: hitlAcknowledged,
          hitlBypassed:     false,
          session_trace_id: tf2Txn,
          query:            tf2Query,
          query_history:    tf2QueryHist,
          prompt:           tf2Query,
          history:          { prompt: tf2QueryHist },
          response:         "",
        }
      }];

      const pdpRes    = await fetch(pdpUrl, { method: "POST", headers: pdpHeaders, body: JSON.stringify(cedarPayload) });
      const pdpResult = await pdpRes.json();
      const raw       = Array.isArray(pdpResult) ? pdpResult[0]?.decision : pdpResult?.decision;
      const allowed   = raw === true || raw === "allow" || raw === "Allow";

      console.log(JSON.stringify({
        event: "CEDAR_TRANSFER_RESPONSE",
        txn, sub, amount: transferAmount,
        decision: allowed ? "ALLOW" : "DENY",
        hitlAcknowledged,
      }));

      if (!allowed) {
        return res.status(403).json({
          approved: false,
          reason: transferAmount > 10000 ? "AMOUNT_EXCEEDS_TRANSFER_LIMIT" : "POLICY_DENIED",
          message: transferAmount > 10000
            ? `Transfer denied. Amount of $${transferAmount.toLocaleString()} exceeds the maximum transfer limit of $10,000. Please contact your senior manager.`
            : `Transfer denied by policy.`,
        });
      }

      // Execute transfer
      const result = await storage.transfer(resolvedFromId, resolvedToId, transferAmount, resolvedDescription || "Agent transfer", sub);
      if (!result.success) {
        return res.status(400).json({ error: result.error || "Transfer failed" });
      }

      // Mark transfer request as completed so it no longer appears in pending list
      if (requestId) {
        await (storage as any).completeTransferRequest(requestId);
      }

      // Clear HITL state
      if (txn) {
        const session = getIntentSession(txn);
        if (session) {
          session.hitlRequired[transferKey]     = false;
          session.hitlAcknowledged[transferKey] = false;
        }
      }

      return res.json({
        approved:    true,
        transferred: true,
        amount:      transferAmount,
        from:        fromAccount.accountNumber,
        to:          toAccount.accountNumber,
        message:     `Transfer of $${transferAmount.toLocaleString()} completed successfully from account ${fromAccount.accountNumber} to ${toAccount.accountNumber}.`,
      });
    } catch (error: any) {
      console.error("Agent transfer error:", error);
      res.status(500).json({ error: error.message || "Transfer failed" });
    }
  });

  // ── /api/agent/hitl/acknowledge ────────────────────────────────────────────
  // Called by frontend when user clicks APPROVE in HITL notification
  // Works for both transferFunds and future HITL actions
    // ========== INTERNAL AGENT ROUTES (API Key Auth) ==========
  function requireAgentKey(req: any, res: any, next: any) {
    const key = req.headers['x-agent-key'];
    if (!key || key !== process.env.AGENT_API_KEY) {
      return res.status(401).json({ error: "Invalid agent key" });
    }
    next();
  }

  app.get("/api/agent/accounts", requireTrATPassthrough, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      let accounts;
      if (userId) {
        const user = userId ? (await storage.getUserByEmail(userId) || await storage.getUserById(userId)) : undefined;
        if (!user) return res.status(404).json({ error: "User not found" });
        accounts = await storage.getAccountsByUserId(user.id);
      } else {
        accounts = await storage.getAccounts();
      }
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.get("/api/agent/transactions", requireTrATPassthrough, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      const accountId = req.query.accountId as string;
      let transactions: any[] = [];
      if (accountId) {
        transactions = await storage.getTransactionsByAccountId(accountId);
      } else if (userId) {
        const user = await storage.getUserByEmail(userId) || await storage.getUserById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        const accounts = await storage.getAccountsByUserId(user.id);
        for (const acc of accounts) {
          const txns = await storage.getTransactionsByAccountId(acc.id);
          transactions.push(...txns);
        }
        transactions = transactions
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);
      } else {
        transactions = await storage.getTransactions();
      }
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  // ── /api/agent/loans/:loanId — specific loan detail including notes (for injection scenario) ──
  app.get("/api/agent/loans/:loanId", requireTrATPassthrough, async (req, res) => {
    try {
      const loan = await storage.getLoanById(req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Loan not found" });
      const applicant = await storage.getUserById(loan.userId);
      res.json({
        loanId: loan.id,
        loanType: loan.type,
        requestedAmount: loan.amount,
        status: loan.status,
        notes: loan.notes,
        applicant: applicant ? { name: (applicant as any).name, email: (applicant as any).email } : null,
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch loan" });
    }
  });

  app.get("/api/agent/loans", requireTrATPassthrough, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: "userId required" });

      const requestingUser = await storage.getUserByEmail(userId) || await storage.getUserById(userId);
      if (!requestingUser) return res.status(404).json({ error: "User not found" });

      let loans;
      if (requestingUser.role === 'Bank Manager') {
        // Manager sees ALL loans — credit score intentionally excluded.
        // Agent must call getCreditScores action group explicitly for a specific applicant.
        // This ensures spawn/credit-score issues TrAT-3, invokes HMUPMOXUEO, and
        // records the applicant in gPrior — enabling applicant switch detection.
        loans = await storage.getLoans();
        const loansWithDetails = await Promise.all(loans.map(async (loan) => {
          const applicant = await storage.getUserById(loan.userId);
          return {
            loanId: loan.id,
            loanType: loan.type,
            requestedAmount: loan.amount,
            remainingBalance: loan.remainingBalance,
            interestRate: loan.interestRate,
            termMonths: loan.termMonths,
            monthlyPayment: loan.monthlyPayment,
            status: loan.status,
            submittedDate: String(loan.createdAt).slice(0, 10),
            notes: loan.notes,
            applicant: applicant ? {
              name: applicant.name,
              email: applicant.email,
              annualIncome: applicant.annualIncome,
              employerName: applicant.employerName,
              kycCompleted: applicant.kycCompleted,
              identityVerified: applicant.identityVerified,
            } : null,
          };
        }));
        res.json({ role: 'Bank Manager', totalLoans: loans.length, loans: loansWithDetails });
      } else if (requestingUser.role === 'Bank Teller') {
        // Teller sees all loans but no applicant credit details
        loans = await storage.getLoans();
        const loansWithBasic = await Promise.all(loans.map(async (loan) => {
          const applicant = await storage.getUserById(loan.userId);
          return {
            loanId: loan.id,
            loanType: loan.type,
            requestedAmount: loan.amount,
            status: loan.status,
            applicantName: applicant?.name,
            submittedDate: String(loan.createdAt).slice(0, 10),
          };
        }));
        res.json({ role: 'Bank Teller', totalLoans: loans.length, loans: loansWithBasic });
      } else {
        // Account Holder sees only their own loans
        loans = await storage.getLoansByUserId(requestingUser.id);
        res.json({
          role: 'Account Holder',
          loans: loans.map(l => ({
            loanType: l.type,
            requestedAmount: l.amount,
            remainingBalance: l.remainingBalance,
            interestRate: l.interestRate,
            monthlyPayment: l.monthlyPayment,
            status: l.status,
            notes: l.notes,
            submittedDate: String(l.createdAt).slice(0, 10),
          })),
        });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loans" });
    }
  });

  app.get("/api/agent/dashboard", requireTrATPassthrough, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const user = await storage.getUserByEmail(userId) || await storage.getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const accounts = await storage.getAccountsByUserId(user.id);
      const loans = await storage.getLoansByUserId(user.id);
      const totalBalance = accounts.reduce((sum: number, acc: any) => sum + parseFloat(acc.balance), 0);
      const totalLoans = loans.reduce((sum: number, loan: any) => sum + parseFloat(loan.remainingBalance), 0);
      res.json({ totalBalance, totalLoans, accountsCount: accounts.length, loansCount: loans.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard" });
    }
  });

  // ========== ADMIN INFRA ROUTE (Administrator only) ==========
  // Returns infra context for the agent to query S3/IAM via the figi action group
  app.get("/api/agent/infra", requireTrATPassthrough, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const requestingUser = await storage.getUserByEmail(userId) || await storage.getUserById(userId);
      if (!requestingUser) return res.status(404).json({ error: "User not found" });
      if (requestingUser.role !== 'Administrator') {
        return res.status(403).json({ error: "Only Administrators can access infrastructure data" });
      }
      // Return context so agent knows to call the figi action group
      res.json({
        role: 'Administrator',
        userName: requestingUser.name,
        permissions: ['ListS3Buckets', 'ListIAMUsers'],
        message: 'Administrator access granted. Use figi action group to fetch AWS infrastructure details.',
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to verify admin access" });
    }
  });


  // ========== CREDIT SCORE ENDPOINT (Agent use only) ==========
  // ── /api/agent/credit-score ──────────────────────────────────────────────
  // Returns all users with their credit scores.
  // No role-based branching — Cedar PDP is the sole enforcement point.

  app.get("/api/agent/credit-score", requireTrATPassthrough, async (req, res) => {
    try {
      // Scope enforcement: filter driven by TrAT-3 intent claims, not hardcoded business logic
      // branch_id and scope are issued by Cedar-governed TrAT — API executes within that scope
      const filterEmail  = req.query.userEmail as string || "";
      const trat3        = (req as any).trat;
      const trat3Intent  = trat3?.intent || {};
      const branchId     = trat3Intent.branch_id || trat3?.branch_id || "";
      const scope        = trat3Intent.scope || "branch_pending";
      const users = await storage.getUsers();
      const loans = await storage.getLoans();

      let filteredUsers = users as any[];

      // Always apply branch filter — driven by TrAT-3 claim, not hardcoded
      // Branch filtering removed — governance disabled

      if (filterEmail) {
        // Specific user — filter by email within already-scoped list
        const beforeFilter = filteredUsers.length;
        filteredUsers = filteredUsers.filter((u: any) => u.email === filterEmail);
        // Cross-branch check removed — governance disabled
      } else {
        // Broad query — only pending loan applicants within scope
        const pendingUserIds = new Set(
          loans.filter((l: any) => l.status === "pending").map((l: any) => l.userId)
        );
        filteredUsers = filteredUsers.filter((u: any) => pendingUserIds.has(u.id));
      }

      const data = filteredUsers.map((u: any) => ({
        userId:      u.email,
        name:        u.name,
        role:        u.role,
        branchId:    u.branchId,
        creditScore: u.creditScore ?? null,
        loanCount:   loans.filter((l: any) => l.userId === u.id).length,
      }));

      // IBAC: Only record a specific applicant if one was explicitly requested
      // Bulk getCreditScores (all branch) does NOT mark individuals as researched
      const trat = (req as any).trat;
      const txn  = trat?.trace_id;
      const sub  = trat?.sub;
      const userInitiated = trat?.intent?.userInitiated !== false;
      // Use filterEmail (query param) as the specific applicant — this is set when user asks for a specific person
      const specificApplicant = filterEmail || trat?.intent?.allowed_userId || trat?.intent?.applicant || "";
      if (txn && sub && specificApplicant) {
        // Only record the specific applicant that was explicitly requested
        const match = (filteredUsers as any[]).find((u: any) => u.email === specificApplicant);
        if (match && match.creditScore !== null) {
          recordCreditScoreCheck(txn, sub, match.email, userInitiated);
        }
      }
      // Bulk fetch — do not record individuals as researched

      res.json({ users: data });
    } catch (error) {
      console.error("Credit score fetch error:", error);
      res.status(500).json({ error: "Failed to fetch credit score data" });
    }
  });






  // ── /api/agent/spawn/credit-score ─────────────────────────────────────────
  // Issues narrowed TrAT-3 scoped to specific user+loan then invokes
  // credit-score-agent (HMUPMOXUEO) via Bedrock SDK directly.
  app.post("/api/agent/spawn/credit-score", requireTrATPassthrough, async (req, res) => {
    try {
      const { userId, loanId, inputText } = req.body;
      // No scope here — Cedar governs access at TrAT issuance time

      // Resolve userId to email — Bedrock may pass a name not an email
      let resolvedUserId = userId || "";

      // If userId has no @ it's a name — resolve to email
      if (resolvedUserId && !resolvedUserId.includes("@")) {
        const allUsers = await storage.getUsers();
        const nameLower = resolvedUserId.toLowerCase();
        const match = (allUsers as any[]).find((u: any) =>
          (u.name?.toLowerCase() || "").includes(nameLower) ||
          nameLower.includes(u.name?.toLowerCase() || "NOMATCH")
        );
        if (match) resolvedUserId = match.email;
      }

      // If still no email, resolve from inputText
      if (!resolvedUserId && inputText) {
        const allUsers = await storage.getUsers();
        const match = (allUsers as any[]).find((u: any) =>
          inputText.toLowerCase().includes(u.name?.toLowerCase()) ||
          inputText.toLowerCase().includes(u.email?.toLowerCase())
        );
        if (match) resolvedUserId = match.email;
      }
      // No TrAT-3, no Bedrock, no governance — just fetch credit data directly
      const appUrl = process.env.BANK_APP_URL || `http://localhost:${process.env.PORT || 5000}`;
      const branchId = (req as any).trat?.branch_id || "";

      let responseText = "";
      try {
        const creditRes = await fetch(
          `${appUrl}/api/agent/credit-score?userEmail=${encodeURIComponent(resolvedUserId)}&branchId=${encodeURIComponent(branchId)}`,
          { headers: { "Content-Type": "application/json" } }
        );
        const creditData = await creditRes.json();

        let riskData = null;
        try {
          const riskRes = await fetch(
            `${appUrl}/api/agent/credit-risk?userEmail=${encodeURIComponent(resolvedUserId)}`,
            { headers: { "Content-Type": "application/json" } }
          );
          if (riskRes.ok) riskData = await riskRes.json();
        } catch {}

        if (creditData && !creditData.error) {
          responseText = JSON.stringify({
            creditScore: creditData,
            creditRisk: riskData,
            applicant: resolvedUserId,
          });
        } else {
          responseText = JSON.stringify(creditData);
        }
      } catch (fetchErr: any) {
        responseText = JSON.stringify({ error: "Failed to fetch credit data", detail: fetchErr.message });
      }

      res.json({ response: responseText, trat3_issued: false });
    } catch (error: any) {
      console.error("Credit score spawn error:", error);
      res.status(500).json({ error: error.message || "Credit score spawn failed" });
    }
  });

  // ── /api/agent/mcp/compliance ─────────────────────────────────────────────
  // Issues TrAT-3 (securebank-finbot-action → mcp::compliance-check)
  // then calls TES compliance endpoint.
  app.get("/api/agent/mcp/compliance", requireTrATPassthrough, async (req, res) => {
    try {
      const userId    = req.query.userId as string || "";
      const trat2Token = (req.headers["authorization"] as string)?.replace("Bearer ", "") || "";
      const trat2Payload = (req as any).trat;
      const mcpUrl    = MCP_SERVER_URL;

      const delegateRes = await fetch(`${SELF_URL}/auth/trat/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${trat2Token}` },
        body: JSON.stringify({
          delegate_to:   "mcp::compliance-check",
          delegate_type: "mcp_tool",
          intent: { action: "getComplianceCheck", userId, parent_intent: "approveLoan" }
        }),
      });

      const delegateData = await delegateRes.json() as any;
      if (!delegateData.trat) return res.status(401).json({ error: "TrAT-3 delegation failed" });

      const mcpRes = await fetch(`${mcpUrl}/mcp/compliance-check?userId=${encodeURIComponent(userId)}`, {
        headers: { "Authorization": `Bearer ${delegateData.trat}`, "Content-Type": "application/json" },
      });

      if (!mcpRes.ok) return res.status(mcpRes.status).json({ error: "Compliance check failed", detail: await mcpRes.text() });
      return res.json(await mcpRes.json());
    } catch (error: any) {
      console.error("Compliance proxy error:", error);
      res.status(500).json({ error: error.message || "Compliance check failed" });
    }
  });

  // ── /api/agent/mcp/property ───────────────────────────────────────────────
  // Issues TrAT-3 (securebank-finbot-action → mcp::property-valuation)
  // then calls TES property valuation endpoint.
  app.get("/api/agent/mcp/property", requireTrATPassthrough, async (req, res) => {
    try {
      const address    = req.query.address as string || "";
      const loanAmount = req.query.loanAmount as string || "";
      const trat2Token = (req.headers["authorization"] as string)?.replace("Bearer ", "") || "";
      const trat2Payload = (req as any).trat;
      const mcpUrl     = MCP_SERVER_URL;

      const delegateRes = await fetch(`${SELF_URL}/auth/trat/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${trat2Token}` },
        body: JSON.stringify({
          delegate_to:   "mcp::property-valuation",
          delegate_type: "mcp_tool",
          intent: { action: "propertyValuation", address, loanAmount, parent_intent: "approveLoan" }
        }),
      });

      const delegateData = await delegateRes.json() as any;
      if (!delegateData.trat) return res.status(401).json({ error: "TrAT-3 delegation failed" });

      const mcpRes = await fetch(
        `${mcpUrl}/mcp/property-valuation?address=${encodeURIComponent(address)}&loanAmount=${encodeURIComponent(loanAmount)}`,
        { headers: { "Authorization": `Bearer ${delegateData.trat}`, "Content-Type": "application/json" } }
      );

      if (!mcpRes.ok) return res.status(mcpRes.status).json({ error: "Property valuation failed", detail: await mcpRes.text() });
      return res.json(await mcpRes.json());
    } catch (error: any) {
      console.error("Property valuation proxy error:", error);
      res.status(500).json({ error: error.message || "Property valuation failed" });
    }
  });

  // ── /api/agent/mcp/credit-risk ────────────────────────────────────────────
  // Issues TrAT-3 to mcp::credit-risk, calls TES /mcp/credit-risk.
  // Pattern mirrors /api/agent/mcp/figi exactly.
  app.get("/api/agent/mcp/credit-risk", requireTrATPassthrough, async (req, res) => {
    try {
      let userEmail = req.query.userId as string || req.query.userEmail as string || "";
      const trat2Token = (req.headers["authorization"] as string)?.replace("Bearer ", "") || "";
      const trat2Payload = (req as any).trat;
      const txn = trat2Payload?.trace_id;
      const sub = trat2Payload?.sub;

      if (!userEmail) {
        return res.status(400).json({ error: "userId or userEmail required" });
      }

      // Resolve name to email if no @ present
      if (!userEmail.includes("@")) {
        const allUsers = await storage.getUsers();
        const nameLower = userEmail.toLowerCase();
        const match = (allUsers as any[]).find((u: any) =>
          (u.name?.toLowerCase() || "").includes(nameLower) ||
          nameLower.includes(u.name?.toLowerCase() || "NOMATCH")
        );
        if (match) userEmail = match.email;
      }

      // Record credit risk check — updates lastResearchedApplicant
      if (txn && sub) {
        recordCreditRiskCheck(txn, sub, userEmail, true);
      }

      // Fetch applicant data from storage
      const applicant = await storage.getUserByEmail(userEmail);
      if (!applicant) {
        return res.status(404).json({ error: "User not found" });
      }
      const allLoans = await storage.getLoansByUserId((applicant as any).id);
      const loanHistory = getLoanHistory(userEmail);

      // Issue TrAT-3: securebank-finbot-action → mcp::credit-risk
      const bankUrl = SELF_URL;
      const delegateRes = await fetch(`${bankUrl}/auth/trat/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${trat2Token}` },
        body: JSON.stringify({
          delegate_to:   "mcp::credit-risk",
          delegate_type: "mcp_tool",
          intent: {
            action:         "getCreditRiskAnalysis",
            allowed_userId: userEmail,
            userInitiated:  true,
          }
        }),
      });

      const delegateData = await delegateRes.json() as any;
      if (!delegateData.trat) {
        return res.status(401).json({ error: "TrAT-3 for mcp::credit-risk failed", detail: delegateData });
      }

      const trat3 = delegateData.trat;
      const tesUrl = process.env.MCP_NGROK_URL || process.env.TES_URL || process.env.NGROK_URL || "";
      if (!tesUrl) return res.status(500).json({ error: "TES URL not configured" });

      const tesRes = await fetch(`${tesUrl}/mcp/credit-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${trat3}` },
        body: JSON.stringify({
          applicant: {
            email:        (applicant as any).email,
            name:         (applicant as any).name,
            creditScore:  (applicant as any).creditScore || 0,
            annualIncome: parseFloat((applicant as any).annualIncome || "0"),
          },
          currentLoans: allLoans.map((l: any) => ({
            loanId: l.id, type: l.type, amount: parseFloat(l.amount), status: l.status,
          })),
          loanHistory,
        }),
      });

      const riskData = await tesRes.json();
      console.log(JSON.stringify({ event: "CREDIT_RISK_MCP_COMPLETE", txn, userEmail }));
      return res.json(riskData);

    } catch (error: any) {
      console.error("mcp/credit-risk error:", error);
      return res.status(500).json({ error: "Credit risk analysis failed", detail: error.message });
    }
  });

  // ── /api/agent/mcp/figi ───────────────────────────────────────────────────
  // MCP proxy — issues TrAT-3 then calls TES MCP endpoint.
  // Supports: ?ticker=AAPL (FIGI search) and ?manufacturer=Toyota (market analysis)
  // ── /api/agent/credit-risk ────────────────────────────────────────────────
  // Called by HMUPMOXUEO with TrAT-3. Fetches user loan history from storage
  // then calls TES /mcp/credit-risk for risk scoring + World Bank macro context.
  app.get("/api/agent/credit-risk", requireTrATPassthrough, async (req, res) => {
    try {
      const filterEmail = req.query.userEmail as string || "";
      const trat3 = (req as any).trat;
      const txn   = trat3?.trace_id;
      const sub   = trat3?.sub;

      console.log(JSON.stringify({ event: "CREDIT_RISK_ENDPOINT_HIT", filterEmail, txn }));

      if (!filterEmail) {
        return res.status(400).json({ error: "userEmail required" });
      }

      // Fetch applicant from storage
      const applicant = await storage.getUserByEmail(filterEmail);
      if (!applicant) {
        return res.status(404).json({ error: "User not found" });
      }

      // Fetch current loans
      const allLoans = await storage.getLoansByUserId((applicant as any).id);

      // Fetch loan history
      const loanHistory = getLoanHistory(filterEmail);

      // Call TES /mcp/credit-risk with TrAT-3
      const tesUrl = process.env.MCP_NGROK_URL || process.env.TES_URL || process.env.NGROK_URL || "";
      if (!tesUrl) {
        return res.status(500).json({ error: "TES URL not configured" });
      }

      const trat3Token = (req.headers["authorization"] as string)?.replace("Bearer ", "") || "";

      const tesRes = await fetch(`${tesUrl}/mcp/credit-risk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${trat3Token}`,
        },
        body: JSON.stringify({
          applicant: {
            email:        (applicant as any).email,
            name:         (applicant as any).name,
            creditScore:  (applicant as any).creditScore || 0,
            annualIncome: parseFloat((applicant as any).annualIncome || "0"),
          },
          currentLoans: allLoans.map((l: any) => ({
            loanId: l.id, type: l.type, amount: parseFloat(l.amount), status: l.status,
          })),
          loanHistory,
        }),
      });

      const riskData = await tesRes.json();
      console.log(JSON.stringify({ event: "CREDIT_RISK_ANALYSIS_COMPLETE", txn, filterEmail, riskScore: riskData.riskScore }));

      return res.json(riskData);

    } catch (error: any) {
      console.error("credit-risk error:", error);
      return res.status(500).json({ error: "Credit risk analysis failed", detail: error.message });
    }
  });

  app.get("/api/agent/mcp/figi", requireTrATPassthrough, async (req, res) => {
    try {
      const ticker       = req.query.ticker as string || "";
      const manufacturer = req.query.manufacturer as string || "";
      const trat2Token   = (req.headers["authorization"] as string)?.replace("Bearer ", "") || "";
      const mcpUrl       = MCP_SERVER_URL;

      if (manufacturer) {
        // ── Market Analysis flow (TrAT-3: securebank-finbot → mcp::market-analysis)
        const delegateRes  = await fetch(`${SELF_URL}/auth/trat/delegate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${trat2Token}` },
          body:   JSON.stringify({ delegate_to: "mcp::market-analysis", delegate_type: "mcp_tool", intent: { action: "getMarketAnalysis", manufacturer } }),
        });
        const delegateData = await delegateRes.json() as any;
        if (!delegateData.trat) {
          // Check if denied due to intent drift — return soft 200 so agent continues to approveLoan
          const denyReason = delegateData?.reason || delegateData?.error || "";
          const isDriftDenial = denyReason.toLowerCase().includes("drift") ||
            (delegateData?.policy && delegateData.policy.toLowerCase().includes("drift"));
          if (isDriftDenial || delegateData?.policy) {
            console.log(JSON.stringify({ event: "MARKET_ANALYSIS_BLOCKED_INTENT_DRIFT", manufacturer, reason: denyReason }));
            return res.status(200).json({
              vehicleRisk: "unknown",
              riskSignal:  "blocked",
              analysis:    "Market analysis was blocked by policy — intent drift detected. Proceeding without market analysis.",
              recommendation: "Proceed to loan approval without market analysis.",
            });
          }
          return res.status(401).json({ error: "TrAT-3 delegation failed", detail: delegateData });
        }

        const mcpRes = await fetch(`${mcpUrl}/mcp/figi/market-analysis?manufacturer=${encodeURIComponent(manufacturer)}`, {
          headers: { "Authorization": `Bearer ${delegateData.trat}`, "Content-Type": "application/json" },
        });
        if (!mcpRes.ok) return res.status(mcpRes.status).json({ error: "Market analysis failed", detail: await mcpRes.text() });
        const mcpData = await mcpRes.json();
        // Record market analysis in intent registry
        // userInitiated comes from TrAT intent — Lambda sets false when auto-gathering after drift
        const tratPayload = (req as any).trat;
        const txnId = tratPayload?.trace_id ?? tratPayload?.txn;
        const subId = tratPayload?.sub;
        const mktUserInitiated = tratPayload?.intent?.userInitiated !== false;
        // Only record market analysis for the specific applicant being researched
        // Bulk market analysis (by manufacturer) does NOT mark all vehicle holders as researched
        const specificApplicantEmail = tratPayload?.intent?.allowed_userId || tratPayload?.intent?.applicant || "";
        if (txnId && subId && mcpData?.vehicleRisk) {
          if (specificApplicantEmail) {
            // Only record when intent explicitly names the applicant.
            // Market analysis is per-manufacturer, not per-applicant — inferring from
            // loan notes is unreliable (multiple applicants may share same manufacturer).
            // Switch detection relies on credit score checks, which are always per-applicant.
            recordMarketAnalysis(txnId, subId, specificApplicantEmail, manufacturer, mktUserInitiated);
          }
          // No applicant in intent — do not infer. Bulk manufacturer analysis
          // does not count as researching any specific applicant.
        }
        return res.json(mcpData);

      } else {
        // ── FIGI search flow (TrAT-3: securebank-finbot → mcp::figi)
        const delegateRes  = await fetch(`${SELF_URL}/auth/trat/delegate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${trat2Token}` },
          body:   JSON.stringify({ delegate_to: "mcp::figi", delegate_type: "mcp_tool", intent: { action: "getFigiData" } }),
        });
        const delegateData = await delegateRes.json() as any;
        if (!delegateData.trat) return res.status(401).json({ error: "TrAT-3 delegation failed", detail: delegateData });

        const mcpRes = await fetch(`${mcpUrl}/mcp/figi/search?ticker=${encodeURIComponent(ticker)}`, {
          headers: { "Authorization": `Bearer ${delegateData.trat}`, "Content-Type": "application/json" },
        });
        if (!mcpRes.ok) return res.status(mcpRes.status).json({ error: "MCP call failed", detail: await mcpRes.text() });
        const mcpData = await mcpRes.json();
        return res.json({ figi: mcpData, trat3_issued: true, delegation_chain: delegateData.delegation_chain });
      }

    } catch (error: any) {
      console.error("MCP proxy error:", error);
      res.status(500).json({ error: error.message || "MCP proxy failed" });
    }
  });


  // ── /api/agent/loans/approve ──────────────────────────────────────────────
  // Cedar PDP enforces clearanceLevel > 7 AND vehicleRisk != "high".
  // SecureBank enforces credit score >= 700 after Cedar allow.
  // Called by Lambda with TrAT-2.

  app.post("/api/agent/loans/approve", requireTrATPassthrough, async (req, res) => {
    try {
      const { loanId, userId, clearanceLevel, role } = req.body;

      // ── Name-to-loanId resolution ──
      let resolvedLoanId = loanId;
      if (!resolvedLoanId) {
        const applicantName = (req.body.applicantName || "").toLowerCase();
        const applicantEmail = (req.body.applicantEmail || "").toLowerCase();
        if (applicantName || applicantEmail) {
          const allLoans = await storage.getLoans();
          for (const l of allLoans) {
            if (l.status !== "pending") continue;
            const loanUser = await storage.getUserById(l.userId);
            if (!loanUser) continue;
            const nameMatch = applicantName && (loanUser as any).name?.toLowerCase().includes(applicantName);
            const emailMatch = applicantEmail && (loanUser as any).email?.toLowerCase() === applicantEmail;
            if (nameMatch || emailMatch) {
              resolvedLoanId = l.id;
              break;
            }
          }
        }
        if (!resolvedLoanId) {
          return res.status(400).json({ error: "loanId required — could not resolve from applicant name" });
        }
      }

      const loan = await storage.getLoanById(resolvedLoanId);
      if (!loan) return res.status(404).json({ error: "Loan not found" });

      if (loan.status !== "pending") {
        return res.status(400).json({ error: `Loan is already ${loan.status}` });
      }

      // No Cedar checks, no drift detection, no guardrails — just approve
      await storage.updateLoan(resolvedLoanId, { status: "approved", approvedBy: userId || "agent" });

      return res.json({
        approved: true,
        loanId: resolvedLoanId,
        message: `Loan ${resolvedLoanId} has been approved successfully.`,
      });
    } catch (err: any) {
      console.error("Loan approval error:", err);
      return res.status(500).json({ error: err.message });
    }
  });
  /*app.post("/api/agent/loans/approve", requireTrATPassthrough, async (req, res) => {
    try {
      const { loanId, userId, clearanceLevel, role, vehicleRisk, approvalNonce } = req.body;
      // ── Name-to-loanId resolution ───────────────────────────────────────────
      // If loanId is not provided, resolve from applicantName in body.
      // Lambda passes applicantName when user says "approve kevin's loan".
      // If multiple pending loans exist for the same applicant, pick the first pending one.
      let resolvedLoanId = loanId;
      if (!resolvedLoanId) {
        const applicantName = (req.body.applicantName || "").toLowerCase();
        const applicantEmail = (req.body.applicantEmail || "").toLowerCase();
        if (applicantName || applicantEmail) {
          const allLoans = await storage.getLoans();
          for (const l of allLoans) {
            if (l.status !== "pending") continue;
            const loanUser = await storage.getUserById(l.userId);
            if (!loanUser) continue;
            const nameMatch  = applicantName  && (loanUser as any).name?.toLowerCase().includes(applicantName);
            const emailMatch = applicantEmail && (loanUser as any).email?.toLowerCase() === applicantEmail;
            if (nameMatch || emailMatch) {
              resolvedLoanId = l.id;
              break;
            }
          }
        }
        if (!resolvedLoanId) {
          return res.status(400).json({ error: "loanId required — could not resolve from applicant name" });
        }
      }

      // Fetch loan and applicant
      const loan = await storage.getLoanById(resolvedLoanId);
      if (!loan) return res.status(404).json({ error: "Loan not found" });

      const applicant = await storage.getUserById(loan.userId);
      if (!applicant) return res.status(404).json({ error: "Applicant not found" });

      // ── IBAC: Intent Registry Validation ─────────────────────────────────
      // Extract txn from TrAT — validates prerequisites were met for THIS applicant
      const trat = (req as any).trat;
      const txn  = trat?.trace_id;
      const sub  = trat?.sub;


      // ── Direct Cedar evaluation — no HITL for approveLoan ───────────────
      // HITL is handled by transferFunds action instead.
      // approveLoan goes straight to Cedar for policy evaluation.

      // ── Guardrail score computation — passed to Reva Cedar approveLoan evaluation ──
      // Reva guardrail config uses scope_deviation_score + privilege_escalation_score
      const guardrailTxn     = trat?.trace_id ?? trat?.txn;
      const guardrailSession = guardrailTxn ? getIntentSession(guardrailTxn) : undefined;
      const guardrailSlots   = guardrailSession ? Object.values(guardrailSession.applicants || {}) as any[] : [];
      const creditDone       = guardrailSlots.some((s: any) => s.creditScoreRecordedAt > 0);
      const marketDone       = guardrailSlots.some((s: any) => s.marketAnalysedRecordedAt > 0);
      const priorApplicants  = guardrailSession ? Object.keys(guardrailSession.applicants || {}) : [];
      const sessionActions   = guardrailSession?.priorIntents?.length || 0;

      // Scores on 0.0–1.0 scale — matching Reva guardrail config thresholds
      // scope_deviation:      deny >= 0.65
      // privilege_escalation: deny >= 0.75, conditional >= 0.55
      let scope_deviation_score = 0.0;
      if (!creditDone)  scope_deviation_score += 0.40;
      if (!marketDone)  scope_deviation_score += 0.40;
      if ((applicant as any).email && !priorApplicants.includes((applicant as any).email)) scope_deviation_score += 0.20;
      scope_deviation_score = Math.min(scope_deviation_score, 1.0);

      let privilege_escalation_score = 0.0;
      if (sessionActions === 0) privilege_escalation_score += 0.50;
      if (!guardrailSession?.priorIntents?.includes("getLoans") &&
          !guardrailSession?.priorIntents?.includes("getPendingLoans")) privilege_escalation_score += 0.30;
      if (priorApplicants.length > 0 && (applicant as any).email &&
          !priorApplicants.includes((applicant as any).email)) privilege_escalation_score += 0.20;
      privilege_escalation_score = Math.min(privilege_escalation_score, 1.0);

      console.log(JSON.stringify({
        event: "GUARDRAIL_SCORES_COMPUTED",
        loanId, sub,
        scope_deviation_score,
        privilege_escalation_score,
        creditDone, marketDone, sessionActions,
      }));

      // Call Cedar PDP — evaluates clearanceLevel > 7 AND vehicleRisk != "high"
      const pdpUrl        = process.env.BANK_PDP_URL || "";
      const policyStoreId = process.env.CEDAR_POLICY_STORE_ID || "";
      const pdpAuth       = process.env.CEDAR_AUTHORIZATION || "";
      const pdpOrigin     = process.env.CEDAR_ORIGIN || "";

      // Fail CLOSED — if PDP not configured, deny by default
      if (!pdpUrl || !policyStoreId) {
        return res.status(403).json({
          approved: false,
          reason: "PDP_UNAVAILABLE",
          message: "Authorization service not configured. Loan approval denied.",
        });
      }

      const pdpHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (policyStoreId) pdpHeaders["policyStoreId"] = policyStoreId;
      if (pdpAuth)       pdpHeaders["Authorization"]  = pdpAuth;
      if (pdpOrigin)     pdpHeaders["Origin"]          = pdpOrigin;
      const approveLoanTraceHex = (trat?.session_trace_id || trat?.trace_id || "").replace(/-/g, "");
      if (approveLoanTraceHex) pdpHeaders["traceparent"] = `00-${approveLoanTraceHex.padEnd(32, "0")}-0000000000000001-01`;
      const applicantUser = await storage.getUserById(loan.userId);
      const applicantBranchId = (applicantUser as any)?.branchId || "";
      const applicantCompliance = (applicantUser as any)?.complianceStatus || "CLEAN";

      // ── Guardrail: query, query_history, response ─────────────────────────────
      const allMessages    = getMessageHistory(txn || "");
      const query          = allMessages.length > 0 ? allMessages[allMessages.length - 1] : "";
      const query_history  = allMessages.slice(0, -1).join(";");
      const INJECTION_DEMO_EMAIL = "alex.turner@reva.ai";
      const response       = (applicantUser as any)?.email === INJECTION_DEMO_EMAIL ? (loan.notes || "") : "";

      const cedarPayload = [{
        subject:  { type: "User", id: userId },
        action:   { name: "approveLoan" },
        resource: { type: "AssistantTool", id: loanId, properties: {} },
        context:  {
          access_state:      "Active",
          adaptiveRisk:      false,
          amount:            parseInt(loan.amount || "0"),
          clearanceLevel:    clearanceLevel,
          role:              role,
          status:            "active",
          loanId:            loanId,
          vehicleRisk:       vehicleRisk || "unknown",
          applicantBranchId: applicantBranchId,
          complianceStatus:  applicantCompliance,
          loanType:                  loan.type || "auto",
          branch_id:                 trat?.branch_id || "",
          creditScore:               applicant.creditScore || 0,
          scope_deviation_score:     scope_deviation_score,
          privilege_escalation_score: privilege_escalation_score,
          query:             query,
          query_history:     query_history,
          prompt:            query,
          history:           { prompt: query_history },
          response:          response,
          session_trace_id:  trat?.session_trace_id || trat?.trace_id || "",
        }
      }];

      let pdpDecision = false;
      let pdpReason   = "";

      try {
        console.log("CEDAR_APPROVELOAN_PAYLOAD", JSON.stringify(cedarPayload));
        const pdpRes = await fetch(pdpUrl!, {
          method: "POST", headers: pdpHeaders, body: JSON.stringify(cedarPayload)
        });
        const pdpResult  = await pdpRes.json();
        const firstResult = Array.isArray(pdpResult) ? pdpResult[0] : pdpResult;
        const raw = firstResult?.decision;
        pdpDecision = raw === true || raw === "allow" || raw === "Allow";
        pdpReason   = firstResult?.reason ?? "";
        const cedarEv: any = {
          event: "CEDAR_APPROVELOAN_RESPONSE",
          loanId, sub, txn,
          trace_id: txn,
          decision: pdpDecision ? "ALLOW" : "DENY",

          policy: (Array.isArray(pdpResult) ? pdpResult[0] : pdpResult)?.determiningPolicies?.[0]?.policyId || "",
          determiningPolicies: (Array.isArray(pdpResult) ? pdpResult[0] : pdpResult)?.determiningPolicies || [],
          delegation_chain: trat?.delegation,
          delegation_depth: trat?.delegation_depth,
          ts: new Date().toISOString(),
        };
        console.log(JSON.stringify(cedarEv));
        trackEvent(cedarEv);
      } catch (err) {
        console.error("PDP call failed for approveLoan:", err);
        return res.status(500).json({ error: "Authorization service unavailable. Please try again." });
      }

      // Cedar denied — final denial
      if (!pdpDecision) {
        const resolvedRisk = (vehicleRisk || "unknown").toLowerCase();
        const loanAmountNum = parseInt(loan.amount || "0");
        if (resolvedRisk === "high") {
          return res.status(403).json({
            approved: false,
            reason: "VEHICLE_RISK_HIGH",
            message: `Loan approval denied. Market analysis indicates high depreciation risk for the vehicle. This poses excessive collateral risk.`,
          });
        }
        if (applicantBranchId && trat?.branch_id && applicantBranchId !== trat.branch_id) {
          return res.status(403).json({
            approved: false,
            reason: "CROSS_BRANCH_DENIED",
            message: `Loan approval denied. You are not authorized to approve loans for applicants from a different branch.`,
          });
        }
        if ((applicantUser as any)?.complianceStatus === "OFAC_WATCHLIST") {
          return res.status(403).json({
            approved: false,
            reason: "OFAC_WATCHLIST",
            message: `Loan approval denied. Applicant is on the OFAC sanctions watchlist. This loan cannot be processed.`,
          });
        }
        if (loanAmountNum > 25000 && clearanceLevel < 10) {
          return res.status(403).json({
            approved: false,
            reason: "AMOUNT_EXCEEDS_AUTHORITY",
            message: `Loan approval denied. The loan amount of $${loanAmountNum.toLocaleString()} exceeds your approval authority of $25,000. Please escalate to a senior manager.`,
          });
        }
        return res.status(403).json({
          approved: false,
          reason: "POLICY_DENIED",
          message: `Loan approval denied by policy.`,
        });
      }

      // Credit score check moved to Cedar policy — no application-level filter
      const creditScore = applicant.creditScore ?? 0;

      // All checks passed — approve loan
      await storage.updateLoan(loanId, { status: "approved", approvedBy: userId });
      await createBusinessAuditLog(
        userId, role, "approveLoan", "Loan", loanId, "Allow",
        `Agent approved loan ${loanId} via TrAT delegation. CL=${clearanceLevel}, creditScore=${creditScore}, vehicleRisk=${vehicleRisk}`, "low"
      );

      res.json({
        approved:   true,
        loanId,
        status:     "approved",
        approvedBy: userId,
        applicant:  applicant.name,
        creditScore,
        message: `Loan approved successfully. ${applicant.name}'s application has been processed. Credit score: ${creditScore}. Loan status updated to approved.`,
      });
    } catch (error: any) {
      console.error("Loan approval error:", error);
      res.status(500).json({ error: error.message || "Loan approval failed" });
    }
  });*/

  // ========== INTERNAL USER ATTRIBUTE ENDPOINT (TES use only) ==========
  // Called by Reva TES during Okta inline hook to fetch user attributes
  // for Cedar PDP inline entity hydration before token enrichment decision
  app.get("/internal/users/:sub", requireAgentKey, async (req, res) => {
    try {
      const { sub } = req.params;

      // sub from Okta is email-based — try email first, fallback to UUID
      const user =
     await storage.getUserByEmail(canonicalizeEmail(sub))
  || await storage.getUserByEmail(sub)
  || await storage.getUserById(sub);
      if (!user) {
        return res.status(404).json({ error: "User not found", sub });
      }

      // Return only the attributes TES needs for Cedar inline entity hydration.
      // department null → "" prevents Okta patch rejection (John Smith scenario).
      res.json({
        sub:             user.email,
        name:            (user as any).name || "",
        role:            user.role,
        clearance_level: user.clearanceLevel,
        branch_id:       user.branchId,
        department:      user.department ?? "",
        status:          user.status,
        credit_score:    (user as any).creditScore ?? null,
      });
    } catch (error) {
      console.error("Internal user attribute lookup error:", error);
      res.status(500).json({ error: "Failed to fetch user attributes" });
    }
  });

  // ── /internal/users/search — name search for TES (no session required) ────────
  app.get("/internal/users/search", requireAgentKey, async (req, res) => {
    try {
      const q = canonicalizeEmail((req.query.q as string) || "").toLowerCase().trim();
      if (!q) return res.status(400).json({ error: "q required" });
      const users = await storage.getUsers();
      const match = users.find((u: any) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.firstName || "").toLowerCase().includes(q) ||
        (u.lastName || "").toLowerCase().includes(q)
      );
      if (!match) return res.status(404).json({ error: "User not found", q });
      res.json({
        sub:             match.email,
        name:            match.name || `${match.firstName || ""} ${match.lastName || ""}`.trim(),
        email:           match.email,
        role:            match.role,
        clearance_level: match.clearanceLevel,
        branch_id:       match.branchId,
        department:      match.department ?? "",
        status:          match.status,
        credit_score:    match.creditScore ?? null,
      });
    } catch (error) {
      res.status(500).json({ error: "Search failed" });
    }
  });

  // ── /api/insights/track — receives events forwarded from TES ────────────────
  app.post("/api/insights/track", (req, res) => {
    const ev = req.body;
    if (!ev || !ev.event) return res.status(400).json({ error: "event required" });
    const entry = { ...ev, ts: ev.timestamp || new Date().toISOString() };
    if (ev.event.startsWith("TES_") || ev.event.startsWith("MCP_")) {
      trackEnrichment(entry);
    } else {
      trackEvent({ ...entry, trace_id: ev.trace_id || ev.txn || "_global" });
    }
    res.json({ ok: true });
  });

  // ── /api/insights/events ─────────────────────────────────────────────────────
  app.get("/api/insights/events", (_req, res) => {
    res.json(getInsightsData());
  });

  // ── /insights ────────────────────────────────────────────────────────────────
  app.get("/insights", requireAuth, (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(getInsightsHTML());
  });
}

// ─── Insights HTML Page ───────────────────────────────────────────────────────
function getInsightsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SecureBank — Governance Insights</title>
<style>
:root{--bg:#0f1117;--sur:#1a1d27;--bdr:#2a2d3e;--blue:#3b82f6;--green:#22c55e;--red:#ef4444;--yel:#f59e0b;--pur:#a855f7;--cyn:#06b6d4;--txt:#e2e8f0;--mut:#64748b;--sub:#94a3b8}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:'SF Mono','Fira Code',monospace;font-size:12px}
header{background:var(--sur);border-bottom:1px solid var(--bdr);padding:10px 20px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:14px;color:var(--blue)}
.live{display:flex;align-items:center;gap:6px;color:var(--mut);font-size:11px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--bdr);height:calc(100vh - 41px)}
.tile{background:var(--sur);overflow-y:auto;display:flex;flex-direction:column}
.th{padding:8px 12px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px;position:sticky;top:0;background:var(--sur);z-index:9}
.th h2{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--sub);flex:1}
.cnt{background:var(--bdr);color:var(--mut);border-radius:10px;padding:1px 7px;font-size:10px}
.tb{padding:8px}
.card{background:var(--bg);border:1px solid var(--bdr);border-radius:5px;margin-bottom:7px;overflow:hidden}
.ch{padding:6px 10px;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--bdr)}
.ct{font-size:11px;color:var(--txt);flex:1}
.cb{padding:7px 10px}
.sl{font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut);padding:5px 0 3px;border-bottom:1px solid var(--bdr);margin-bottom:5px}
.kv{display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(42,45,62,.3)}
.kv:last-child{border-bottom:none}
.kk{color:var(--mut);min-width:130px;flex-shrink:0;padding-top:1px}
.vv{color:var(--txt);word-break:break-all;line-height:1.4}
.green{color:var(--green)}.red{color:var(--red)}.yel{color:var(--yel)}.blue{color:var(--blue)}.cyn{color:var(--cyn)}.pur{color:var(--pur)}.mut{color:var(--mut)}
.b{border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600;white-space:nowrap}
.b-allow{background:rgba(34,197,94,.15);color:var(--green)}
.b-deny{background:rgba(239,68,68,.15);color:var(--red)}
.b-bedrock{background:rgba(168,85,247,.2);color:#c084fc}
.b-cowork{background:rgba(6,182,212,.2);color:#22d3ee}
.b-warn{background:rgba(245,158,11,.15);color:var(--yel)}
.b-info{background:rgba(59,130,246,.15);color:var(--blue)}
.b-pur{background:rgba(168,85,247,.15);color:var(--pur)}
.b-cyn{background:rgba(6,182,212,.15);color:var(--cyn)}
.reason{background:rgba(239,68,68,.08);border-left:2px solid var(--red);padding:5px 8px;margin-top:5px;line-height:1.6;color:var(--red);font-size:11px;border-radius:0 3px 3px 0}
.tl{padding:3px 0}
.ts{display:flex;gap:7px;padding:3px 0;position:relative}
.ts:not(:last-child):before{content:'';position:absolute;left:4px;top:16px;bottom:-3px;width:1px;background:var(--bdr)}
.td{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:2px}
.td.allow{background:var(--green)}.td.deny{background:var(--red)}.td.warn{background:var(--yel)}.td.info{background:var(--blue)}.td.cyn{background:var(--cyn)}.td.pur{background:var(--pur)}.td.hitl{background:var(--pur)}
.tt{font-size:11px;color:var(--txt)}
.tm{font-size:10px;color:var(--mut);margin-top:1px}
.empty{color:var(--mut);text-align:center;padding:20px;font-size:11px}
</style>
</head>
<body>
<header>
  <h1>&#x2B21; SecureBank &mdash; Governance Insights</h1>
  <div class="live"><div class="dot"></div><span id="ts">Loading&hellip;</span></div>
</header>
<div class="grid">
  <div class="tile"><div class="th"><h2>Token Observability</h2><span class="cnt" id="c1">0</span></div><div class="tb" id="b1"><div class="empty">Waiting&hellip;</div></div></div>
  <div class="tile"><div class="th"><h2>Agent Behaviour</h2><span class="cnt" id="c2">0</span></div><div class="tb" id="b2"><div class="empty">Waiting&hellip;</div></div></div>
  <div class="tile"><div class="th"><h2>Session Timeline</h2><span class="cnt" id="c3">0</span></div><div class="tb" id="b3"><div class="empty">Waiting&hellip;</div></div></div>
</div>
<script>
var E=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
var T=function(ts){return ts?new Date(ts).toLocaleTimeString():'';};
var S=function(s){return s||'';};
var TR=function(s,n){n=n||32;return s&&s.length>n?s.slice(0,n)+'...':s||'';};

function kv(k,v,c){
  if(v===undefined||v===null||v==='') return '';
  var cls=c?' '+c:'';
  return '<div class="kv"><span class="kk">'+E(k)+'</span><span class="vv'+cls+'">'+E(String(v))+'</span></div>';
}
function srcBadge(ev){
  var src=(ev.client_source||'');
  if(src==='cowork') return '<span class="b b-cowork" style="margin-right:4px">COWORK</span>';
  if(src==='bedrock') return '<span class="b b-bedrock" style="margin-right:4px">BEDROCK</span>';
  if(ev.delegation_chain&&ev.delegation_chain.indexOf('claude-cowork')>=0) return '<span class="b b-cowork" style="margin-right:4px">COWORK</span>';
  if(ev.delegation_chain&&(ev.delegation_chain.indexOf('KQ2UZORR1E')>=0||ev.delegation_chain.indexOf('Lambda')>=0)) return '<span class="b b-bedrock" style="margin-right:4px">BEDROCK</span>';
  return '';
}
function b(l,t){
  t=t||'info';
  return '<span class="b b-'+t+'">'+E(l)+'</span>';
}
function reason(msg){
  return '<div class="reason">'+E(msg)+'</div>';
}

// ── Tile 1: Token Observability ───────────────────────────────────────────────
function tile1(data){
  var sessions=data.sessions||{};
  var enrichment=data.enrichment||[];
  var h='',cnt=0;

  // TES Enrichment section
  var en=enrichment.slice(-20).reverse();
  if(en.length){
    h+='<div class="sl">TES Enrichment</div>';
    var byJti={};
    for(var ei=0;ei<en.length;ei++){
      var ev=en[ei];
      var jti=ev.tokenJti||'_';
      if(!byJti[jti]) byJti[jti]=[];
      byJti[jti].push(ev);
    }
    var jtis=Object.keys(byJti);
    for(var ji=0;ji<jtis.length;ji++){
      var evs=byJti[jtis[ji]];
      var hook=null,pip=null,pdp=null,dec=null;
      for(var k=0;k<evs.length;k++){
        if(evs[k].event==='TES_HOOK_RECEIVED') hook=evs[k];
        if(evs[k].event==='TES_PIP_RESOLVED') pip=evs[k];
        if(evs[k].event==='TES_PDP_RESOLVED') pdp=evs[k];
        if(evs[k].event==='TES_ENRICHMENT_DECISION') dec=evs[k];
      }
      var decided=dec&&dec.decision?dec.decision:(pdp&&pdp.cedarDecision===true?'ENRICHED':'PENDING');
      var dc=decided==='ENRICHED'?'allow':'warn';
      cnt++;
      h+='<div class="card"><div class="ch">'+b(decided,dc)+'<span class="ct">'+(hook?E(hook.userEmail):'&mdash;')+'</span><span class="mut" style="font-size:10px">'+(hook?T(hook.timestamp):'')+'</span></div><div class="cb">';
      if(hook){h+=kv('user',hook.userEmail)+kv('clientId',TR(hook.clientId,24))+kv('scopes',(hook.scopes||[]).join(', '))+kv('tokenJti',TR(hook.tokenJti,28));}
      if(pip){h+=kv('role',pip.role,'blue')+kv('clearanceLevel',pip.clearanceLevel,'cyn')+kv('branchId',pip.branchId)+kv('status',pip.status,pip.status==='active'?'green':'red');}
      if(pdp){h+=kv('cedarDecision',pdp.cedarDecision===true?'ALLOW':'DENY',pdp.cedarDecision===true?'green':'red')+kv('grantedClaims',(pdp.grantedClaimKeys||[]).join(', '));}
      h+='</div></div>';
    }
  }

  // TrAT chains
  var keys=Object.keys(sessions).reverse();
  if(keys.length) h+='<div class="sl">TrAT Chains</div>';
  for(var si=0;si<keys.length;si++){
    var txn=keys[si];
    if(txn==='_global') continue;
    var sevs=sessions[txn];
    var trat1=null,trats=[],denied=[],nonces=[];
    for(var ti=0;ti<sevs.length;ti++){
      var se=sevs[ti];
      if(se.event==='TRAT_ISSUED'&&se.event_type==='TrAT-1') trat1=se;
      if(se.event==='TRAT_DELEGATED') trats.push(se);
      if(se.event==='TRAT_ISSUANCE_DENIED') denied.push(se);
      if(se.event==='APPROVAL_NONCE_BOUND_TO_TRAT'||se.event==='APPROVAL_NONCE_CONSUMED'||se.event==='HITL_NONCE_ISSUED') nonces.push(se);
    }
    // Pick up Cowork scope attenuation events for this session
    var idjagAtt=null;
    for(var iai=0;iai<sevs.length;iai++){
      if(sevs[iai].event==='IDJAG_SCOPE_ATTENUATED') idjagAtt=sevs[iai];
    }
    if(!trat1&&!trats.length&&!idjagAtt) continue;
    cnt++;
    var sub=trat1?trat1.sub:(trats.length?trats[0].sub:'&mdash;');
    var chainSrc=(trat1&&trat1.client_source)||(trats.length&&trats[0].client_source)||'';
    var chainBadge=chainSrc==='cowork'?'<span class="b b-cowork" style="margin-right:4px">COWORK</span>':chainSrc?'<span class="b b-bedrock" style="margin-right:4px">BEDROCK</span>':'';
    h+='<div class="card"><div class="ch">'+chainBadge+b('TrAT-CHAIN','cyn')+'<span class="ct">'+E(sub)+'</span><span class="mut" style="font-size:10px">trace: '+S(txn)+'</span></div><div class="cb">';
    if(idjagAtt){
      h+='<div class="sl">Cowork — ID-JAG &rarr; TrAT Scope Attenuation</div>';
      h+=kv('sub',idjagAtt.sub,'cyn');
      h+=kv('agent',idjagAtt.agent,'blue');
      h+=kv('id_jag_scope (Okta)',idjagAtt.original_scope,'yel');
      h+=kv('trat_scope (narrowed)',idjagAtt.trat_scope,'green');
      h+=kv('delegation_chain',idjagAtt.delegation_chain,'cyn');
      h+=kv('client_source',idjagAtt.client_source,'cyn');
    }
    if(trat1){
      h+='<div class="sl">TrAT-1 (User &rarr; Agent)</div>';
      h+=kv('sub',trat1.sub,'cyn')+kv('delegation_chain',trat1.delegation_chain,'cyn')+kv('delegation_depth',trat1.delegation_depth)+kv('delegate_to',trat1.delegate_to,'blue')+kv('idp_session_ref',TR(trat1.idp_session_ref,28))+kv('expires_in',(trat1.expires_in||600)+'s');
    }
    for(var tri=0;tri<trats.length;tri++){
      var tr=trats[tri];
      var depth=tr.delegation_depth||'?';
      var isDenied=false;
      for(var di=0;di<denied.length;di++){if(denied[di].intent_action===tr.intent_action&&denied[di].delegate_to===tr.delegate_to){isDenied=true;break;}}
      h+='<div class="sl">TrAT-'+(depth-1)+' ('+E(tr.event_type||'')+')</div>';
      h+=kv('sub',tr.sub,'cyn')+kv('delegation_chain',tr.delegation_chain,'cyn')+kv('delegation_depth',tr.delegation_depth)+kv('delegate_to',tr.delegate_to,'blue')+kv('delegate_type',tr.delegate_type)+kv('intent_action',tr.intent_action,'blue')+kv('decision',isDenied?'DENY':'PERMIT',isDenied?'red':'green');
      if(tr.intent_summary&&tr.intent_summary.allowed_userId) h+=kv('allowed_userId',tr.intent_summary.allowed_userId);
      if(tr.intent_summary&&tr.intent_summary.manufacturer) h+=kv('manufacturer',tr.intent_summary.manufacturer);
      if(tr.intent_summary&&tr.intent_summary.loanId) h+=kv('loanId',tr.intent_summary.loanId);
      if(tr.researched_applicants) h+=kv('researched',tr.researched_applicants);
      if(tr.prior_intents&&tr.prior_intents.length) h+=kv('prior_intents',tr.prior_intents.join?tr.prior_intents.join(', '):tr.prior_intents);
      if(tr.expires_in) h+=kv('expires_in',tr.expires_in+'s');
    }
    for(var deni=0;deni<denied.length;deni++){
      var d=denied[deni];
      h+='<div class="sl red">TrAT Denied</div>';
      h+=kv('sub',d.sub,'cyn')+kv('delegation_chain',d.delegation_chain,'cyn')+kv('delegation_depth',d.delegation_depth)+kv('delegate_to',d.delegate_to)+kv('intent_action',d.intent_action,'red')+kv('decision','DENY','red');
    }
    if(nonces.length){
      h+='<div class="sl">Nonce Lifecycle</div>';
      for(var ni=0;ni<nonces.length;ni++){
        var n=nonces[ni];
        var isCons=n.event==='APPROVAL_NONCE_CONSUMED';
        h+=kv('event',n.event,isCons?'green':'yel')+kv('loanId',n.loanId)+kv('applicant',n.applicant)+(n.nonce?kv('nonce',TR(n.nonce,16)+'...'):'')+kv('consumed',isCons?'YES':'NO',isCons?'green':'yel')+kv('ts',T(n.timestamp));
      }
    }
    h+='</div></div>';
  }

  document.getElementById('b1').innerHTML=h||'<div class="empty">Waiting for events&hellip;</div>';
  document.getElementById('c1').textContent=cnt;
}

// ── Tile 2: Agent Behaviour ───────────────────────────────────────────────────
function tile2(data){
  var sessions=data.sessions||{};
  var AG={APPLICANT_SWITCH_DETECTED:1,HITL_BYPASS_DETECTED:1,INTENT_DRIFT_DETECTED:1,INTENT_REPLAY_DETECTED:1,CEDAR_HITL_REQUIRED:1,HITL_ACKNOWLEDGED:1,CEDAR_APPROVELOAN_RESPONSE:1,GUARDRAIL_SCORES_COMPUTED:1,TRAT_ISSUANCE_DENIED:1,TRAT_PDP_UNAVAILABLE:1,TRAT_DELEGATED:1,COWORK_TRAT_DENIED:1};
  var all=[];
  var skeys=Object.keys(sessions);
  for(var si=0;si<skeys.length;si++){
    var sevs=sessions[skeys[si]];
    for(var ei=0;ei<sevs.length;ei++){
      if(AG[sevs[ei].event]) all.push(sevs[ei]);
    }
  }
  all.sort(function(a,c){return new Date(c.timestamp).getTime()-new Date(a.timestamp).getTime();});

  if(!all.length){
    document.getElementById('b2').innerHTML='<div class="empty">No agent behaviour events yet&hellip;</div>';
    document.getElementById('c2').textContent='0';
    return;
  }

  var h='';
  for(var i=0;i<all.length;i++){
    var e=all[i];
    var bt='info';
    var label=e.event;

    if(e.event==='APPLICANT_SWITCH_DETECTED'){bt='deny';label=(e.approval_applicant&&e.approval_applicant.includes('emma.davis'))?'PROMPT INJECTION DETECTED':'APPLICANT SWITCH DETECTED';}
    else if(e.event==='HITL_BYPASS_DETECTED'){bt='deny';label='HITL BYPASS — Prompt Injection Attempt';}
    else if(e.event==='INTENT_DRIFT_DETECTED'){bt='deny';label='INTENT DRIFT DETECTED';}
    else if(e.event==='INTENT_REPLAY_DETECTED'){bt='deny';label='INTENT REPLAY DETECTED';}
    else if(e.event==='CEDAR_HITL_REQUIRED'){bt='warn';label='HITL REQUIRED';}
    else if(e.event==='HITL_ACKNOWLEDGED'){bt='allow';label='HITL ACKNOWLEDGED';}
    else if(e.event==='CEDAR_APPROVELOAN_RESPONSE'){bt=e.decision==='ALLOW'?'allow':'deny';label='LOAN APPROVAL — '+(e.decision||'DENY');}
    else if(e.event==='GUARDRAIL_SCORES_COMPUTED'){bt='pur';label='GUARDRAIL SCORES';}
    else if(e.event==='TRAT_ISSUANCE_DENIED'){
      var policy=(e.determiningPolicies&&e.determiningPolicies[0]?e.determiningPolicies[0].policyId:'')||e.policy||'';
      var isBranch=(e.branch_id&&e.applicantBranchId&&e.branch_id!==e.applicantBranchId)||(policy.toLowerCase().indexOf('branch')>=0);
      var isDrift=!isBranch&&(policy.toLowerCase().indexOf('drift')>=0||e.intent_action==='getMarketAnalysis');
      var isSwitch=!isBranch&&policy.toLowerCase().indexOf('switch')>=0;
      var isBypass=!isBranch&&policy.toLowerCase().indexOf('bypass')>=0;
      if(isBranch){bt='warn';label='BEHAVIOURAL ANOMALY — Cross-Branch Access';}
      else if(isDrift){bt='deny';label='INTENT DRIFT — Token Denied by Reva Trust Gateway';}
      else if(isSwitch){bt='deny';label='APPLICANT SWITCH — Token Denied by Reva Trust Gateway';}
      else if(isBypass){bt='deny';label='HITL BYPASS — Token Denied by Reva Trust Gateway';}
      else{bt='deny';label='TOKEN ISSUANCE DENIED — Reva Trust Gateway';}
    }

    h+='<div class="card"><div class="ch">'+srcBadge(e)+b(label,bt)+'<span style="color:var(--mut);font-size:10px;margin-left:auto">'+T(e.timestamp)+'</span></div><div class="cb">';
    h+=kv('sub',e.sub,'cyn');
    h+=kv('trace_id',TR(e.trace_id,36));
    h+=kv('delegation_chain',e.delegation_chain,'cyn');
    h+=kv('delegation_depth',e.delegation_depth);

    if(e.event==='APPLICANT_SWITCH_DETECTED'){
      h+=kv('approval_applicant',e.approval_applicant,'red');
      h+=kv('last_researched',e.last_researched||e.researched_applicants,'yel');
      h+=kv('intent_action',e.intent_action,'red');
      h+=reason(e.reason||'Agent attempted to approve a different applicant than was researched in this session. Reva Trust Gateway denied the token.');
    }
    else if(e.event==='HITL_BYPASS_DETECTED'){
      h+=kv('loanId',e.loanId);
      h+=kv('txn',e.txn||e.trace_id);
      h+=reason('Agent attempted to proceed with loan approval without completing the required Human-in-the-Loop acknowledgement step. Reva Trust Gateway blocked the token — HITL must be acknowledged via the approval UI before proceeding.');
    }
    else if(e.event==='INTENT_DRIFT_DETECTED'){
      h+=kv('driftType',e.driftType,'yel');
      h+=kv('driftSeverity',e.driftSeverity,e.driftSeverity==='high'?'red':'yel');
      h+=kv('intent_action',e.intent_action,'red');
      h+=kv('userInitiated','false','red');
      h+=kv('prior_intents',e.prior_intents);
      h+=kv('outcome','Token issuance denied by Reva Trust Gateway','red');
      var driftMsg=e.driftType==='AGENT_INITIATED_MARKET_ANALYSIS'?'Agent autonomously triggered market analysis without user instruction. The user only requested loan approval — agent deviated by gathering additional market data beyond the stated intent. Reva Trust Gateway denied the token.':e.driftType==='AGENT_INITIATED_CREDIT_SCORE'?'Agent autonomously triggered credit score check without user instruction — not requested by user. Reva Trust Gateway denied the token.':e.driftType==='AGENT_INITIATED_BOTH'?'Agent autonomously triggered both credit score and market analysis without any user instruction — full scope deviation. Reva Trust Gateway denied the token.':(e.reason||'Agent deviated from user intent. Reva Trust Gateway denied the token.');
      h+=reason(driftMsg);
    }
    else if(e.event==='CEDAR_HITL_REQUIRED'){
      h+=kv('loanId',e.loanId);
      h+=kv('policy','hitl-required-for-high-value-loan','yel');
    }
    else if(e.event==='HITL_ACKNOWLEDGED'){
      h+=kv('loanId',e.loanId);
      h+=kv('acknowledgedBy',e.sub,'green');
    }
    else if(e.event==='CEDAR_APPROVELOAN_RESPONSE'){
      h+=kv('decision',e.decision,e.decision==='ALLOW'?'green':'red');
      h+=kv('hitlAcknowledged',String(e.hitlAcknowledged),e.hitlAcknowledged?'green':'red');
      h+=kv('hitlBypassed',String(e.hitlBypassed),e.hitlBypassed?'red':'green');
      h+=kv('policy',e.policy||(e.determiningPolicies&&e.determiningPolicies[0]?e.determiningPolicies[0].policyId:''));
    }
    else if(e.event==='GUARDRAIL_SCORES_COMPUTED'){
      var sd=e.scope_deviation_score||0;
      var pe=e.privilege_escalation_score||0;
      h+=kv('scope_deviation',sd,sd>=65?'red':sd>=40?'yel':'green');
      h+=kv('privilege_escalation',pe,pe>=75?'red':pe>=55?'yel':'green');
      h+=kv('creditDone',String(e.creditDone),e.creditDone?'green':'red');
      h+=kv('marketDone',String(e.marketDone),e.marketDone?'green':'red');
    }
    else if(e.event==='TRAT_ISSUANCE_DENIED'){
      var p2=(e.determiningPolicies&&e.determiningPolicies[0]?e.determiningPolicies[0].policyId:'')||e.policy||'';
      var ib=(e.branch_id&&e.applicantBranchId&&e.branch_id!==e.applicantBranchId)||(p2.toLowerCase().indexOf('branch')>=0);
      var id2=!ib&&(p2.toLowerCase().indexOf('drift')>=0||e.intent_action==='getMarketAnalysis');
      var is2=!ib&&p2.toLowerCase().indexOf('switch')>=0;
      var iby=!ib&&p2.toLowerCase().indexOf('bypass')>=0;
      h+=kv('intent_action',e.intent_action,'red');
      h+=kv('allowed_userId',e.allowed_userId,'blue');
      h+=kv('delegate_to',e.delegate_to);
      h+=kv('userInitiated',e.userInitiated!==undefined?String(e.userInitiated):'—');
      if(e.prior_intents) h+=kv('prior_intents',typeof e.prior_intents==='string'?e.prior_intents:e.prior_intents.join(', '));
      if(ib){h+=kv('user_branch',e.branch_id,'blue');h+=kv('applicant_branch',e.applicantBranchId,'red');}
      if(p2) h+=kv('policy',p2,'red');
      var dm=ib?'User attempted to access data for an applicant from a different branch (user branch: '+(e.branch_id||'—')+', applicant branch: '+(e.applicantBranchId||'—')+'). Cross-branch data access is not permitted. Reva Trust Gateway denied the token.':id2?'Agent autonomously triggered market analysis as part of the loan approval flow without any user instruction. The user only asked for loan approval — agent deviated by gathering additional data beyond the stated intent. Reva Trust Gateway denied the token.':is2?'Agent attempted to approve a loan for a different applicant than the one researched in this session. Reva Trust Gateway denied the token — approval applicant does not match last researched applicant.':iby?'Agent attempted to proceed with loan approval without the required Human-in-the-Loop acknowledgement. Reva Trust Gateway denied the token.':'Reva Trust Gateway policy denied token issuance for this action.';
      h+=reason(dm);
    }
    h+='</div></div>';
  }

  document.getElementById('b2').innerHTML=h;
  document.getElementById('c2').textContent=all.length;
}

// ── Tile 3: Session Timeline ──────────────────────────────────────────────────
function tile3(data){
  var sessions=data.sessions||{};
  var keys=Object.keys(sessions).filter(function(k){return k!=='_global';}).reverse();

  if(!keys.length){
    document.getElementById('b3').innerHTML='<div class="empty">Waiting for sessions&hellip;</div>';
    document.getElementById('c3').textContent='0';
    return;
  }

  var h='';
  for(var si=0;si<keys.length;si++){
    var txn=keys[si];
    var evs=sessions[txn];
    var sub=null,switchDet=null,bypassDet=null,hitlReq=null,hitlAck=null,nonceCons=null,finalApprove=null,finalDenied=null,idpRef=null;
    var csEvs=[],crEvs=[];
    for(var ei=0;ei<evs.length;ei++){
      var e=evs[ei];
      if(!sub&&e.sub) sub=e.sub;
      if(!idpRef&&e.idp_session_ref) idpRef=e.idp_session_ref;
      if(e.event==='APPLICANT_SWITCH_DETECTED') switchDet=e;
      if(e.event==='HITL_BYPASS_DETECTED') bypassDet=e;
      if(e.event==='CEDAR_HITL_REQUIRED') hitlReq=e;
      if(e.event==='HITL_ACKNOWLEDGED') hitlAck=e;
      if(e.event==='APPROVAL_NONCE_CONSUMED') nonceCons=e;
      if(e.event==='CEDAR_APPROVELOAN_RESPONSE') finalApprove=e;
      if(e.event==='TRAT_ISSUANCE_DENIED') finalDenied=e;
      if(e.event==='COWORK_TRAT_DENIED'&&!finalDenied) finalDenied=e;
      if(e.event==='TRAT_DELEGATED'&&e.client_source==='cowork'&&!finalApprove) finalApprove={decision:'ALLOW',ts:e.ts};
      if(e.event==='INTENT_CREDIT_SCORE_RECORDED') csEvs.push(e);
      if(e.event==='INTENT_CREDIT_RISK_RECORDED') crEvs.push(e);
    }
    var outcome='IN PROGRESS',oc='info';
    if(switchDet){outcome='SWITCH DENIED';oc='deny';}
    else if(bypassDet){outcome='INJECTION DENIED';oc='deny';}
    else if(finalApprove){outcome=finalApprove.decision==='ALLOW'?'APPROVED':'DENIED';oc=finalApprove.decision==='ALLOW'?'allow':'deny';}
    else if(finalDenied){outcome='TRAT DENIED';oc='deny';}

    // Detect session source: cowork vs bedrock
    var sessionSrc='';
    for(var esi=0;esi<evs.length;esi++){
      if(evs[esi].client_source){sessionSrc=evs[esi].client_source;break;}
      if(evs[esi].delegation_chain&&evs[esi].delegation_chain.indexOf('claude-cowork')>=0){sessionSrc='cowork';break;}
      if(evs[esi].delegation_chain&&(evs[esi].delegation_chain.indexOf('KQ2UZORR1E')>=0)){sessionSrc='bedrock';break;}
    }
    var sessionBadge=sessionSrc==='cowork'?'<span class="b b-cowork" style="margin-right:4px">COWORK</span>':sessionSrc==='bedrock'?'<span class="b b-bedrock" style="margin-right:4px">BEDROCK</span>':'';

    var researched=[];
    for(var ri=0;ri<csEvs.length;ri++){if(csEvs[ri].applicantEmail&&researched.indexOf(csEvs[ri].applicantEmail)<0) researched.push(csEvs[ri].applicantEmail);}
    for(var ri2=0;ri2<crEvs.length;ri2++){if(crEvs[ri2].applicantEmail&&researched.indexOf(crEvs[ri2].applicantEmail)<0) researched.push(crEvs[ri2].applicantEmail);}

    h+='<div class="card"><div class="ch">'+sessionBadge+b(outcome,oc)+'<span class="ct">'+E(sub||'&mdash;')+'</span><span class="mut" style="font-size:10px">trace: '+S(txn)+'</span></div><div class="cb">';
    h+=kv('sub',sub||'','cyn');
    h+=kv('trace_id',TR(txn,36));
    if(researched.length) h+=kv('researched',researched.join(', '),'blue');
    if(idpRef) h+=kv('idp_session_ref',TR(idpRef,28));

    h+='<div class="sl" style="margin-top:5px">Intent Sequence</div><div class="tl">';

    var steps=[];
    function addStep(label,color,ts,meta){steps.push({label:label,color:color,ts:ts,meta:meta||''});}

    // getLoans
    for(var ei2=0;ei2<evs.length;ei2++){var ev=evs[ei2];if(ev.event==='TRAT_DELEGATED'&&ev.intent_action==='getLoans'){addStep('getLoans','info',ev.timestamp,'Pending loans fetched');break;}}
    // getCreditScores
    if(csEvs.length){for(var k=0;k<csEvs.length;k++) addStep('getCreditScores','info',csEvs[k].timestamp,csEvs[k].applicantEmail+' | initiated: '+csEvs[k].userInitiated);}
    else{for(var ei3=0;ei3<evs.length;ei3++){var ev3=evs[ei3];if(ev3.event==='TRAT_DELEGATED'&&ev3.intent_action==='getCreditScores'){addStep('getCreditScores','info',ev3.timestamp,ev3.intent_summary&&ev3.intent_summary.allowed_userId?ev3.intent_summary.allowed_userId:'');break;}}}
    // getCreditRiskAnalysis
    if(crEvs.length){for(var k2=0;k2<crEvs.length;k2++) addStep('getCreditRiskAnalysis','cyn',crEvs[k2].timestamp,crEvs[k2].applicantEmail+' | initiated: '+crEvs[k2].userInitiated);}
    else{for(var ei4=0;ei4<evs.length;ei4++){var ev4=evs[ei4];if(ev4.event==='TRAT_DELEGATED'&&ev4.intent_action==='getCreditRiskAnalysis'){addStep('getCreditRiskAnalysis','cyn',ev4.timestamp,ev4.intent_summary&&ev4.intent_summary.allowed_userId?ev4.intent_summary.allowed_userId:'');break;}}}
    // getMarketAnalysis
    for(var ei5=0;ei5<evs.length;ei5++){var ev5=evs[ei5];if(ev5.event==='TRAT_DELEGATED'&&ev5.intent_action==='getMarketAnalysis'){addStep('getMarketAnalysis','pur',ev5.timestamp,ev5.intent_summary&&ev5.intent_summary.manufacturer?ev5.intent_summary.manufacturer:'');break;}}
    // getComplianceCheck
    for(var ei6=0;ei6<evs.length;ei6++){var ev6=evs[ei6];if(ev6.event==='TRAT_DELEGATED'&&ev6.intent_action==='getComplianceCheck'){addStep('getComplianceCheck','warn',ev6.timestamp,ev6.intent_summary&&ev6.intent_summary.userId?ev6.intent_summary.userId:'');break;}}
    // HITL
    if(hitlReq) addStep('HITL REQUIRED','hitl',hitlReq.timestamp,'loanId: '+hitlReq.loanId);
    if(hitlAck) addStep('HITL ACKNOWLEDGED','allow',hitlAck.timestamp,'User approved via UI');
    // Switch/Bypass
    if(switchDet){var isInjection=switchDet.approval_applicant&&switchDet.approval_applicant.includes('emma.davis');addStep(isInjection?'PROMPT INJECTION DETECTED':'APPLICANT SWITCH DETECTED','deny',switchDet.timestamp,'researched: '+(switchDet.last_researched||switchDet.researched_applicants)+' | approval: '+switchDet.approval_applicant);}
    if(bypassDet) addStep('HITL BYPASS DETECTED','deny',bypassDet.timestamp,'Prompt injection attempt');
    // approveLoan
    for(var ei7=0;ei7<evs.length;ei7++){var ev7=evs[ei7];if(ev7.event==='TRAT_DELEGATED'&&ev7.intent_action==='approveLoan'){addStep('approveLoan',finalDenied?'deny':'info',ev7.timestamp,'loanId: '+(ev7.intent_summary&&ev7.intent_summary.loanId?ev7.intent_summary.loanId:'—')+' | depth: '+ev7.delegation_depth);break;}}
    // Nonce
    if(nonceCons) addStep('NONCE CONSUMED','allow',nonceCons.timestamp,'loanId: '+nonceCons.loanId);
    // Final
    if(finalApprove) addStep('CEDAR: '+finalApprove.decision,finalApprove.decision==='ALLOW'?'allow':'deny',finalApprove.timestamp,'policy: '+((finalApprove.determiningPolicies&&finalApprove.determiningPolicies[0]?finalApprove.determiningPolicies[0].policyId:'')||finalApprove.policy||'—'));
    else if(finalDenied) addStep('TRAT ISSUANCE DENIED','deny',finalDenied.timestamp,'policy: '+((finalDenied.determiningPolicies&&finalDenied.determiningPolicies[0]?finalDenied.determiningPolicies[0].policyId:'')||finalDenied.policy||'—'));

    steps.sort(function(a,c){return new Date(a.ts).getTime()-new Date(c.ts).getTime();});
    for(var sj=0;sj<steps.length;sj++){
      var step=steps[sj];
      h+='<div class="ts"><div class="td '+step.color+'"></div><div><div class="tt">'+E(step.label)+'</div><div class="tm">'+T(step.ts)+(step.meta?' &mdash; '+E(step.meta):'')+'</div></div></div>';
    }
    if(!steps.length) h+='<div class="tm" style="padding:3px 0">No steps recorded yet</div>';
    h+='</div></div></div>';
  }

  document.getElementById('b3').innerHTML=h;
  document.getElementById('c3').textContent=keys.length;
}

// ── Poll ──────────────────────────────────────────────────────────────────────
async function refresh(){
  try{
    var r=await fetch('/api/insights/events');
    if(!r.ok){document.getElementById('ts').textContent='API '+r.status+' &mdash; retrying&hellip;';return;}
    var d=await r.json();
    tile1(d);tile2(d);tile3(d);
    document.getElementById('ts').textContent='Live &middot; '+new Date().toLocaleTimeString();
  }catch(e){
    document.getElementById('ts').textContent='Error &mdash; retrying&hellip;';
    console.error(e);
  }
}
refresh();
setInterval(refresh,5000);
</script>
</body>
</html>`;
}