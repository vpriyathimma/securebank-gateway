// AWS Verified Permissions Frontend Integration
// Replaces local authorization with AWS-backed API calls

import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import type { User } from '@shared/schema';
import { url, goTo } from "@/lib/base-path";

interface AuthorizationRequest {
  action: string;
  resource?: string;
  context?: Record<string, any>;
}

interface AuthorizationResult {
  authorized: boolean;
  decision: 'ALLOW' | 'DENY';
  reasons?: string[];
  errors?: string[];
}

interface BatchAuthorizationRequest {
  requests: AuthorizationRequest[];
}

interface BatchAuthorizationResult {
  results: AuthorizationResult[];
}

/**
 * AWS-backed authorization hook for SecureBank
 */
export const useAWSAuthorization = (user: User | null) => {
  /**
   * Single authorization check
   */
  const checkPermission = useMutation({
    mutationFn: async (request: AuthorizationRequest): Promise<boolean> => {
      if (!user) return false;
      
      const response = await fetch(url("/api/auth/check-permission"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: user.id,
          action: request.action,
          resource: request.resource,
          context: {
            ...request.context,
            currentTime: {
              timestamp: Date.now(),
              isBusinessHours: isBusinessHours(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            session: {
              id: generateSessionId(),
              ipAddress: await getClientIP(),
              userAgent: navigator.userAgent,
              mfaVerified: user.mfaEnabled || false
            },
            location: {
              country: await getCountryCode(),
              region: await getRegion()
            },
            device: {
              fingerprint: await getDeviceFingerprint(),
              trusted: await isDeviceTrusted(),
              type: getDeviceType()
            },
            risk: {
              score: await getRiskScore(user.id, request.action),
              level: getRiskLevel(user.riskProfile),
              factors: getRiskFactors()
            }
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`Authorization check failed: ${response.status}`);
      }
      
      const result: AuthorizationResult = await response.json();
      return result.authorized;
    },
    onError: (error) => {
      console.error('Authorization check failed:', error);
      // In case of error, deny by default for security
      return false;
    }
  });

  /**
   * Batch authorization check for multiple permissions
   */
  const batchCheckPermissions = useMutation({
    mutationFn: async (requests: AuthorizationRequest[]): Promise<boolean[]> => {
      if (!user) return requests.map(() => false);
      
      const response = await fetch(url("/api/auth/batch-check-permissions"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: requests.map(req => ({
            principal: user.id,
            action: req.action,
            resource: req.resource,
            context: {
              ...req.context,
              currentTime: {
                timestamp: Date.now(),
                isBusinessHours: isBusinessHours(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
              },
              session: {
                id: generateSessionId(),
                ipAddress: await getClientIP(),
                userAgent: navigator.userAgent,
                mfaVerified: user.mfaEnabled || false
              }
            }
          }))
        })
      });
      
      if (!response.ok) {
        throw new Error(`Batch authorization check failed: ${response.status}`);
      }
      
      const result: BatchAuthorizationResult = await response.json();
      return result.results.map(r => r.authorized);
    },
    onError: (error) => {
      console.error('Batch authorization check failed:', error);
      // In case of error, deny all by default for security
      return [];
    }
  });

  /**
   * Cached permission check for frequently accessed permissions
   */
  const getCachedPermission = useQuery({
    queryKey: ['permission', user?.id, user?.role],
    queryFn: async () => {
      if (!user) return {};
      
      // Check common permissions and cache them
      const commonPermissions = [
        'SecureBank::Action::ViewDashboard',
        'SecureBank::Action::ViewAccounts',
        'SecureBank::Action::ViewTransactions',
        'SecureBank::Action::ViewLoans',
        'SecureBank::Action::TransferFunds',
        'SecureBank::Action::CreateAccount',
        'SecureBank::Action::UpdateAccount',
        'SecureBank::Action::DeleteAccount',
        'SecureBank::Action::ViewUsers',
        'SecureBank::Action::CreateUser',
        'SecureBank::Action::UpdateUser',
        'SecureBank::Action::DeleteUser',
        'SecureBank::Action::ApproveLoan',
        'SecureBank::Action::RejectLoan'
      ];

      const results = await batchCheckPermissions.mutateAsync(
        commonPermissions.map(action => ({ action }))
      );

      return commonPermissions.reduce((acc, action, index) => {
        acc[action] = results[index] || false;
        return acc;
      }, {} as Record<string, boolean>);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000 // 10 minutes (replaces cacheTime in TanStack Query v5)
  });

  /**
   * Check if user can perform action on specific resource
   */
  const canPerformAction = async (action: string, resource?: string): Promise<boolean> => {
    // Check cache first for common permissions
    if (!resource && getCachedPermission.data?.[action] !== undefined) {
      return getCachedPermission.data[action];
    }

    // Perform real-time check
    return await checkPermission.mutateAsync({ action, resource });
  };

  /**
   * Invalidate permission cache (call after role changes, etc.)
   */
  const invalidatePermissions = () => {
    queryClient.invalidateQueries({ queryKey: ['permission', user?.id] });
  };

  return {
    checkPermission: checkPermission.mutateAsync,
    batchCheckPermissions: batchCheckPermissions.mutateAsync,
    canPerformAction,
    getCachedPermissions: getCachedPermission.data || {},
    invalidatePermissions,
    isLoading: checkPermission.isPending || batchCheckPermissions.isPending || getCachedPermission.isLoading,
    error: checkPermission.error || batchCheckPermissions.error || getCachedPermission.error
  };
};

/**
 * Utility functions for context building
 */

// Check if current time is during business hours
const isBusinessHours = (): boolean => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  
  // Monday to Friday, 9 AM to 5 PM
  return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
};

// Generate session ID (simplified - in production use proper session management)
const generateSessionId = (): string => {
  return localStorage.getItem('sessionId') || 
         (() => {
           const id = crypto.randomUUID();
           localStorage.setItem('sessionId', id);
           return id;
         })();
};

// Get client IP (simplified - in production use proper IP detection)
const getClientIP = async (): Promise<string> => {
  try {
    const response = await fetch(url("/api/client-ip"));
    const data = await response.json();
    return data.ip || 'unknown';
  } catch {
    return 'unknown';
  }
};

// Get country code from geolocation
const getCountryCode = async (): Promise<string> => {
  try {
    const response = await fetch(url("/api/geolocation"));
    const data = await response.json();
    return data.country || 'US';
  } catch {
    return 'US';
  }
};

// Get region from geolocation
const getRegion = async (): Promise<string> => {
  try {
    const response = await fetch(url("/api/geolocation"));
    const data = await response.json();
    return data.region || 'Unknown';
  } catch {
    return 'Unknown';
  }
};

// Generate device fingerprint
const getDeviceFingerprint = async (): Promise<string> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Device fingerprint', 2, 2);
  }
  
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    canvas.toDataURL()
  ].join('|');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16);
};

