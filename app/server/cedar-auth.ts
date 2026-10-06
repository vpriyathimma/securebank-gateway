import { User, InsertAuditLog } from "@shared/schema";
import { storage } from './storage.js';

// Cedar Authorization Integration for SecureBank
// This module provides Cedar policy-based authorization

export interface CedarContext {
  currentHour?: number;
  amount?: number;
  resourceId?: string;
  [key: string]: any;
}

export interface AuthorizationRequest {
  principal: User;
  action: string;
  resource?: {
    type: string;
    id: string;
    attributes?: Record<string, any>;
  };
  context?: CedarContext;
}

export interface AuthorizationResult {
  decision: "Allow" | "Deny";
  reasons?: string[];
}

// Role-based permissions mapping
const ROLE_PERMISSIONS = {
  "Account Holder": [
    "ViewDashboard",
    "ViewAccounts",
    "ViewTransactions", 
    "ViewLoans",
    "TransferFunds"
    // Note: Account Holders cannot edit their own accounts
  ],
  "Bank Teller": [
    "ViewDashboard",
    "ViewAccounts",
    "CreateAccount",
    "UpdateAccount",
    "ViewTransactions",
    "DeleteTransaction",
    "TransferFunds",
    "ViewLoans",
    "CreateLoan",
    "ApproveLoan",
    "RejectLoan",
    "ViewUsers",
    "UpdateUser",
    "ViewAuditLogs",
    "SwitchUser"
  ],
  "Bank Manager": [
    "ViewDashboard",
    "ViewAccounts",
    "CreateAccount",
    "UpdateAccount",
    "DeleteAccount",
    "ViewTransactions",
    "DeleteTransaction",
    "TransferFunds",
    "ViewLoans",
    "CreateLoan",
    "ApproveLoan",
    "RejectLoan",
    "ViewUsers",
    "CreateUser",
    "UpdateUser",
    "DeleteUser",
    "ViewAuditLogs",
    "SwitchUser"
  ]
} as const;

