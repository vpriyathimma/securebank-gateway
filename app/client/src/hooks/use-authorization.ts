import React from "react";
import { User } from "@shared/schema";

// Frontend authorization hook based on Cedar policies
export interface AuthorizationContext {
  currentHour?: number;
  amount?: number;
  resourceId?: string;
  [key: string]: any;
}

// Role-based permissions (synced with Cedar policies)
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
    "SwitchUser"
  ]
} as const;

export function hasPermission(user: User | null, action: string, context?: AuthorizationContext): boolean {
  if (!user || user.status !== "active") {
    return false;
  }

  const rolePermissions = ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS];
  if (!rolePermissions || !rolePermissions.includes(action as any)) {
    return false;
  }

  // Forbid Account Holders from editing anything
  if (user.role === "Account Holder" && (
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
    return false;
  }

  // Time-based restrictions (business hours)
  if (context?.currentHour !== undefined) {
    const restrictedActions = ["CreateAccount", "DeleteAccount", "ApproveLoan"];
    const isBusinessHours = context.currentHour >= 8 && context.currentHour < 18;
    
    if (restrictedActions.includes(action) && !isBusinessHours && user.role !== "Bank Manager") {
      return false;
    }
  }

  // Loan approval restrictions
  const loanApprovalActions = ["ApproveLoan", "RejectLoan"];
  if (loanApprovalActions.includes(action) && user.role !== "Bank Manager") {
    return false;
  }

  // User management restrictions
  const userManagementActions = ["CreateUser", "UpdateUser", "DeleteUser"];
  if (userManagementActions.includes(action) && user.role !== "Bank Manager") {
    return false;
  }

  // Account deletion restrictions
  if (action === "DeleteAccount" && user.role !== "Bank Manager") {
    return false;
  }

  return true;
}

export function useAuthorization(user?: User | null) {
  const currentUser = user || null;

  return {
    // Basic permission checks
    canView: (resource: string, context?: AuthorizationContext) => 
      hasPermission(currentUser, `View${resource}`, context),
    
    canCreate: (resource: string, context?: AuthorizationContext) => 
      hasPermission(currentUser, `Create${resource}`, context),
    
    canUpdate: (resource: string, context?: AuthorizationContext) => 
      hasPermission(currentUser, `Update${resource}`, context),
    
    canDelete: (resource: string, context?: AuthorizationContext) => 
      hasPermission(currentUser, `Delete${resource}`, context),
    
    canApprove: (resource: string, context?: AuthorizationContext) => 
      hasPermission(currentUser, `Approve${resource}`, context),

    // Specific action checks
    canSwitchUser: () => hasPermission(currentUser, "SwitchUser"),
    
    canManageUsers: () => hasPermission(currentUser, "CreateUser") && 
                          hasPermission(currentUser, "UpdateUser") && 
                          hasPermission(currentUser, "DeleteUser"),

    canProcessLoans: () => hasPermission(currentUser, "ApproveLoan") && 
                          hasPermission(currentUser, "RejectLoan"),

    // Role checks
    isAccountHolder: () => currentUser?.role === "Account Holder",
    isBankTeller: () => currentUser?.role === "Bank Teller", 
    isBankManager: () => currentUser?.role === "Bank Manager",
    
    // High-level capability checks
    hasFullAccess: () => currentUser?.role === "Bank Manager",
    hasLimitedAccess: () => currentUser?.role === "Account Holder",
    hasStaffAccess: () => currentUser?.role === "Bank Teller" || currentUser?.role === "Bank Manager",

    // Get all permissions for current user
    getAllPermissions: () => {
      if (!currentUser) return [];
      const permissions = ROLE_PERMISSIONS[currentUser.role as keyof typeof ROLE_PERMISSIONS];
      return permissions ? [...permissions] : [];
    },

    // Check if user can access specific resource
    canAccessResource: (resourceType: string, resourceId: string, ownerId?: string) => {
      if (!currentUser) return false;
      
      // Account holders can only access their own resources
      if (currentUser.role === "Account Holder" && ownerId && ownerId !== currentUser.id) {
        return false;
      }
      
      return hasPermission(currentUser, `View${resourceType}`);
    },

    // Context-aware permission checking
    checkPermission: (action: string, context?: AuthorizationContext) => 
      hasPermission(currentUser, action, context),

    // Current user info
    currentUser,
    isAuthenticated: () => currentUser !== null && currentUser.status === "active"
  };
}

// HOC for protecting components
export function withAuthorization<T extends Record<string, any>>(
  Component: React.ComponentType<T>,
  requiredPermission: string,
  fallback?: React.ReactNode
) {
  return function AuthorizedComponent(props: T) {
    const { checkPermission } = useAuthorization();
    
    if (!checkPermission(requiredPermission)) {
      return fallback || React.createElement("div", { className: "text-center text-gray-500 py-8" }, "Access Denied");
    }
    
    return React.createElement(Component, props);
  };
}

// Component for conditional rendering based on permissions
export function AuthorizedContent({ 
  permission, 
  context,
  children, 
  fallback 
}: {
  permission: string;
  context?: AuthorizationContext;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { checkPermission } = useAuthorization();
  
  if (!checkPermission(permission, context)) {
    return fallback || null;
  }
  
  return React.createElement(React.Fragment, {}, children);
}