// Check if device is trusted (simplified)
const isDeviceTrusted = async (): Promise<boolean> => {
  const fingerprint = await getDeviceFingerprint();
  const trustedDevices = JSON.parse(localStorage.getItem('trustedDevices') || '[]');
  return trustedDevices.includes(fingerprint);
};

// Get device type
const getDeviceType = (): string => {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad|phone/.test(userAgent)) {
    return 'mobile';
  } else if (/tablet|ipad/.test(userAgent)) {
    return 'tablet';
  } else {
    return 'desktop';
  }
};

// Get risk score (mock implementation)
const getRiskScore = async (userId: string, action: string): Promise<number> => {
  // In production, this would call a real risk assessment service
  const baseScore = 10;
  const actionMultiplier = action.includes('Delete') ? 3 : 
                          action.includes('Transfer') ? 2 : 1;
  return Math.min(baseScore * actionMultiplier, 100);
};

// Get risk level from profile
const getRiskLevel = (riskProfile?: string): string => {
  return riskProfile || 'low';
};

// Get risk factors
const getRiskFactors = (): string[] => {
  return []; // Simplified - in production, gather actual risk factors
};

/**
 * Authorization HOC for components
 */
import React from 'react';

export const withAuthorization = <T extends object>(
  Component: React.ComponentType<T>,
  requiredAction: string,
  resource?: string
) => {
  return (props: T) => {
    const user = null; // Get from your auth context
    const { canPerformAction, isLoading } = useAWSAuthorization(user);
    const [authorized, setAuthorized] = React.useState(false);

    React.useEffect(() => {
      const checkAuth = async () => {
        const result = await canPerformAction(requiredAction, resource);
        setAuthorized(result);
      };
      checkAuth();
    }, [canPerformAction, requiredAction, resource]);

    if (isLoading) {
      return React.createElement('div', null, 'Loading...');
    }

    if (!authorized) {
      return React.createElement('div', null, 'Access Denied');
    }

    return React.createElement(Component, props);
  };
};

export default useAWSAuthorization;