export class CedarAuthorizationEngine {
  /**
   * Evaluate authorization request based on Cedar policies
   */
  public static authorize(request: AuthorizationRequest): AuthorizationResult {
    const startTime = Date.now();
    const { principal, action, resource, context } = request;

    // Check if user is active
    if (principal.status !== "active") {
      const result = {
        decision: "Deny" as const,
        reasons: ["User account is not active"]
      };
      this.logAuthorizationDecision(request, result, startTime, context);
      return result;
    }

    // Check role-based permissions
    const rolePermissions = ROLE_PERMISSIONS[principal.role as keyof typeof ROLE_PERMISSIONS];
    if (!rolePermissions || !rolePermissions.includes(action as any)) {
      const result = {
        decision: "Deny" as const,
        reasons: [`Role '${principal.role}' does not have permission for action '${action}'`]
      };
      this.logAuthorizationDecision(request, result, startTime, context);
      return result;
    }

    // Account-specific access for Account Holders
    if (principal.role === "Account Holder" && resource) {
      if (action === "ViewAccounts" || action === "ViewTransactions") {
        if (resource.attributes?.ownerId !== principal.id) {
          const result = {
            decision: "Deny" as const,
            reasons: ["Account Holders can only access their own accounts"]
          };
          this.logAuthorizationDecision(request, result, startTime, context);
          return result;
        }
      }
    }

    // Forbid Account Holders from editing anything
    if (principal.role === "Account Holder" && (
      action === "UpdateAccount" || 
      action === "CreateAccount" || 
      action === "DeleteAccount" ||
      action === "CreateTransaction" ||
      action === "DeleteTransaction" ||
      action === "CreateLoan" ||
      action === "ApproveLoan" ||
      action === "RejectLoan" ||
      action === "UpdateUser" ||
      action === "CreateUser" ||
      action === "DeleteUser"
    )) {
      const result = {
        decision: "Deny" as const,
        reasons: ["Account Holders cannot edit account information or perform transactions"]
      };
      this.logAuthorizationDecision(request, result, startTime, context);
      return result;
    }

    // Time-based restrictions (business hours)
    if (context?.currentHour !== undefined) {
      const restrictedActions = ["CreateAccount", "DeleteAccount", "ApproveLoan"];
      const isBusinessHours = context.currentHour >= 8 && context.currentHour < 18;
      
      if (restrictedActions.includes(action) && !isBusinessHours && principal.role !== "Bank Manager") {
        const result = {
          decision: "Deny" as const,
          reasons: ["This operation is only available during business hours (8 AM - 6 PM)"]
        };
        this.logAuthorizationDecision(request, result, startTime, context);
        return result;
      }
    }

    // Loan approval restrictions
    const loanApprovalActions = ["ApproveLoan", "RejectLoan"];
    if (loanApprovalActions.includes(action) && principal.role !== "Bank Manager") {
      const result = {
        decision: "Deny" as const,
        reasons: ["Only Bank Managers can approve or reject loans"]
      };
      this.logAuthorizationDecision(request, result, startTime, context);
      return result;
    }

    // User management restrictions
    const userManagementActions = ["CreateUser", "UpdateUser", "DeleteUser"];
    if (userManagementActions.includes(action) && principal.role !== "Bank Manager") {
      const result = {
        decision: "Deny" as const,
        reasons: ["Only Bank Managers can manage users"]
      };
      this.logAuthorizationDecision(request, result, startTime, context);
      return result;
    }

    // Account deletion restrictions
    if (action === "DeleteAccount" && principal.role !== "Bank Manager") {
      const result = {
        decision: "Deny" as const,
        reasons: ["Only Bank Managers can delete accounts"]
      };
      this.logAuthorizationDecision(request, result, startTime, context);
      return result;
    }

    const result = {
      decision: "Allow" as const,
      reasons: [`Access granted for ${principal.role} to perform ${action}`]
    };
    this.logAuthorizationDecision(request, result, startTime, context);
    return result;
  }

  /**
   * Check if user has permission for a specific action
   */
  public static hasPermission(user: User, action: string, resource?: any, context?: CedarContext): boolean {
    const result = this.authorize({
      principal: user,
      action,
      resource,
      context
    });
    return result.decision === "Allow";
  }

  /**
   * Get all permissions for a user role
   */
  public static getRolePermissions(role: string): string[] {
    const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    return permissions ? [...permissions] : [];
  }

  /**
   * Validate if user can access a specific resource
   */
  public static canAccessResource(
    user: User, 
    action: string, 
    resourceType: string, 
    resourceId: string,
    resourceAttributes?: Record<string, any>
  ): boolean {
    return this.hasPermission(user, action, {
      type: resourceType,
      id: resourceId,
      attributes: resourceAttributes
    });
  }

  /**
   * Log authorization decision to audit trail
   */
  private static async logAuthorizationDecision(
    request: AuthorizationRequest,
    result: AuthorizationResult,
    startTime: number,
    context?: CedarContext
  ): Promise<void> {
    try {
      const processingTime = Date.now() - startTime;
      const { principal, action, resource } = request;

      // Determine risk level based on action and decision
      let riskLevel = 'low';
      const highRiskActions = ['DeleteAccount', 'ApproveLoan', 'TransferFunds', 'UpdateUser', 'CreateUser', 'DeleteUser'];
      const mediumRiskActions = ['CreateAccount', 'UpdateAccount', 'ViewSensitiveAccountData', 'EditAccountBalance'];
      
      if (highRiskActions.some(a => action.includes(a))) {
        riskLevel = 'high';
      } else if (mediumRiskActions.some(a => action.includes(a))) {
        riskLevel = 'medium';
      }

      // If access was denied, increase risk level
      if (result.decision === 'Deny') {
        riskLevel = riskLevel === 'high' ? 'critical' : 'high';
      }

      // Determine what sensitive data was accessed
      const sensitiveDataTypes: string[] = [];
      if (action.includes('ViewSensitive') || action.includes('EditAccount') || action.includes('TransferFunds')) {
        sensitiveDataTypes.push('account_data');
      }
      if (action.includes('User') && action !== 'ViewUser') {
        sensitiveDataTypes.push('user_pii');
      }
      if (action.includes('Loan')) {
        sensitiveDataTypes.push('loan_data');
      }

      const auditLog: InsertAuditLog = {
        principalId: principal.id,
        principalType: 'User',
        principalRole: principal.role,
        action,
        resourceType: resource?.type || null,
        resourceId: resource?.id || null,
        decision: result.decision,
        reasons: JSON.stringify(result.reasons || []),
        requestContext: JSON.stringify({
          userAgent: context?.userAgent,
          sessionId: context?.sessionId,
          currentHour: context?.currentHour,
          amount: context?.amount,
          resourceId: context?.resourceId
        }),
        sessionId: context?.sessionId || null,
        ipAddress: context?.ipAddress || null,
        userAgent: context?.userAgent || null,
        policyEngineVersion: '1.0',
        processingTimeMs: processingTime,
        riskLevel,
        complianceFlags: result.decision === 'Deny' ? JSON.stringify(['unauthorized_access_attempt']) : null,
        businessContext: JSON.stringify({
          action_category: this.categorizeAction(action),
          resource_sensitivity: sensitiveDataTypes.length > 0 ? 'high' : 'normal'
        }),
        dataAccessed: sensitiveDataTypes.length > 0 ? JSON.stringify(sensitiveDataTypes) : null,
        actionOutcome: result.decision === 'Allow' ? 'success' : 'denied'
      };

      await storage.createAuditLog(auditLog);
    } catch (error) {
      // Log error but don't fail the authorization
      console.error('Failed to log authorization decision:', error);
    }
  }

  /**
   * Categorize actions for audit purposes
   */
  private static categorizeAction(action: string): string {
    if (action.includes('View')) return 'data_access';
    if (action.includes('Create')) return 'data_creation';
    if (action.includes('Update') || action.includes('Edit')) return 'data_modification';
    if (action.includes('Delete')) return 'data_deletion';
    if (action.includes('Transfer')) return 'financial_transaction';
    if (action.includes('Approve') || action.includes('Reject')) return 'workflow_decision';
    return 'other';
  }
}

// Middleware for Express routes
export function requirePermission(action: string) {
  return (req: any, res: any, next: any) => {
    const user = req.user || req.session?.user;
    
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const context: CedarContext = {
      currentHour: new Date().getHours(),
      ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      sessionId: req.sessionID || 'unknown',
      ...req.body
    };

    const result = CedarAuthorizationEngine.authorize({
      principal: user,
      action,
      context
    });

    if (result.decision === "Deny") {
      return res.status(403).json({ 
        error: "Access denied",
        reasons: result.reasons 
      });
    }

    next();
  };
}

// Helper function to check permissions in components
export function usePermissions(user: User) {
  return {
    canView: (resource: string) => CedarAuthorizationEngine.hasPermission(user, `View${resource}`),
    canCreate: (resource: string) => CedarAuthorizationEngine.hasPermission(user, `Create${resource}`),
    canUpdate: (resource: string) => CedarAuthorizationEngine.hasPermission(user, `Update${resource}`),
    canDelete: (resource: string) => CedarAuthorizationEngine.hasPermission(user, `Delete${resource}`),
    canApprove: (resource: string) => CedarAuthorizationEngine.hasPermission(user, `Approve${resource}`),
    hasRole: (role: string) => user.role === role,
    getAllPermissions: () => CedarAuthorizationEngine.getRolePermissions(user.role)
  };
}